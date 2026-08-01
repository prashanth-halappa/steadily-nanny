/**
 * Household domain errors.
 * @module domains/household/errors/householdErrors
 */
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the household does not exist OR the caller is not an active member of
 * it. Returning the SAME error for "missing" and "not a member" avoids
 * leaking the existence of other families' households to a non-member, and
 * satisfies the ownership-middleware contract (the `lookup` MUST throw a
 * NotFoundError for both cases — see `middlewares/validateResourceOwnership`).
 */
export class HouseholdNotFoundError extends NotFoundError {
  constructor(householdId: string, metadata?: ErrorMetadata) {
    super('Household not found', 'HOUSEHOLD_NOT_FOUND', {
      householdId,
      ...metadata,
    });
    this.name = 'HouseholdNotFoundError';
  }
}

/**
 * 403 — the caller is an active member but not an owner/parent, and the
 * action is parent-only (updating the household, inviting, creating/editing
 * children).
 */
export class NotAHouseholdParentError extends AuthorizationError {
  constructor(householdId: string, role: string) {
    super('Only parents can perform this action', 'NOT_A_PARENT', {
      householdId,
      role,
    });
    this.name = 'NotAHouseholdParentError';
  }
}

/** 404 — no invite exists with this code. */
export class InviteNotFoundError extends NotFoundError {
  constructor(code: string) {
    super('Invite not found', 'INVITE_NOT_FOUND', { code });
    this.name = 'InviteNotFoundError';
  }
}

/** 409 — the invite's `expires_at` has passed. */
export class InviteExpiredError extends ConflictError {
  constructor(code: string) {
    super('Invite has expired', 'INVITE_EXPIRED', { code });
    this.name = 'InviteExpiredError';
  }
}

/** 409 — a parent revoked this invite before it was redeemed. */
export class InviteRevokedError extends ConflictError {
  constructor(code: string) {
    super('Invite has been revoked', 'INVITE_REVOKED', { code });
    this.name = 'InviteRevokedError';
  }
}

/** 409 — someone already redeemed this invite (sequential double-redeem). */
export class InviteAlreadyAcceptedError extends ConflictError {
  constructor(code: string) {
    super('Invite has already been redeemed', 'INVITE_ALREADY_ACCEPTED', {
      code,
    });
    this.name = 'InviteAlreadyAcceptedError';
  }
}

/**
 * 409 — the caller already has an active membership in this household. Covers
 * both self-redeeming an invite for a household you already belong to, and a
 * concurrent double-redeem race caught by the repository's unique-constraint
 * translation (see householdMemberRepository.createMembership).
 */
export class AlreadyMemberError extends ConflictError {
  constructor(householdId: string) {
    super('You are already a member of this household', 'ALREADY_MEMBER', {
      householdId,
    });
    this.name = 'AlreadyMemberError';
  }
}
