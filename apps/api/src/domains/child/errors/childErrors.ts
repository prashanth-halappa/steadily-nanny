/**
 * Child domain errors.
 * @module domains/child/errors/childErrors
 */
import { NotFoundError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the child does not exist, does not belong to the household named in
 * the URL, or the caller is not an active member of that household. The SAME
 * error for all three cases, mirroring HouseholdNotFoundError — no existence
 * leak to a caller who isn't a member.
 */
export class ChildNotFoundError extends NotFoundError {
  constructor(childId: string, metadata?: ErrorMetadata) {
    super('Child not found', 'CHILD_NOT_FOUND', { childId, ...metadata });
    this.name = 'ChildNotFoundError';
  }
}
