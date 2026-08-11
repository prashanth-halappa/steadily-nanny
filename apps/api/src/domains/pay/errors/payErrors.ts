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
 * 409 — translated from the `expenses_one_pending_claim_idx` partial unique
 * index (migration 051): this EXACT claim is already sitting unreviewed in
 * this household. A double-tapped submit, in other words — two identical
 * pending rows a parent approving both would pay twice.
 *
 * A CONFLICT and not an `ExpenseValidationError` (400), which is what this
 * used to be: nothing the carer typed is wrong. The claim is well-formed and
 * would be accepted on its own; it is refused only because an identical one
 * got there first, which is a state collision, the same shape as
 * `ExpenseNotEditableError` and `PtoAlreadyMarkedPaidError`. A 400 told the
 * carer to check what she entered, and there was nothing to fix.
 *
 * The `DUPLICATE_PENDING_CLAIM` discriminator is unchanged and still rides in
 * `metadata.reason`, so anything branching on it keeps working.
 */
export class DuplicatePendingClaimError extends ConflictError {
  constructor(metadata?: ErrorMetadata) {
    super(
      'You have already submitted this claim and it is still awaiting review',
      'DUPLICATE_PENDING_CLAIM',
      metadata
    );
    this.name = 'DuplicatePendingClaimError';
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

// =============================================================================
// Payments — the settlement ledger (migration 067, docs/11-MONEY.md §1/§3/§8)
// =============================================================================

/**
 * 404 — the week's payments are not the caller's to see or write. ONE error
 * for every failing case, the same discipline as
 * `PayArrangementNotFoundError`/`TimesheetNotFoundError`:
 *
 * - no timesheet with that id exists;
 * - the caller is not a member of its household at all;
 * - the caller is a `helper`, or a nanny asking about a week that is not
 *   hers.
 *
 * A distinguishable "that week exists, just not for you" would let a caller
 * enumerate other families' timesheets by uuid, and a timesheet id is the
 * handle on a real household's payroll. Discriminating detail goes in
 * `metadata.reason`, which `BaseError.toClientJSON` only ships for 4xx.
 *
 * NOTE the asymmetry with the role gate below: a caller who IS an active
 * member but holds the wrong role gets the 403
 * `NotAHouseholdParentError` instead, exactly as
 * `payArrangementCommandService` and `timesheetCommandService.approve` do —
 * she already knows the household and the week exist, so there is nothing
 * left to leak, and "you are not a parent" is the actionable message.
 */
export class PaymentNotFoundError extends NotFoundError {
  constructor(timesheetId: string, metadata?: ErrorMetadata) {
    super('Payments not found', 'PAYMENT_NOT_FOUND', {
      timesheetId,
      ...metadata,
    });
    this.name = 'PaymentNotFoundError';
  }
}

/**
 * 409 — the week cannot be paid against yet. Two arms, both in
 * `metadata.reason`:
 *
 * - `week_not_approved` — the timesheet is `open`/`submitted`/`queried`.
 *   There is no settled figure yet: the amount on screen is still
 *   "Estimated" and recomputes on every read (`docs/11-MONEY.md` §3), so a
 *   payment recorded against it would be measured against a number that
 *   changes underneath it.
 * - `no_frozen_gross` — the week IS approved but its snapshot is NULL: a
 *   legacy week approved before migration 042, or an unpriceable one
 *   (`no_arrangement`/`currency_change`, whose jsonb is frozen but whose
 *   amount columns stay empty by design). There is no ceiling to enforce and
 *   no currency to stamp, so a payment here could be neither bounded nor
 *   labelled.
 *
 * A CONFLICT rather than a `ValidationError`: nothing the parent typed is
 * wrong, the week is simply in the wrong state — the same shape as
 * `ExpenseWeekLockedError` and `TimesheetNotActionableError`. Approving the
 * week makes the identical request succeed.
 */
export class PaymentWeekNotApprovedError extends ConflictError {
  constructor(timesheetId: string, reason: string, metadata?: ErrorMetadata) {
    super(
      'That week has not been approved yet, so a payment cannot be recorded against it',
      'PAYMENT_WEEK_NOT_APPROVED',
      { timesheetId, reason, ...metadata }
    );
    this.name = 'PaymentWeekNotApprovedError';
  }
}

/**
 * 400 — this payment would take the week's settled total past its frozen
 * gross. The invariant is `sum(payments per timesheet) <= gross_minor`, and
 * because a cross-row SUM cannot be a row CHECK constraint, this service-side
 * refusal IS the constraint (migration 067's header).
 *
 * THE AMOUNT IS NEVER CLAMPED TO FIT — the same rule, and the same reason, as
 * `TimesheetGrossTooLargeError` and `ExpenseAmountTooLargeError`
 * (`docs/11-MONEY.md` §1). Writing the difference instead would record a
 * payment for an amount nobody made, and the ledger's whole job is to answer
 * "what has actually been paid". The parent either corrects the figure or
 * (if the week really is worth more) re-approves the week.
 *
 * A `ValidationError` and not a 409: retrying changes nothing, because
 * nothing is racing — the request as stated cannot be satisfied. `metadata`
 * carries the amount, what is already paid, and the ceiling, so the client
 * can say "£500.00 of £800.00 is already recorded" without re-deriving it.
 */
export class PaymentExceedsGrossError extends ValidationError {
  constructor(
    timesheetId: string,
    amountMinor: number,
    alreadyPaidMinor: number,
    grossMinor: number
  ) {
    super(
      'That payment is more than this week still has left to pay',
      'PAYMENT_EXCEEDS_GROSS',
      400,
      { timesheetId, amountMinor, alreadyPaidMinor, grossMinor }
    );
    this.name = 'PaymentExceedsGrossError';
  }
}

/**
 * 400 — the reversal is larger than what is LEFT of the payment it corrects
 * (D-20, migration 085).
 *
 * The ceiling is the ORIGINAL ROW, not the week: every correction is bounded
 * by the payment it points at, which is what makes "you cannot un-pay more
 * than you paid" true for the week as a whole without a second gate. A partial
 * reversal is legitimate and common (the parent transferred £462 but only £120
 * of it belonged to this week), so `remaining_minor` is what a second
 * correction is measured against, not the original amount.
 *
 * NEVER CLAMPED TO FIT, the same rule as `PaymentExceedsGrossError` — writing
 * the difference would record a reversal for an amount nobody asked for, and a
 * ledger that quietly adjusts what you typed is worse than one that refuses.
 * `metadata` carries what was asked, the original's full amount and what is
 * still reversible, so the sheet can say "£120.00 of £462.00 is already
 * reversed" without re-deriving it.
 *
 * A `ValidationError`, not a 409: nothing is racing — the request as stated
 * cannot be satisfied, and retrying it unchanged fails identically.
 */
export class PaymentCorrectionExceedsOriginalError extends ValidationError {
  constructor(
    paymentId: string,
    amountMinor: number,
    originalAmountMinor: number,
    remainingMinor: number
  ) {
    super(
      'That correction is more than this payment has left to reverse',
      'PAYMENT_CORRECTION_EXCEEDS_ORIGINAL',
      400,
      { paymentId, amountMinor, originalAmountMinor, remainingMinor }
    );
    this.name = 'PaymentCorrectionExceedsOriginalError';
  }
}

/**
 * 409 — there is nothing here to correct. Three arms, all in
 * `metadata.reason`, and all answered by 085's function under its lock:
 *
 * - `week_missing` — the timesheet went between the service's read and the
 *   lock. Its payments cascaded with it.
 * - `payment_missing` — no payment with that id ON THIS WEEK. A guessed id
 *   from another household lands here and learns nothing else.
 * - `not_a_payment` — the target is itself a correction. One level, no
 *   chains (spec §4.1): correcting a correction is a new payment, because a
 *   chain of reversals is a thing nobody can read back a year later.
 *
 * A CONFLICT rather than a 404: the caller has already passed the week's
 * membership gate, so this is a state answer about a household that is
 * genuinely theirs, not an existence question. Nothing is leaked by saying so.
 */
export class PaymentNotCorrectableError extends ConflictError {
  constructor(paymentId: string, reason: string, metadata?: ErrorMetadata) {
    super('That payment cannot be corrected', 'PAYMENT_NOT_CORRECTABLE', {
      paymentId,
      reason,
      ...metadata,
    });
    this.name = 'PaymentNotCorrectableError';
  }
}

// =============================================================================
// Reimbursement settlements (D-14, gap P7 — migration 086, attention spec §4.2)
//
// REIMBURSEMENT SETTLEMENTS ARE NOT PAYMENTS. These errors carry their own
// codes rather than reusing the `PAYMENT_*` family deliberately: a client
// branching on `PAYMENT_EXCEEDS_GROSS` for a repayment has already merged two
// things the money engine keeps apart.
// =============================================================================

/**
 * 404 — this household's settlements are not the caller's to see or write.
 * ONE error for every failing case, the same discipline as
 * `PaymentNotFoundError`/`ExpenseNotFoundError`:
 *
 * - the household doesn't exist, or the caller isn't a member of it;
 * - the caller is a `helper` (no money surface at all);
 * - a WRITE arrived from someone with no ACTIVE membership.
 *
 * The role refusal on a write is deliberately NOT this error: an active
 * member who is a nanny gets the 403 `NotAHouseholdParentError`, because she
 * already knows the household exists and "you are not a parent" is the
 * actionable message — the same asymmetry `PaymentNotFoundError` documents.
 * Discriminating detail rides in `metadata.reason`, which
 * `BaseError.toClientJSON` only ships for 4xx.
 */
export class ReimbursementSettlementNotFoundError extends NotFoundError {
  constructor(householdId: string, metadata?: ErrorMetadata) {
    super('Reimbursement settlement not found', 'REIMBURSEMENT_NOT_FOUND', {
      householdId,
      ...metadata,
    });
    this.name = 'ReimbursementSettlementNotFoundError';
  }
}

/**
 * 409 — this carer has no approved reimbursements in that week, so there is
 * nothing to record as repaid.
 *
 * THE ZERO ROW IS NEVER WRITTEN (`docs/11-MONEY.md` §1, and 086's
 * `check (amount_minor >= 1)`). A £0.00 settlement states that money moved
 * when none did, and it is worse than an error: it makes the week look
 * settled forever, with no correction path (spec §4.2 builds none) to take it
 * back. The amount is never clamped up to 1 to satisfy the check either —
 * refusing is the only honest option.
 *
 * A CONFLICT, not a `ValidationError`: nothing the parent typed is wrong —
 * approving a claim in that week makes the identical request succeed.
 */
export class NothingToSettleError extends ConflictError {
  constructor(householdId: string, carerId: string, weekStart: string) {
    super(
      'There are no approved reimbursements to settle for that week',
      'NOTHING_TO_SETTLE',
      { householdId, carerId, weekStart }
    );
    this.name = 'NothingToSettleError';
  }
}

/**
 * 409 — an approved claim in that carer-week is denominated in a currency the
 * household is not. Summing across currencies produces a number that is not
 * money in any of them, so the week is REFUSED rather than partially settled
 * or silently narrowed to the matching rows — the same escalation
 * `earningsService` makes when a week meets two currencies
 * (`EARNINGS_RESULT_STATUSES.CURRENCY_CHANGE`) instead of dropping the odd
 * one out.
 *
 * `metadata` names both codes so the client can say which pair disagreed.
 */
export class SettlementCurrencyMismatchError extends ConflictError {
  constructor(
    householdId: string,
    carerId: string,
    weekStart: string,
    householdCurrency: string,
    claimCurrency: string
  ) {
    super(
      'Those reimbursements are not all in the household’s currency',
      'SETTLEMENT_CURRENCY_MISMATCH',
      { householdId, carerId, weekStart, householdCurrency, claimCurrency }
    );
    this.name = 'SettlementCurrencyMismatchError';
  }
}

/**
 * 409 — translated from the `reimbursement_settlements_week_idx` unique index
 * (23505, migration 086): this carer-week is already settled. Two parents
 * tapping "Mark reimbursed" in the same instant is the race 077 closed for
 * payments — but the invariant here is "at most one row", which is exactly
 * what a unique index enforces, so the database refuses the second insert and
 * the repository names the refusal. Same translation
 * `expenseRepository.create` does for 051's partial index.
 *
 * A sequential retry lands here too, and should: the table is append-only and
 * has no correction path (spec §4.2 — YAGNI), so "settle it again" is not an
 * operation that exists.
 *
 * The three ids are optional because they come off the row being inserted —
 * the repository reports what it tried to write, and a caller that omitted
 * one gets `undefined` rather than a fabricated value.
 */
export class AlreadySettledError extends ConflictError {
  constructor(
    householdId: string | undefined,
    carerId: string | undefined,
    weekStart: string | undefined
  ) {
    super(
      'These reimbursements are already marked as repaid',
      'ALREADY_SETTLED',
      { householdId, carerId, weekStart }
    );
    this.name = 'AlreadySettledError';
  }
}
