/**
 * Expense repository — data access for the mutable `expenses` table
 * (supabase/migrations/044_expenses.sql; `docs/11-MONEY.md` §6, §8, §9).
 * Extends BaseRepository for `create`/`findById` and adds the domain
 * queries plus three GUARDED writes. Uses the service-role client, so it
 * bypasses RLS entirely — authorization and business gating live in the
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
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { DuplicatePendingClaimError } from '../errors/payErrors';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

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

/** The raw jsonb shape 051's function returns. */
interface ReviewRpcPayload {
  outcome: 'reviewed' | 'not_pending' | 'week_locked';
  expense?: Expense;
  week_start?: string;
  timesheet_status?: string;
}

export class ExpenseRepository extends BaseRepository<Expense> {
  constructor() {
    super('expenses');
  }

  /**
   * Submit a claim, translating the `expenses_one_pending_claim_idx` unique
   * violation (051) into a typed error instead of a raw 500 — the same shape
   * `ptoLedgerRepository.create` and `householdMemberRepository.
   * createMembership` use.
   *
   * The index is PARTIAL on `status = 'pending'` and keyed on the claim's own
   * identity (household, carer, date, kind, description, currency, amount or
   * miles), so what this catches is a DOUBLE-TAPPED submission — the same
   * claim filed twice before either is reviewed, which a parent approving both
   * would pay twice. A carer filing a genuinely separate identical claim tells
   * them apart with a word in the description, and the identity frees up
   * entirely as soon as the first one is reviewed (051's header).
   */
  async create(data: Partial<Expense>): Promise<Expense> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new DuplicatePendingClaimError({
          householdId: data.household_id,
          carerId: data.carer_id,
          localDate: data.local_date,
        });
      }
      throw new DatabaseError('Failed to create expense', 'DATABASE_ERROR', {
        details: error.message,
        code: error.code,
      });
    }
    return created as Expense;
  }

  /**
   * A household's expenses (every status) for `[weekStart,
   * weekEndExclusive)` local dates — the raw material for both the carer's
   * "my claims this week" view and the parent's week view. Status
   * visibility is the SERVICE's job, not this query's; a helper's read gate
   * denies her before this ever runs.
   */
  async listForWeek(
    householdId: string,
    weekStart: string,
    weekEndExclusive: string
  ): Promise<Expense[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .gte('local_date', weekStart)
      .lt('local_date', weekEndExclusive)
      .order('local_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list expenses for week',
        'DATABASE_ERROR',
        { details: error.message, householdId, weekStart }
      );
    }
    return (data ?? []) as Expense[];
  }

  /**
   * A household's pending claims, oldest-submitted first — the parent's
   * review queue. `expenses_carer_status_idx` (household id is not part of
   * that index; `expenses_household_date_idx` covers the household half of
   * this pattern well enough at Tier 0 volumes) serves the `status`
   * predicate.
   */
  async listPending(householdId: string): Promise<Expense[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list pending expenses',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as Expense[];
  }

  /**
   * A household's APPROVED claims for `[weekStart, weekEndExclusive)` —
   * the reimbursement section's source rows (`docs/11-MONEY.md` §6). Named
   * and shaped for the earnings wrapper to consume directly, the same way
   * `weekEarningsService` consumes `payArrangementRepository.listForCarer`:
   * a household-scoped fetch the caller narrows to one carer in process.
   */
  /**
   * Every APPROVED claim in a household — the unsettled-reimbursement aggregate
   * folds these by carer and household-local week. Household-scoped only;
   * carer narrowing lives in the service (`assertPayrollReader` scope).
   */
  async listApprovedForHousehold(householdId: string): Promise<Expense[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'approved')
      .order('local_date', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list approved expenses for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as Expense[];
  }

  async listApprovedForWeek(
    householdId: string,
    weekStart: string,
    weekEndExclusive: string
  ): Promise<Expense[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'approved')
      .gte('local_date', weekStart)
      .lt('local_date', weekEndExclusive)
      .order('local_date', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list approved expenses for week',
        'DATABASE_ERROR',
        { details: error.message, householdId, weekStart }
      );
    }
    return (data ?? []) as Expense[];
  }

  /**
   * The carer's pending-expense correction path (migration 044's header,
   * review finding 18). Guarded by `household_id`, `carer_id`, AND
   * `status = 'pending'` in the update's own WHERE clause — a mismatch on
   * any of the three (wrong household, another carer's row, or a row a
   * parent reviewed between the service's read and this write) returns
   * `null` rather than touching a row it shouldn't.
   */
  async updateOwnedPending(
    expenseId: string,
    householdId: string,
    carerId: string,
    patch: Partial<Expense>
  ): Promise<Expense | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update(patch)
      .eq('id', expenseId)
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to update expense', 'DATABASE_ERROR', {
        details: error.message,
        expenseId,
      });
    }
    return data as Expense | null;
  }

  /**
   * Withdraw — a hard delete of the carer's own still-pending row (nothing
   * downstream references it, migration 044's header). Same three-way guard
   * as `updateOwnedPending`. Returns `true` only when a row actually
   * matched and was removed, so the service can tell "withdrawn" apart from
   * "not yours / already reviewed" without a second read.
   */
  async deleteOwnedPending(
    expenseId: string,
    householdId: string,
    carerId: string
  ): Promise<boolean> {
    const { data, error } = await supabaseService
      .from(this.table)
      .delete()
      .eq('id', expenseId)
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .eq('status', 'pending')
      .select('id');

    if (error) {
      throw new DatabaseError('Failed to withdraw expense', 'DATABASE_ERROR', {
        details: error.message,
        expenseId,
      });
    }
    return (data ?? []).length > 0;
  }

  /**
   * The parent's review write — approve or reject, guarded by `household_id`
   * AND `status = 'pending'` (no `carer_id` filter: any active parent of the
   * household may review any carer's claim, unlike the carer-only
   * `updateOwnedPending`). On a mileage approval, `patch.amount_minor`
   * freezes the computed amount in the SAME statement as the status flip —
   * there is no separate "then set the amount" write, so no reader can ever
   * observe `status = 'approved'` with a stale or absent amount.
   *
   * IT GOES THROUGH AN RPC BECAUSE THE FREEZE GUARD BELONGS IN THE WRITE
   * (migration 051, audit finding F-B4-1). The service still pre-checks
   * whether the week's timesheet is approved, but a pre-check is a plain read:
   * a timesheet approve landing between it and this write froze a week's
   * earnings without this reimbursement while this CAS — which knew nothing
   * about timesheets — still matched `pending` and committed. That is money
   * owed and on no statement (`docs/11-MONEY.md` §3). `review_pending_expense`
   * locks the week's timesheet row FOR UPDATE first, refuses if it is already
   * approved, and bumps its `updated_at` on success so an in-flight approve
   * loses its own CAS and recomputes. Passing `weekLock: null` skips all of
   * that — see `ExpenseWeekLock`.
   */
  async reviewPending(
    expenseId: string,
    householdId: string,
    patch: ReviewPatch,
    weekLock: ExpenseWeekLock | null
  ): Promise<ReviewOutcome> {
    const { data, error } = await supabaseService.rpc(
      'review_pending_expense',
      {
        p_expense_id: expenseId,
        p_household_id: householdId,
        p_status: patch.status,
        p_reviewed_by: patch.reviewed_by,
        p_reviewed_at: patch.reviewed_at,
        p_review_note: patch.review_note,
        // Only a mileage approval computes one; null means "leave the column
        // as it stands", which is what 051's `coalesce` does with it.
        p_amount_minor: patch.amount_minor ?? null,
        p_carer_id: weekLock?.carerId ?? null,
        p_week_start: weekLock?.weekStart ?? null,
      }
    );

    if (error) {
      throw new DatabaseError('Failed to review expense', 'DATABASE_ERROR', {
        details: error.message,
        expenseId,
      });
    }

    const payload = data as ReviewRpcPayload;
    if (payload.outcome === 'reviewed' && payload.expense) {
      return { outcome: 'reviewed', expense: payload.expense };
    }
    if (payload.outcome === 'week_locked') {
      return {
        outcome: 'week_locked',
        weekStart: payload.week_start ?? weekLock?.weekStart ?? '',
        timesheetStatus: payload.timesheet_status ?? 'approved',
      };
    }
    return { outcome: 'not_pending' };
  }
}
