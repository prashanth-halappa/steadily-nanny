/**
 * Expense repository — data access for the mutable `expenses` table
 * (supabase/migrations/044_expenses.sql; `docs/11-MONEY.md` §6, §8, §9).
 * Extends BaseRepository for `create`/`findById` and adds the domain
 * queries plus three GUARDED writes. There is no RLS behind D1 — authorization and business gating live in the
 * SERVICE layer, never here, but every query below still filters
 * `household_id` explicitly (and the write methods filter `carer_id`/
 * `status` too), because a bypassed-RLS query with no filter of its own
 * would read or write across households.
 *
 * `expenses` is the one Tier 0 money table that is genuinely mutated after
 * insert (a `pending` row moves to `approved`/`rejected`), so — unlike
 * `pay_arrangements`/`pto_ledger` — this repository DOES carry update/delete
 * paths. Both are GUARDED conditional writes (`status = 'pending'`, plus an
 * ownership filter), the same discipline as
 * `timesheetRepository.approveSubmittedWithEarnings`: the guard lives in the
 * WHERE clause of the write itself, not just in a pre-check the service does
 * first, so a race that flips the row between the service's read and this
 * write cannot silently succeed. A guard miss returns `null` (update) or
 * `false` (delete) rather than throwing — the service translates that into
 * `ExpenseNotEditableError`.
 *
 * @module domains/pay/repositories/expenseRepository
 */
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { and, asc, eq, gte, lt, notExists, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { expenses, timesheets } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { DuplicatePendingClaimError } from '../errors/payErrors';

/** The five columns a review write ever sets — never a blind `Partial<Expense>`. */
export interface ReviewPatch {
  status: 'approved' | 'rejected';
  reviewed_by: string;
  reviewed_at: string;
  review_note: string | null;
  /**
   * Present ONLY on a mileage approval — the computed-and-frozen amount,
   * written in the SAME update as the status flip (`docs/11-MONEY.md` §3).
   * Absent on an expense-row approval (its amount was already fixed at
   * submission) and on every rejection.
   */
  amount_minor?: number;
}

/**
 * The week whose timesheet the review write must lock and find un-frozen
 * before it commits (migration 051). `null` means "no week to lock": a
 * REJECTION moves no money into the week, and a carer-less row (033's
 * account-deletion discipline) has no week to strand money in.
 */
export interface ExpenseWeekLock {
  carerId: string;
  weekStart: string;
}

/**
 * What `review_pending_expense` answers with. Three outcomes, because the two
 * ways a review can fail need DIFFERENT errors: losing the status CAS is
 * `ExpenseNotEditableError`, while the week freezing under the write is
 * `ExpenseWeekLockedError` (which names the week so the client can say which).
 */
export type ReviewOutcome =
  | { outcome: 'reviewed'; expense: Expense }
  | { outcome: 'not_pending' }
  | { outcome: 'week_locked'; weekStart: string; timesheetStatus: string };

const asExpense = (row: unknown) => row as Expense;
const asExpenses = (rows: unknown[]) => rows as Expense[];

export class ExpenseRepository extends BaseRepository<
  Expense,
  typeof expenses
> {
  constructor() {
    super(expenses);
  }

  /**
   * Submit a claim, translating the `expenses_one_pending_claim_idx` unique
   * violation (051) into a typed error instead of a raw 500.
   *
   * The index is PARTIAL on `status = 'pending'` and keyed on the claim's own
   * identity (household, carer, date, kind, description, currency, amount or
   * miles), so what this catches is a DOUBLE-TAPPED submission — the same
   * claim filed twice before either is reviewed, which a parent approving both
   * would pay twice. The identity frees up as soon as the first is reviewed.
   *
   * RETURNING does not see the AFTER-INSERT `household_member_id` stamp, so
   * the returned row carries that column as passed (MIGRATION-NOTES §3).
   */
  async create(data: Partial<Expense>): Promise<Expense> {
    try {
      const [row] = await db
        .insert(expenses)
        .values(data as typeof expenses.$inferInsert)
        .returning();
      return asExpense(row);
    } catch (err) {
      if (mapDbError(err)?.kind === 'unique') {
        throw new DuplicatePendingClaimError({
          householdId: data.household_id,
          carerId: data.carer_id,
          localDate: data.local_date,
        });
      }
      throw this.dbError('Failed to create', err, { operation: 'create' });
    }
  }

  /**
   * A household's expenses (every status) for `[weekStart,
   * weekEndExclusive)` local dates — the raw material for both the carer's
   * "my claims this week" view and the parent's week view. Status
   * visibility is the SERVICE's job, not this query's.
   */
  async listForWeek(
    householdId: string,
    weekStart: string,
    weekEndExclusive: string
  ): Promise<Expense[]> {
    try {
      return asExpenses(
        await db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.household_id, householdId),
              gte(expenses.local_date, weekStart),
              lt(expenses.local_date, weekEndExclusive)
            )
          )
          .orderBy(asc(expenses.local_date), asc(expenses.created_at))
      );
    } catch (err) {
      throw this.dbError('Failed to list week of', err, {
        householdId,
        weekStart,
      });
    }
  }

  /** A household's pending claims, oldest-submitted first — the review queue. */
  async listPending(householdId: string): Promise<Expense[]> {
    try {
      return asExpenses(
        await db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.household_id, householdId),
              eq(expenses.status, 'pending')
            )
          )
          .orderBy(asc(expenses.created_at))
      );
    } catch (err) {
      throw this.dbError('Failed to list pending', err, { householdId });
    }
  }

  /**
   * Every APPROVED claim in a household — the unsettled-reimbursement aggregate
   * folds these by carer and household-local week. Household-scoped only;
   * carer narrowing lives in the service (`assertPayrollReader` scope).
   */
  async listApprovedForHousehold(householdId: string): Promise<Expense[]> {
    try {
      return asExpenses(
        await db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.household_id, householdId),
              eq(expenses.status, 'approved')
            )
          )
          .orderBy(asc(expenses.local_date))
      );
    } catch (err) {
      throw this.dbError('Failed to list approved', err, { householdId });
    }
  }

  /**
   * A household's APPROVED claims for `[weekStart, weekEndExclusive)` —
   * the reimbursement section's source rows (`docs/11-MONEY.md` §6): a
   * household-scoped fetch the caller narrows to one carer in process.
   */
  async listApprovedForWeek(
    householdId: string,
    weekStart: string,
    weekEndExclusive: string
  ): Promise<Expense[]> {
    try {
      return asExpenses(
        await db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.household_id, householdId),
              eq(expenses.status, 'approved'),
              gte(expenses.local_date, weekStart),
              lt(expenses.local_date, weekEndExclusive)
            )
          )
          .orderBy(asc(expenses.local_date))
      );
    } catch (err) {
      throw this.dbError('Failed to list approved week of', err, {
        householdId,
        weekStart,
      });
    }
  }

  /**
   * The carer's pending-expense correction path (migration 044's header,
   * review finding 18). Guarded by `household_id`, `carer_id`, AND
   * `status = 'pending'` in the update's own WHERE clause — a mismatch on
   * any of the three returns `null` rather than touching a row it shouldn't.
   * `updated_at` is written explicitly so the returned row carries it
   * (RETURNING cannot see the trigger's stamp).
   */
  async updateOwnedPending(
    expenseId: string,
    householdId: string,
    carerId: string,
    patch: Partial<Expense>
  ): Promise<Expense | null> {
    try {
      const [row] = await db
        .update(expenses)
        .set({
          ...(patch as Partial<typeof expenses.$inferInsert>),
          updated_at: new Date().toISOString(),
        })
        .where(
          and(
            eq(expenses.id, expenseId),
            eq(expenses.household_id, householdId),
            eq(expenses.carer_id, carerId),
            eq(expenses.status, 'pending')
          )
        )
        .returning();
      return row ? asExpense(row) : null;
    } catch (err) {
      throw this.dbError('Failed to update', err, { expenseId });
    }
  }

  /**
   * Withdraw — a hard delete of the carer's own still-pending row (nothing
   * downstream references it, migration 044's header). Same three-way guard
   * as `updateOwnedPending`. Returns `true` only when a row actually matched
   * and was removed.
   */
  async deleteOwnedPending(
    expenseId: string,
    householdId: string,
    carerId: string
  ): Promise<boolean> {
    try {
      const rows = await db
        .delete(expenses)
        .where(
          and(
            eq(expenses.id, expenseId),
            eq(expenses.household_id, householdId),
            eq(expenses.carer_id, carerId),
            eq(expenses.status, 'pending')
          )
        )
        .returning({ id: expenses.id });
      return rows.length > 0;
    } catch (err) {
      throw this.dbError('Failed to withdraw', err, { expenseId });
    }
  }

  /**
   * The parent's review write — approve or reject, guarded by `household_id`
   * AND `status = 'pending'` (no `carer_id` filter: any active parent of the
   * household may review any carer's claim). On a mileage approval,
   * `patch.amount_minor` freezes the computed amount in the SAME statement as
   * the status flip, so no reader can observe `approved` with a stale amount.
   *
   * THE FREEZE GUARD BELONGS IN THE WRITE (051, audit finding F-B4-1;
   * MIGRATION-NOTES §5.4). The service pre-checks whether the week's
   * timesheet is approved, but a pre-check is a plain read: a timesheet
   * approve landing between it and this write would freeze a week's earnings
   * without this reimbursement — money owed and on no statement. So the
   * expense UPDATE itself carries `NOT EXISTS (approved timesheet for this
   * week)`, and is batched with a bump of that timesheet's `updated_at`
   * (gated on the review having landed) so an in-flight approve loses its own
   * `updated_at` CAS and recomputes. `weekLock: null` skips both — see
   * `ExpenseWeekLock`.
   *
   * Zero rows reviewed: re-read to answer `week_locked` (checked first, as
   * the RPC did) or `not_pending`.
   */
  async reviewPending(
    expenseId: string,
    householdId: string,
    patch: ReviewPatch,
    weekLock: ExpenseWeekLock | null
  ): Promise<ReviewOutcome> {
    const weekTimesheet = (lock: ExpenseWeekLock) =>
      and(
        eq(timesheets.household_id, householdId),
        eq(timesheets.carer_id, lock.carerId),
        eq(timesheets.week_start, lock.weekStart)
      );
    const now = new Date().toISOString();

    try {
      const review = db
        .update(expenses)
        .set({
          status: patch.status,
          reviewed_by: patch.reviewed_by,
          reviewed_at: patch.reviewed_at,
          review_note: patch.review_note,
          // Only a mileage approval computes one; otherwise keep the column.
          ...(patch.amount_minor !== undefined
            ? { amount_minor: patch.amount_minor }
            : {}),
          updated_at: now,
        })
        .where(
          and(
            eq(expenses.id, expenseId),
            eq(expenses.household_id, householdId),
            eq(expenses.status, 'pending'),
            weekLock
              ? notExists(
                  db
                    .select({ one: sql`1` })
                    .from(timesheets)
                    .where(
                      and(
                        weekTimesheet(weekLock),
                        eq(timesheets.status, 'approved')
                      )
                    )
                )
              : undefined
          )
        )
        .returning();

      let reviewed: unknown[];
      if (weekLock) {
        const bump = db
          .update(timesheets)
          .set({ updated_at: now })
          .where(
            and(
              weekTimesheet(weekLock),
              sql`EXISTS (SELECT 1 FROM expenses WHERE id = ${expenseId} AND status = ${patch.status} AND reviewed_by = ${patch.reviewed_by} AND reviewed_at = ${patch.reviewed_at})`
            )
          );
        [reviewed] = await db.batch([review, bump]);
      } else {
        reviewed = await review;
      }
      if (reviewed[0]) {
        return { outcome: 'reviewed', expense: asExpense(reviewed[0]) };
      }

      if (weekLock) {
        const [week] = await db
          .select({ status: timesheets.status })
          .from(timesheets)
          .where(weekTimesheet(weekLock));
        if (week?.status === 'approved') {
          return {
            outcome: 'week_locked',
            weekStart: weekLock.weekStart,
            timesheetStatus: week.status,
          };
        }
      }
      return { outcome: 'not_pending' };
    } catch (err) {
      throw this.dbError('Failed to review', err, { expenseId });
    }
  }
}
