/**
 * Availability domain errors.
 * @module domains/availability/errors/availabilityErrors
 */
import { NotFoundError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the target user's availability (or busy blocks) is not visible to
 * the caller: either the caller does not share an active household with
 * them, or the target does not exist / has no rows. The SAME error covers
 * both cases so a caller with zero connection to the target can never learn
 * whether a given uuid is a real user — mirrors
 * `HouseholdNotFoundError`/`WidgetNotFoundError` and the DB's
 * `private.shares_household_with` philosophy (see
 * supabase/migrations/011_availability.sql). Also gates the cross-household
 * busy-blocks read — "Keep families apart" is a privacy promise, not a nicety.
 */
export class AvailabilityNotFoundError extends NotFoundError {
  constructor(userId: string, metadata?: ErrorMetadata) {
    super('Availability not found', 'AVAILABILITY_NOT_FOUND', {
      userId,
      ...metadata,
    });
    this.name = 'AvailabilityNotFoundError';
  }
}

/**
 * 404 — the time-off row does not exist OR is not the caller's own. SAME
 * error for both cases (mirrors `HouseholdNotFoundError`/`WidgetNotFoundError`)
 * so ownership can never be probed by id.
 */
export class TimeOffNotFoundError extends NotFoundError {
  constructor(timeOffId: string, metadata?: ErrorMetadata) {
    super('Time off not found', 'TIME_OFF_NOT_FOUND', {
      timeOffId,
      ...metadata,
    });
    this.name = 'TimeOffNotFoundError';
  }
}
