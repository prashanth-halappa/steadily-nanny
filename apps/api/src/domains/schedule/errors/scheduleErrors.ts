/**
 * Schedule domain errors.
 * @module domains/schedule/errors/scheduleErrors
 */
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the pattern does not exist OR the caller is not an active member of
 * its household. SAME error for both cases, exactly like the household
 * domain's `HouseholdNotFoundError` — existence must never leak to a
 * non-member.
 */
export class SchedulePatternNotFoundError extends NotFoundError {
  constructor(patternId: string, metadata?: ErrorMetadata) {
    super('Schedule pattern not found', 'SCHEDULE_PATTERN_NOT_FOUND', {
      patternId,
      ...metadata,
    });
    this.name = 'SchedulePatternNotFoundError';
  }
}

/** 409 — an action that requires `status = 'draft'` was attempted on a pattern that has moved past draft. */
export class PatternNotDraftError extends ConflictError {
  constructor(patternId: string, status: string) {
    super(
      'This action is only available while the pattern is a draft',
      'PATTERN_NOT_DRAFT',
      { patternId, status }
    );
    this.name = 'PatternNotDraftError';
  }
}

/** 409 — `send` was called on a pattern with no `carer_id` — there is nobody to send it to. */
export class PatternMissingCarerError extends ConflictError {
  constructor(patternId: string) {
    super(
      'A pattern must have a carer assigned before it can be sent',
      'PATTERN_MISSING_CARER',
      { patternId }
    );
    this.name = 'PatternMissingCarerError';
  }
}

/** 409 — an edit (PATCH, or replacing days) was attempted on a pattern that has already been sent. */
export class PatternNotEditableError extends ConflictError {
  constructor(patternId: string, status: string) {
    super(
      'This pattern can no longer be edited directly',
      'PATTERN_NOT_EDITABLE',
      { patternId, status }
    );
    this.name = 'PatternNotEditableError';
  }
}

/**
 * 409 — `amend` (exdates / pause_ranges / until on an accepted pattern) was
 * attempted on a pattern that is not currently `accepted`.
 */
export class PatternNotAcceptedError extends ConflictError {
  constructor(patternId: string, status: string) {
    super('Only an accepted pattern can be amended', 'PATTERN_NOT_ACCEPTED', {
      patternId,
      status,
    });
    this.name = 'PatternNotAcceptedError';
  }
}

/** 409 — `respond` was called on a pattern that is not currently `pending`. */
export class PatternNotPendingError extends ConflictError {
  constructor(patternId: string, status: string) {
    super('This pattern is not awaiting a response', 'PATTERN_NOT_PENDING', {
      patternId,
      status,
    });
    this.name = 'PatternNotPendingError';
  }
}

/**
 * 403 — `respond` was called by someone other than the carer the pattern was
 * proposed to. A household parent cannot accept on the carer's behalf.
 */
export class NotThePatternCarerError extends AuthorizationError {
  constructor(patternId: string) {
    super(
      'Only the carer this pattern was sent to may respond to it',
      'NOT_THE_PATTERN_CARER',
      { patternId }
    );
    this.name = 'NotThePatternCarerError';
  }
}

/**
 * 404 — `create()`'s `carer_id` does not resolve to an active NANNY member
 * of the household. SAME error whether that id has no membership at all,
 * or is an active member with the wrong role (e.g. a co-parent) — a caller
 * must not be able to distinguish "no such person" from "wrong role" by
 * probing ids, exactly like `SchedulePatternNotFoundError` above.
 */
export class InvalidPatternCarerError extends NotFoundError {
  constructor(householdId: string, carerId: string) {
    super(
      'This person cannot be assigned as the carer for this household',
      'INVALID_PATTERN_CARER',
      { householdId, carerId }
    );
    this.name = 'InvalidPatternCarerError';
  }
}

/**
 * 409 — migration 062's `shifts_recurring_window_unique` refused an insert:
 * a live `recurring` shift already exists for this exact
 * (household, carer, starts_at, ends_at). The schedule domain's analogue of
 * the shift domain's `ExtraShiftAlreadyExistsError`, and used the same way —
 * `scheduleMaterialisationService` catches it and ADOPTS the existing row
 * rather than failing the materialisation run. It only ever reaches an HTTP
 * caller if the row the index says exists cannot then be found.
 */
export class RecurringShiftAlreadyExistsError extends ConflictError {
  constructor(metadata: ErrorMetadata) {
    super(
      'A shift already exists for this exact window',
      'RECURRING_SHIFT_ALREADY_EXISTS',
      metadata
    );
    this.name = 'RecurringShiftAlreadyExistsError';
  }
}

/**
 * 404 — a `child_id` in `replaceDays()` is not an active child of the
 * pattern's OWN household. Deliberately NOT the same opaque error as the
 * child domain's `ChildNotFoundError`: the caller here is always a parent
 * of THIS household (already role/membership-checked by `replaceDays`
 * before this runs), so "not part of your household" reveals nothing they
 * couldn't already see by listing their own children — it says nothing
 * about whether the id exists, or where, in any OTHER household. Contrast
 * with `timesheetCommandService`'s reuse of `ShiftNotFoundError` verbatim,
 * where the caller does NOT already own the resource in question.
 */
export class InvalidPatternChildError extends NotFoundError {
  constructor(householdId: string, childId: string) {
    super('This child is not part of this household', 'INVALID_PATTERN_CHILD', {
      householdId,
      childId,
    });
    this.name = 'InvalidPatternChildError';
  }
}
