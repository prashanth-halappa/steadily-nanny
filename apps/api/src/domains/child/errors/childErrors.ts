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

/**
 * 404 — the commitment does not exist, or the caller is not an active
 * member of the household it belongs to. The SAME error for both cases,
 * mirroring `ChildNotFoundError` / `ShiftNotFoundError` — no existence leak
 * to a caller who isn't a member. Used by the flat
 * `/commitments/:commitmentId` routes, which carry no household id in the
 * URL to check against (see `childCommitmentQueryService.getOwned`).
 */
export class ChildCommitmentNotFoundError extends NotFoundError {
  constructor(commitmentId: string, metadata?: ErrorMetadata) {
    super('Child commitment not found', 'CHILD_COMMITMENT_NOT_FOUND', {
      commitmentId,
      ...metadata,
    });
    this.name = 'ChildCommitmentNotFoundError';
  }
}
