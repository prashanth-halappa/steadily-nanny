/**
 * Timesheet domain errors.
 * @module domains/timesheet/errors/timesheetErrors
 */
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the time entry does not exist OR the caller is not an active member
 * of its household (and not the carer it belongs to). SAME error for both
 * cases, exactly like the household domain's `HouseholdNotFoundError` —
 * existence must never leak.
 */
export class TimeEntryNotFoundError extends NotFoundError {
  constructor(timeEntryId: string, metadata?: ErrorMetadata) {
    super('Time entry not found', 'TIME_ENTRY_NOT_FOUND', {
      timeEntryId,
      ...metadata,
    });
    this.name = 'TimeEntryNotFoundError';
  }
}

/** 404 — the timesheet does not exist OR the caller is not an active member of its household. */
export class TimesheetNotFoundError extends NotFoundError {
  constructor(timesheetId: string, metadata?: ErrorMetadata) {
    super('Timesheet not found', 'TIMESHEET_NOT_FOUND', {
      timesheetId,
      ...metadata,
    });
    this.name = 'TimesheetNotFoundError';
  }
}

/**
 * 409 — the carer already has a running (not yet clocked-out) time entry.
 * Translated from the DB's `time_entries_one_running_per_carer` partial
 * unique index (23505) rather than surfacing as a raw 500 — see
 * `timeEntryRepository.clockIn`.
 */
export class AlreadyClockedInError extends ConflictError {
  constructor(carerId: string) {
    super('You are already clocked in', 'ALREADY_CLOCKED_IN', { carerId });
    this.name = 'AlreadyClockedInError';
  }
}

/**
 * 409 — a `cancellation_paid` entry already exists for this SPAN of a shift.
 * Translated from the DB's `time_entries_one_cancellation_paid_per_span`
 * partial unique index (053, keyed on `(shift_id, clock_in_at)`).
 * `recordCancellationPaidEntry` catches this per fragment and re-fetches that
 * fragment's winner by span — callers outside that path should not see it.
 */
export class CancellationPaidAlreadyRecordedError extends ConflictError {
  constructor(shiftId: string) {
    super(
      'Cancellation-paid hours already recorded for this shift',
      'CANCELLATION_PAID_ALREADY_RECORDED',
      { shiftId }
    );
    this.name = 'CancellationPaidAlreadyRecordedError';
  }
}

/** 409 — clock-out was called on an entry that isn't `running` (already clocked out, or not a worked entry). */
export class TimeEntryNotRunningError extends ConflictError {
  constructor(timeEntryId: string, status: string) {
    super('This time entry is not running', 'TIME_ENTRY_NOT_RUNNING', {
      timeEntryId,
      status,
    });
    this.name = 'TimeEntryNotRunningError';
  }
}

/**
 * 409 — a correction (PATCH /time-entries/:id) was attempted on an entry
 * that is no longer the carer's to change: still `running` (clock out
 * instead), or belonging to a week the parent has already approved. An
 * approved week is a signed agreement — the way back into it is the
 * parent's own query flow, not a silent edit.
 */
export class TimeEntryNotEditableError extends ConflictError {
  constructor(timeEntryId: string, reason: string) {
    super(
      'This time entry can no longer be edited',
      'TIME_ENTRY_NOT_EDITABLE',
      {
        timeEntryId,
        editableReason: reason,
      }
    );
    this.name = 'TimeEntryNotEditableError';
  }
}

/**
 * 409 — a new or edited span intersects another completed entry for the
 * same carer. There is no DB exclusion constraint on `time_entries`, so the
 * service layer is the only guard against double-counting the same hours.
 */
export class TimeEntryOverlapError extends ConflictError {
  constructor(metadata?: ErrorMetadata) {
    super('This time overlaps another entry', 'TIME_ENTRY_OVERLAPS', metadata);
    this.name = 'TimeEntryOverlapError';
  }
}

/**
 * 400 — the supplied clock times don't describe a possible session: out
 * before in, or out in the future. Mirrors the DB's
 * `time_entries_clock_order` check so a bad edit reads as a validation
 * failure instead of surfacing as a raw constraint violation (500).
 */
