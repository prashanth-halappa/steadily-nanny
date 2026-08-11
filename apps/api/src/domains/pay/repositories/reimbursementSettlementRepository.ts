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
 * There is deliberately NO update and NO delete helper. 086 gives the table no
 * `updated_at` and no trigger, and immutability in this stack is the ABSENCE
 * of a write path rather than a database rule. Inheriting
 * `BaseRepository.update`/`delete` is the same known, accepted wart
 * `paymentRepository` documents: nothing in the domain calls them and nothing
 * should start.
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
   * Every settlement recorded against one household-local week — a LIST, not
   * a single row: a two-carer household settles two. `week_start` is matched
   * exactly rather than as a range, because a settlement's week_start IS the
   * week (086: "the household-local first day of the week these claims fall
   * in"), unlike an expense's `local_date`.
   */
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
