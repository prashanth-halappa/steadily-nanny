/**
 * Pay domain errors.
 * @module domains/pay/errors/payErrors
 */
import { ConflictError, NotFoundError, ValidationError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the pay arrangements of this (household, carer) pair are not the
 * caller's to see or write. ONE error for every failing case, deliberately:
 *
 * - the household doesn't exist, or the caller isn't an active member of it;
 * - the caller is a member but a `helper` (no pay access at all), or a nanny
 *   asking about somebody else's terms;
 * - the `carer_id` names nobody, somebody who is not an active member, or an
 *   active member who is not a `nanny` of THIS household.
 *
 * Collapsing them is the house convention (`HouseholdNotFoundError`,
 * `TimesheetNotFoundError`) and it is load-bearing here: a distinguishable
 * "that carer exists, just not for you" would let a caller enumerate other
 * families' carers by uuid. Discriminating detail goes in `metadata.reason`,
 * which BaseError only ships to the client for 4xx — see `toClientJSON`.
 */
export class PayArrangementNotFoundError extends NotFoundError {
  constructor(householdId: string, carerId: string, metadata?: ErrorMetadata) {
    super('Pay arrangement not found', 'PAY_ARRANGEMENT_NOT_FOUND', {
      householdId,
      carerId,
      ...metadata,
    });
    this.name = 'PayArrangementNotFoundError';
  }
}

/**
 * 400 — the submitted terms cannot describe a real agreement. Currently one
 * arm: `valid_from` after the household's local today. There are no
 * future-dated arrangements in v1 (owner decision 4) — a raise is recorded on
 * or after the day it starts, and backdating stays legal so an open week
 * recomputes.
 *
 * Shaped like `InvalidClockTimesError` (a `ValidationError` carrying a
 * machine-readable `reason`) rather than a bespoke 4xx, so the client can
 * branch on the reason without string-matching a message.
 */
export class PayArrangementValidationError extends ValidationError {
  constructor(reason: string, metadata?: ErrorMetadata) {
    super('Those pay terms are not valid', reason, 400, metadata);
    this.name = 'PayArrangementValidationError';
  }
}

// =============================================================================
// Expenses & mileage (TIER0-PLAN.md Phase 4, docs/11-MONEY.md §6/§8/§9)
// =============================================================================

/**
 * 404 — the expense does not exist, or is not the caller's to see or write.
 * ONE error for every failing case (same discipline as
 * `PayArrangementNotFoundError`/`TimesheetNotFoundError`):
 *
 * - the household doesn't exist, or the caller isn't an active member of it;
 * - the caller is a `helper`, or a nanny asking about another carer's row;
 * - a create/update/withdraw targets a row that isn't the caller's own
 *   (D12-class: `carer_id`/`household_id` on an expense write get the same
 *   membership assertion as a pay-arrangement `carer_id`, docs/11-MONEY.md
 *   §9);
 * - the caller submitting a create isn't an active `nanny` member of this
 *   household at all.
 *
 * Discriminating detail goes in `metadata.reason`, never the message — a
 * distinguishable "that expense exists, just not yours" would let a caller
 * enumerate other households' claims by uuid.
 */
export class ExpenseNotFoundError extends NotFoundError {
  constructor(expenseOrHouseholdId: string, metadata?: ErrorMetadata) {
    super('Expense not found', 'EXPENSE_NOT_FOUND', {
      id: expenseOrHouseholdId,
      ...metadata,
    });
    this.name = 'ExpenseNotFoundError';
  }
}

/**
 * 400 — the submitted expense/mileage claim, or its review, cannot be
 * written as-is. Reasons in `metadata.reason` include:
 * - `CURRENCY_MISMATCH` — the claim's currency doesn't match the carer's
 *   effective pay-arrangement currency on `local_date` (docs/11-MONEY.md §9,
 *   TIER0-PLAN.md Phase 4);
 * - `NO_MILEAGE_RATE` — a mileage row is being approved but the arrangement
 *   effective on `local_date` has no `mileage_rate_per_mile_minor` set; the
 *   review is refused rather than approved at £0.00 (docs/11-MONEY.md §4's
 *   no-arrangement-no-zero rule, applied to mileage pricing).
 *
 * Shaped like `PayArrangementValidationError` — a `ValidationError` carrying
 * a machine-readable `reason` — so the client can branch without
 * string-matching a message.
 */
export class ExpenseValidationError extends ValidationError {
  constructor(reason: string, metadata?: ErrorMetadata) {
    super('That expense claim is not valid', reason, 400, metadata);
    this.name = 'ExpenseValidationError';
  }
}

/**
 * 400 — the amount this approval WORKED OUT TO is larger than any amount this
 * system can record (`MAX_MONEY_MINOR`, migration 063's cap).
 *
 * WHY THIS IS NOT AN `ExpenseValidationError`: nothing the carer submitted is
 * invalid. `miles` is legal, the arrangement's `mileage_rate_per_mile_minor`
 * is legal — capping each INPUT never capped their PRODUCT (the
 * caps-don't-bound-products class, adversarial review REOPEN). This names the
 * one thing that actually went wrong, and its message says so in words a
 * parent tapping Approve can act on, rather than implying she was sent a bad
 * claim.
 *
 * A `ValidationError` (400) and not a 409: retrying changes nothing, so this
 * is not a race or a lost update — the request as stated cannot be satisfied.
 * `metadata` carries the computed amount and the cap so the refusal can be
 * diagnosed without re-deriving the arithmetic.
 *
 * THE AMOUNT IS NEVER CLAMPED TO FIT. `docs/11-MONEY.md` §1: a trimmed
 * reimbursement is a wrong number wearing the right label, and it would be
 * paid. Refusing is the only honest option.
 */
export class ExpenseAmountTooLargeError extends ValidationError {
  constructor(expenseId: string, amountMinor: number, maxMinor: number) {
    super(
      'That claim works out to more than the largest amount we can record',
      'EXPENSE_AMOUNT_TOO_LARGE',
      400,
      { expenseId, amountMinor, maxMinor }
    );
    this.name = 'ExpenseAmountTooLargeError';
  }
}

/**
 * 409 — the expense can no longer be changed the way this request asks.
 * Covers two related but distinct situations, both in `metadata.reason`:
 * - `already_reviewed` — a carer tried to edit or withdraw a row a parent
 *   has already approved or rejected. Migration 044's header: "once a
 *   parent reviews it ... the row is immutable; a mistake discovered after
 *   approval is corrected through the parent's `manual_adjustment` escape
 *   hatch, never by mutating this row."
 * - `not_pending` — a parent tried to review a row that isn't (or is no
 *   longer) `pending` — either it was already reviewed, or a concurrent
 *   review won the race between this request's read and its write (the same
 *   lost-race shape as `TimesheetNotActionableError`).
 */
export class ExpenseNotEditableError extends ConflictError {
  constructor(expenseId: string, reason: string) {
    super('This expense can no longer be changed', 'EXPENSE_NOT_EDITABLE', {
      expenseId,
      reason,
    });
    this.name = 'ExpenseNotEditableError';
  }
}

/**
 * 409 — the claim is dated inside a week whose timesheet is already
 * `approved`, so APPROVING it would strand the money (Phase 3/4 review,
 * SERIOUS 6).
 *
 * An approved week's `earnings` snapshot — reimbursement section included —
 * is frozen and never recomputed (`docs/11-MONEY.md` §3). An expense approved
 * after that freeze exists on the row and appears on NO statement: real money
 * the nanny is owed, invisible to both parties. The alternative, silently
 * re-opening the week, is refused deliberately: only new HOURS reopen an
 * approved week (§3, the D1 path), and reimbursements are not wages (§6) — a
 * non-wage item must not be able to un-approve a payroll week both sides
 * signed off.
 *
 * REJECTING a claim in a frozen week is still allowed: it moves no money, so
 * the parent always has an action. `metadata` names the week and the
 * timesheet's status so the client can say WHICH week is locked.
 */
export class ExpenseWeekLockedError extends ConflictError {
  constructor(
    expenseId: string,
    householdId: string,
    weekStart: string,
    timesheetStatus: string
  ) {
    super(
      'That week has already been approved, so this claim cannot be approved into it',
      'EXPENSE_WEEK_LOCKED',
      { expenseId, householdId, weekStart, timesheetStatus }
    );
    this.name = 'ExpenseWeekLockedError';
  }
}

// =============================================================================
// PTO ledger (TIER0-PLAN.md Phase 3, docs/11-MONEY.md §5/§8/§9)
// =============================================================================

/**
 * 404 — the PTO ledger/balance of this (household, carer) pair is not the
 * caller's to see. Mirrors `PayArrangementNotFoundError`'s read-gate table
 * EXACTLY — migration 043's RLS section reproduces 041's select policy
 * character-for-character, and `ptoQueryService.assertCanReadPto` mirrors
 * `payArrangementQueryService`'s private gate for the same reason: parents
 * and owners, plus the carer reading her OWN balance/ledger; helpers and
 * other carers are denied. ONE error for every failing case — missing
 * household, non-member caller, wrong role, wrong carer — so a caller learns
 * nothing about carers who aren't hers.
 */
export class PtoNotFoundError extends NotFoundError {
  constructor(householdId: string, carerId: string, metadata?: ErrorMetadata) {
    super('PTO ledger not found', 'PTO_NOT_FOUND', {
      householdId,
      carerId,
      ...metadata,
    });
    this.name = 'PtoNotFoundError';
  }
}

/**
 * 404 — the D12-class collapse for `markTimeOffPaid`'s client-supplied
 * `time_off_id`: the id names no time off at all, OR its `user_id` is not an
 * ACTIVE `nanny` member of THIS household. ONE error for both, same
 * reasoning as `PayArrangementNotFoundError`'s carer collapse — a caller
 * must not be able to tell "no such time off" apart from "that's not your
 * carer's time off" (docs/11-MONEY.md §9).
 */
export class PtoTimeOffNotFoundError extends NotFoundError {
  constructor(
    householdId: string,
    timeOffId: string,
    metadata?: ErrorMetadata
  ) {
    super('Time off not found', 'PTO_TIME_OFF_NOT_FOUND', {
      householdId,
      timeOffId,
      ...metadata,
    });
    this.name = 'PtoTimeOffNotFoundError';
  }
}

/**
 * 400 — only `confirmed` time off is markable (TIER0-PLAN.md Phase 3, review
 * finding 9). `requested` hasn't been confirmed yet and may never happen;
 * `cancelled` didn't happen at all — paying either would create a `usage`
 * row backed by nothing real.
 */
export class PtoTimeOffNotConfirmedError extends ValidationError {
  constructor(timeOffId: string, status: string) {
    super(
      'Only confirmed time off can be marked paid',
      'TIME_OFF_NOT_CONFIRMED',
      400,
      { timeOffId, status }
    );
    this.name = 'PtoTimeOffNotConfirmedError';
  }
}

/**
 * 409 — translated from the `pto_ledger_one_usage_per_time_off_day_idx`
 * partial unique index (23505; 043's header as amended by migration 045):
 * this DAY of this time off is ALREADY marked paid in this household. Two
 * concurrent "Mark as paid" taps race the database, not the service's
 * find-first check, into being the source of truth under a race — this is
 * that race surfaced as a typed error instead of a raw 500.
 *
 * A SEQUENTIAL retry never reaches this: by then the first attempt's rows
 * are visible and `markTimeOffPaid` takes its delta path instead (review
 * BLOCKER 3). Only genuinely simultaneous first marks collide.
 */
export class PtoAlreadyMarkedPaidError extends ConflictError {
  constructor(householdId: string, timeOffId: string) {
    super(
      'This time off is already marked as paid',
      'PTO_ALREADY_MARKED_PAID',
      { householdId, timeOffId }
    );
    this.name = 'PtoAlreadyMarkedPaidError';
  }
}

/**
 * 400 — a mark-paid request asked for ZERO minutes on a time off this
 * household has never marked paid (Phase 3/4 review, BLOCKER 3).
 *
 * The request states the TOTAL minutes this household is paying, so zero
 * means "unpay it entirely" — a full reversal of the netted total. With
 * nothing marked there is no total to reverse and nothing to record: the
 * ledger is append-only and forbids zero-minute rows
 * (`check (minutes <> 0)`), so inventing a row would be a lie and returning
 * one is impossible. It is refused with the same 400 the wire schema used to
 * give a zero-minute request, so no client behaviour changes.
 */
export class PtoNothingToAdjustError extends ValidationError {
  constructor(householdId: string, timeOffId: string) {
    super(
      'This time off has not been marked paid, so there is nothing to adjust',
      'PTO_NOTHING_TO_ADJUST',
      400,
      { householdId, timeOffId }
    );
    this.name = 'PtoNothingToAdjustError';
  }
}

/**
 * 409, INTERNAL — translated from the `pto_ledger_one_accrual_per_year_idx`
 * partial unique index (23505, 043's header): a concurrent reader raced this
 * one to the lazy annual grant. `ptoQueryService`'s `balance`/`ledger` catch
 * this and re-read the winner's row rather than erroring — "the loser's
 * insert raises 23505 instead of double-granting a year's entitlement, and
 * the service re-fetches the winner" (043's header, verbatim). Callers
 * outside that one catch site should never see this error.
 */
export class PtoAccrualGrantRaceError extends ConflictError {
  constructor(householdId: string, carerId: string, effectiveDate: string) {
    super('PTO accrual already granted for this year', 'PTO_ACCRUAL_RACE', {
      householdId,
      carerId,
      effectiveDate,
    });
    this.name = 'PtoAccrualGrantRaceError';
  }
}
