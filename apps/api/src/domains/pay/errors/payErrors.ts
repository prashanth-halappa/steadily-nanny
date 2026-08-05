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
 * 409 — translated from the `pto_ledger_one_usage_per_time_off_idx` partial
 * unique index (23505, 043's header): this exact time off is ALREADY marked
 * paid in this household. Two concurrent "Mark as paid" taps race the
 * database, not the service's find-first check, into being the source of
 * truth under a race — this is that race surfaced as a typed error instead
 * of a raw 500.
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
