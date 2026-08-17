/**
 * Reimbursement settlement repository — data access for the append-only
 * `reimbursement_settlements` table (supabase/migrations/086, `docs/11-MONEY.md`
 * §1/§6/§8). Extends BaseRepository for `findById` and overrides `create` for
 * the one thing this table needs that the base does not: translating the 23505
 * its unique index raises into a typed conflict.
 *
 * Uses the service-role client, so it bypasses RLS entirely — authorization
 * lives in `reimbursementSettlementService`, never here — but the read below
 * still filters `household_id` explicitly, because a bypassed-RLS query with
 * no filter of its own reads across households.
 *
 * There is deliberately NO update and NO delete PATH. 086 gives the table no
 * `updated_at` and no trigger. The inherited `BaseRepository.update`/`delete`
 * used to be a known, accepted wart — real, callable, service-role methods
 * that RLS could not stop, with "nothing calls them" as the entire guarantee
 * (`docs/AS-BUILT-PAYMENT.md` §7 P8). They are now OVERRIDDEN TO THROW,
 * below. Unlike `payments`, this table has no correction row either: a
 * settlement recorded wrongly is a conversation, not a second write.
 *
 * @module domains/pay/repositories/reimbursementSettlementRepository
 */
import type { ReimbursementSettlement } from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { AlreadySettledError } from '../errors/payErrors';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

export class ReimbursementSettlementRepository extends BaseRepository<ReimbursementSettlement> {
  constructor() {
    super('reimbursement_settlements');
  }

  /**
   * Append-only, structurally — the twin of `paymentRepository`'s pair, and
   * for the same reason: absence of a call site is not a guard, a method that
   * throws is. Refused before any query, so the guarantee does not depend on
   * the database being reachable.
   */
  async update(
    _id: string,
    _data: Partial<ReimbursementSettlement>
  ): Promise<ReimbursementSettlement> {
    throw new Error(
      'reimbursement_settlements is append-only: 086 gives it no correction path'
    );
  }

  async delete(_id: string): Promise<void> {
    throw new Error(
      'reimbursement_settlements is append-only: 086 gives it no correction path'
    );
  }

  /**
   * Every settlement recorded against one household-local week — a LIST, not
   * a single row: a two-carer household settles two. `week_start` is matched
   * exactly rather than as a range, because a settlement's week_start IS the
   * week (086: "the household-local first day of the week these claims fall
   * in"), unlike an expense's `local_date`.
   */
  /**
   * Every settlement recorded against one household — used by the unsettled
   * aggregate to know which carer-weeks are already repaid. Household-scoped
   * only; carer narrowing lives in the service.
   */
  async listForHousehold(
    householdId: string
  ): Promise<ReimbursementSettlement[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .order('week_start', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list reimbursement settlements for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as ReimbursementSettlement[];
  }

  async listForWeek(
    householdId: string,
    weekStart: string
  ): Promise<ReimbursementSettlement[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('week_start', weekStart)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list reimbursement settlements for week',
        'DATABASE_ERROR',
        { details: error.message, householdId, weekStart }
      );
    }
    return (data ?? []) as ReimbursementSettlement[];
  }

  /**
   * Insert one settlement. A 23505 from `reimbursement_settlements_week_idx`
   * means a concurrent (or repeated) "Mark reimbursed" already settled this
   * carer-week; it becomes `AlreadySettledError` rather than a raw 500, the
   * same translation `expenseRepository.create` does for 051's index.
   */
  async create(
    data: Partial<ReimbursementSettlement>
  ): Promise<ReimbursementSettlement> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new AlreadySettledError(
          data.household_id,
          data.carer_id ?? undefined,
          data.week_start
        );
      }
      throw new DatabaseError(
        'Failed to record reimbursement settlement',
        'DATABASE_ERROR',
        { details: error.message, code: error.code }
      );
    }
    return created as ReimbursementSettlement;
  }
}
