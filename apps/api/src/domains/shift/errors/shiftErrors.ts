/**
 * Shift domain errors.
 * @module domains/shift/errors/shiftErrors
 */
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the shift does not exist OR the caller is not an active member of
 * its household. Returning the SAME error for "missing" and "not a member"
 * avoids leaking the existence of another family's shift to a non-member,
 * exactly like the household domain's `HouseholdNotFoundError` — see
 * `middlewares/validateResourceOwnership` for why the `lookup` MUST throw a
 * NotFoundError for both cases.
 */
export class ShiftNotFoundError extends NotFoundError {
  constructor(shiftId: string, metadata?: ErrorMetadata) {
    super('Shift not found', 'SHIFT_NOT_FOUND', { shiftId, ...metadata });
    this.name = 'ShiftNotFoundError';
  }
}

/**
 * 404 — the change request does not exist OR the caller is not an active
 * member of its shift's household. SAME error for both cases — see
 * `ShiftNotFoundError`.
 */
export class ShiftChangeRequestNotFoundError extends NotFoundError {
  constructor(changeRequestId: string, metadata?: ErrorMetadata) {
    super('Shift change request not found', 'SHIFT_CHANGE_REQUEST_NOT_FOUND', {
      changeRequestId,
      ...metadata,
    });
    this.name = 'ShiftChangeRequestNotFoundError';
  }
}

/**
 * 409 — a write was attempted against a shift that is settled history: it is
 * already `completed`/`cancelled`, or someone has clocked into it
 * (`time_entries`). Accepting a change request must not rewrite past,
 * paid-for reality — the same rule `scheduleMaterialisationService` already
 * applies to re-materialisation. Raised by
 * `ShiftRepository.assertMutable`/`update`.
 */
export class ShiftImmutableError extends ConflictError {
  constructor(shiftId: string, status: string, blockedBy = 'status') {
    super('This shift can no longer be changed', 'SHIFT_IMMUTABLE', {
      shiftId,
      status,
      blockedBy,
    });
    this.name = 'ShiftImmutableError';
  }
}

/**
 * 409 — an EXTRA shift for this exact `(household, carer, starts_at, ends_at)`
 * already exists and is not cancelled. Raised wherever migration 059's
 * `shifts_extra_window_unique` index rejects a write (23505):
 * `ShiftRepository.createShift`, when a concurrent create won the race that
 * `insertExtraShift`'s check-then-act pre-check cannot see; and
 * `ShiftRepository.applyParentEdit`, when a parent re-times an extra shift
 * onto another live one's exact window.
 *
 * It is not usually rendered to a user: `insertExtraShift` catches it and
 * adopts the winner, so a double-tap reads as "created" for both taps. It
 * exists so that path can tell "someone else already made this shift" apart
 * from a genuine insert failure, which must still 500. Same shape and same
 * purpose as `CancellationPaidAlreadyRecordedError` in the timesheet domain.
 */
export class ExtraShiftAlreadyExistsError extends ConflictError {
  /** Metadata is free-form: the insert path knows the window, the edit path only the shift id. */
  constructor(metadata: ErrorMetadata) {
    super(
      'An extra shift already exists for this window',
      'EXTRA_SHIFT_ALREADY_EXISTS',
      metadata
    );
    this.name = 'ExtraShiftAlreadyExistsError';
  }
}

/** 409 — respond/withdraw was attempted on a request that is not `pending`. */
export class ChangeRequestNotPendingError extends ConflictError {
  constructor(changeRequestId: string, status: string) {
    super(
      'This change request is not awaiting a response',
      'CHANGE_REQUEST_NOT_PENDING',
      { changeRequestId, status }
    );
    this.name = 'ChangeRequestNotPendingError';
  }
}

/**
 * 403 — `respond` was called by someone other than the party who may reply
 * (the assigned carer for a parent-initiated request, or a parent for a
 * nanny counter-offer).
 */
export class NotTheChangeRequestResponderError extends AuthorizationError {
  constructor(changeRequestId: string) {
    super(
      'You are not the person who may respond to this change request',
      'NOT_CHANGE_REQUEST_RESPONDER',
      { changeRequestId }
    );
    this.name = 'NotTheChangeRequestResponderError';
  }
}

/** 403 — `withdraw` was called by someone other than the original requester. */
export class NotTheChangeRequestRequesterError extends AuthorizationError {
  constructor(changeRequestId: string) {
    super(
      'Only the person who opened this change request may withdraw it',
      'NOT_CHANGE_REQUEST_REQUESTER',
      { changeRequestId }
    );
    this.name = 'NotTheChangeRequestRequesterError';
  }
}

/** 403 — the caller's household role may not open this kind of change request. */
export class InvalidChangeRequestKindForRoleError extends AuthorizationError {
  constructor(kind: string, role: string) {
    super(
      'Your role may not open this kind of change request',
      'INVALID_CHANGE_REQUEST_KIND_FOR_ROLE',
      { kind, role }
    );
    this.name = 'InvalidChangeRequestKindForRoleError';
  }
}
