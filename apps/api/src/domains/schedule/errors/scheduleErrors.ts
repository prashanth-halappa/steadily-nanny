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
