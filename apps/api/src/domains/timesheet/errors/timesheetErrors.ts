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
 * 409 — a `cancellation_paid` entry already exists for this shift. Translated
 * from the DB's `time_entries_one_cancellation_paid_per_shift` partial unique
 * index (23505). `recordCancellationPaidEntry` catches this on a race past
 * its find-first check and re-fetches the winner — callers outside that
 * path should not see it.
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