export class InvalidClockTimesError extends ValidationError {
  constructor(reason: string, metadata?: ErrorMetadata) {
    super('Those clock times are not valid', reason, 400, metadata);
    this.name = 'InvalidClockTimesError';
  }
}

/** 403 — clock-in was attempted by a household member who isn't the assigned carer (nanny) role. */
export class NotACarerError extends AuthorizationError {
  constructor(householdId: string, role: string) {
    super('Only the carer can clock in or out', 'NOT_A_CARER', {
      householdId,
      role,
    });
    this.name = 'NotACarerError';
  }
}

/** 403 — approving/querying a timesheet is parent-only, same write-role convention as the household domain. */
export class NotATimesheetParentError extends AuthorizationError {
  constructor(householdId: string, role: string) {
    super('Only parents can perform this action', 'NOT_A_PARENT', {
      householdId,
      role,
    });
    this.name = 'NotATimesheetParentError';
  }
}

/**
 * 400 — the week's gross WORKED OUT TO more than any amount this system can
 * record (`MAX_MONEY_MINOR`, migration 063's `timesheets_gross_minor_upper`).
 *
 * Nothing submitted is invalid: the hours are real and the pay arrangement's
 * `rate_minor` is inside its own cap. Capping each INPUT never capped their
 * PRODUCT — 40 hours at the schema-legal maximum rate is 3_999_999_960, past
 * the cap and past int4 as well. Refusing here, before the approve write,
 * turns what was a raw Postgres "value out of range" into something a parent
 * can read and an engineer can trace.
 *
 * A `ValidationError` (400), not a 409: retrying is not the remedy — the
 * arrangement's rate has to change. `metadata` carries the computed gross and
 * the cap so the refusal needs no re-derivation to understand.
 *
 * THE GROSS IS NEVER CLAMPED TO FIT (`docs/11-MONEY.md` §1). A trimmed gross
 * is a wrong figure that a parent would sign off and a nanny would be paid.
 */
export class TimesheetGrossTooLargeError extends ValidationError {
  constructor(timesheetId: string, grossMinor: number, maxMinor: number) {
    super(
      "That week's pay works out to more than the largest amount we can record",
      'TIMESHEET_GROSS_TOO_LARGE',
      400,
      { timesheetId, grossMinor, maxMinor }
    );
    this.name = 'TimesheetGrossTooLargeError';
  }
}

/**
 * 409 — an approval-time adjustment was supplied for a week that has no
 * computed gross to adjust.
 *
 * Three reasons wear this error, and they are the three shapes of "no base":
 * the carer deleted her account (`carer_removed`, 033 — nothing to resolve an
 * arrangement against), no arrangement covers the week (`no_arrangement`), or
 * the week straddles a currency change (`currency_change`). All three already
 * freeze a snapshot with NULL money columns, and `docs/11-MONEY.md` §4 is
 * explicit about what must not happen next: a bare adjustment folded into
 * nothing would print `£15.00` under an "Approved gross" label for a week the
 * engine could not price at all — a number invented out of a missing one.
 *
 * WITHOUT an adjustment every one of those paths behaves exactly as it always
 * has: the hours are still approved, only the money is absent. This refusal
 * fires ONLY when a client asked to add money to a week that has none.
 */
export class TimesheetAdjustmentNotAllowedError extends ConflictError {
  constructor(
    timesheetId: string,
    reason: 'no_arrangement' | 'currency_change' | 'carer_removed'
  ) {
    super(
      "This week has no total to adjust, so an adjustment can't be applied",
      'TIMESHEET_ADJUSTMENT_NOT_ALLOWED',
      { timesheetId, reason }
    );
    this.name = 'TimesheetAdjustmentNotAllowedError';
  }
}

