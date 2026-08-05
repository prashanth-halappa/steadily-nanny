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

export class ExpenseRepository extends BaseRepository<Expense> {
  constructor() {
    super('expenses');
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
   */
  async reviewPending(
    expenseId: string,
    householdId: string,
    patch: ReviewPatch
  ): Promise<Expense | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update(patch)
      .eq('id', expenseId)
      .eq('household_id', householdId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to review expense', 'DATABASE_ERROR', {
        details: error.message,
        expenseId,
      });
    }
    return data as Expense | null;
  }
}
