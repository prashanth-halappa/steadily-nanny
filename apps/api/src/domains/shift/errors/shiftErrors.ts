/**
 * Shift domain errors.
 * @module domains/shift/errors/shiftErrors
 */
import { NotFoundError } from '../../../errors';
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