/**
 * 400 — the deduction is bigger than the week's computed gross, so the
 * adjusted total would be negative.
 *
 * REFUSED, NEVER CLAMPED, for the same reason `PaymentExceedsGrossError`
 * refuses rather than trimming (`docs/11-MONEY.md` §11): a gross silently
 * floored at zero is a figure nobody chose, frozen into a snapshot and paid
 * against. `gross_minor` is `min(0)` on the wire and in the DB, so the only
 * two honest options are "refuse" and "let the write die on a constraint" —
 * and only one of those is readable.
 *
 * `metadata` carries both halves so the client can name the ceiling it hit
 * without re-deriving it.
 */
export class TimesheetAdjustmentNegativeGrossError extends ValidationError {
  constructor(
    timesheetId: string,
    grossMinor: number,
    adjustmentMinor: number
  ) {
    super(
      "That takes off more than the week's total",
      'TIMESHEET_ADJUSTMENT_NEGATIVE_GROSS',
      400,
      { timesheetId, grossMinor, adjustmentMinor }
    );
    this.name = 'TimesheetAdjustmentNegativeGrossError';
  }
}

/**
 * 409 — `GET /timesheets/:id/export.csv` on a week whose figures are not
 * FROZEN, so there is nothing honest to hand a payroll provider.
 *
 * Two refusals wear this one error, and both are the same rule:
 *
 * - the week is not `approved` — its amount is a live estimate that changes
 *   with the next clock-out or a backdated raise (`docs/11-MONEY.md` §3);
 * - the week IS approved but its earnings resolve to `hours_only` — a legacy
 *   pre-042 approval, an unreadable snapshot, or a carer who deleted her
 *   account. `getWeekWithEarnings` degrades those to hours-with-no-money ON
 *   SCREEN, deliberately, because blanking the screen a nanny opened to check
 *   her pay is worse. A FILE is not that: a spreadsheet with wrong or missing
 *   money in it gets forwarded, filed, and paid against long after the caveat
 *   on the screen is forgotten. So the export refuses where the view degrades.
 *
 * `exportReason` carries which of those it was (`not_approved`,
 * `legacy_approval`, `unreadable_snapshot`, `carer_removed`, or an engine
 * status) so support can answer "why won't it download" without a repro.
 */
export class TimesheetNotExportableError extends ConflictError {
  constructor(timesheetId: string, status: string, exportReason: string) {
    super(
      'This week cannot be exported until it is approved',
      'TIMESHEET_NOT_EXPORTABLE',
      { timesheetId, status, exportReason }
    );
    this.name = 'TimesheetNotExportableError';
  }
}

/**
 * 400 — a multi-week export (`exportCarerPaySummaryCsv`,
 * `exportYearEndSummaryCsv`, D-29/P11/P12) was requested in a shape it
 * cannot honestly serve:
 *
 * - `carer_required` — a parent (household-scope read) asked for a pay
 *   summary with no `carerId` — D-29's "a nanny exports only her own" is
 *   forced automatically for a nanny caller, but a parent reading the whole
 *   household must say which carer.
 * - `mixed_currency` — the included weeks price in more than one currency
 *   (a rate change that also changed currency). Same "one currency, never
 *   summed across" rule the earnings engine's `currency_change` arm applies
 *   to a single week (`docs/11-MONEY.md` §6) — a YTD total blending two
 *   currencies is not a number, so this refuses rather than blend.
 */
export class PaySummaryExportError extends ValidationError {
  constructor(
    reason: 'carer_required' | 'mixed_currency',
    metadata?: ErrorMetadata
  ) {
    super(
      reason === 'carer_required'
        ? 'Choose which carer this pay summary is for'
        : 'This range spans more than one currency and cannot be totalled honestly',
      'PAY_SUMMARY_NOT_EXPORTABLE',
      400,
      { reason, ...metadata }
    );
    this.name = 'PaySummaryExportError';
  }
}

/** 409 — approve/query was called on a timesheet with no submitted hours to act on. */
export class TimesheetNotActionableError extends ConflictError {
  constructor(timesheetId: string, status: string) {
    super(
      'This timesheet is not awaiting approval',
      'TIMESHEET_NOT_ACTIONABLE',
      { timesheetId, status }
    );
    this.name = 'TimesheetNotActionableError';
  }
}
