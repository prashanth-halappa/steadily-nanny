/**
 * Reimbursement settlement repository — data access for the append-only
 * `reimbursement_settlements` table (db/schema/pay.ts, `docs/11-MONEY.md`
 * §1/§6/§8). Extends BaseRepository for `findById` and overrides `create` for
 * the one thing this table needs that the base does not: translating the
 * unique violation its index raises into a typed conflict.
 *
 * D1 has no RLS — authorization lives in `reimbursementSettlementService`,
 * never here — so the reads below filter `household_id` explicitly; a query
 * with no filter of its own reads across households.
 *
 * There is deliberately NO update and NO delete PATH. 086 gives the table no
 * `updated_at` and no trigger. The inherited `BaseRepository.update`/`delete`
 * used to be a known, accepted wart — real, callable, service-role methods
 * that nothing in the database could stop, with "nothing calls them" as the entire guarantee
 * (`docs/AS-BUILT-PAYMENT.md` §7 P8). They are now OVERRIDDEN TO THROW,
 * below. Unlike `payments`, this table has no correction row either: a
 * settlement recorded wrongly is a conversation, not a second write.
 *
 * @module domains/pay/repositories/reimbursementSettlementRepository
 */
import type { ReimbursementSettlement } from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { reimbursementSettlements } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { AlreadySettledError } from '../errors/payErrors';

export class ReimbursementSettlementRepository extends BaseRepository<
  ReimbursementSettlement,
  typeof reimbursementSettlements
> {
  constructor() {
    super(reimbursementSettlements);
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
   * Every settlement recorded against one household — used by the unsettled
   * aggregate to know which carer-weeks are already repaid. Household-scoped
   * only; carer narrowing lives in the service.
   */
  async listForHousehold(
    householdId: string
  ): Promise<ReimbursementSettlement[]> {
    try {
      const rows = await db
        .select()
        .from(reimbursementSettlements)
        .where(eq(reimbursementSettlements.household_id, householdId))
        .orderBy(
          desc(reimbursementSettlements.week_start),
          asc(reimbursementSettlements.created_at)
        );
      return rows as ReimbursementSettlement[];
    } catch (err) {
      throw this.dbError(
        'Failed to list reimbursement settlements for household',
        err,
        { householdId }
      );
    }
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
    try {
      const rows = await db
        .select()
        .from(reimbursementSettlements)
        .where(
          and(
            eq(reimbursementSettlements.household_id, householdId),
            eq(reimbursementSettlements.week_start, weekStart)
          )
        )
        .orderBy(asc(reimbursementSettlements.created_at));
      return rows as ReimbursementSettlement[];
    } catch (err) {
      throw this.dbError(
        'Failed to list reimbursement settlements for week',
        err,
        { householdId, weekStart }
      );
    }
  }

  /**
   * Insert one settlement. A unique violation (the table's only non-pkey
   * unique is `reimbursement_settlements_week_idx`) means a concurrent (or
   * repeated) "Mark reimbursed" already settled this carer-week; it becomes
   * `AlreadySettledError` rather than a raw 500, the same translation
   * `expenseRepository.create` does for 051's index.
   */
  async create(
    data: Partial<ReimbursementSettlement>
  ): Promise<ReimbursementSettlement> {
    try {
      const [created] = await db
        .insert(reimbursementSettlements)
        .values(data as typeof reimbursementSettlements.$inferInsert)
        .returning();
      return created as ReimbursementSettlement;
    } catch (err) {
      if (mapDbError(err)?.kind === 'unique') {
        throw new AlreadySettledError(
          data.household_id,
          data.carer_id ?? undefined,
          data.week_start
        );
      }
      throw this.dbError('Failed to record reimbursement settlement', err, {
        operation: 'create',
      });
    }
  }
}
