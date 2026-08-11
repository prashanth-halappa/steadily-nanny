/**
 * Household domain errors.
 * @module domains/household/errors/householdErrors
 */
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
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

/**
 * 404 — no invite matches. `identifier` is the code on the redeem/preview
 * paths and the invite id on the revoke path, where it ALSO covers "belongs to
 * another household": collapsing missing and not-yours is what stops a parent
 * probing other families' invite ids.
 */
export class InviteNotFoundError extends NotFoundError {
  constructor(identifier: string, metadata?: ErrorMetadata) {
    super('Invite not found', 'INVITE_NOT_FOUND', { identifier, ...metadata });
    this.name = 'InviteNotFoundError';
  }
}

/** 409 — the invite exists in this household but is already accepted, revoked or expired, so there is nothing to revoke. */
export class InviteNotPendingError extends ConflictError {
  constructor(inviteId: string, status: string) {
    super('Only a pending invite can be revoked', 'INVITE_NOT_PENDING', {
      inviteId,
      status,
    });
    this.name = 'InviteNotPendingError';
  }
}

/**
 * 404 — the membership does not exist, belongs to another household, or was
 * already removed. One error for all three, same reasoning as
 * HouseholdNotFoundError: a parent must not be able to probe membership ids
 * outside their own household.
 */
export class MemberNotFoundError extends NotFoundError {
  constructor(memberId: string) {
    super('Household member not found', 'MEMBER_NOT_FOUND', { memberId });
    this.name = 'MemberNotFoundError';
  }
}

/**
 * 403 — the owner cannot be removed. This doubles as the last-parent rule:
 * every household has exactly one owner membership created with it, so an
 * un-removable owner is a household that can never be left parentless.
 */
export class CannotRemoveOwnerError extends AuthorizationError {
  constructor(householdId: string) {
    super('The household owner cannot be removed', 'CANNOT_REMOVE_OWNER', {
      householdId,
    });
    this.name = 'CannotRemoveOwnerError';
  }
}

/**
 * 403 — the owner cannot LEAVE either. Same rule as CannotRemoveOwnerError seen
 * from the other side: the owner membership is created with the household and
 * can never be revoked, so no path — removal or self-service leave — may leave
 * a household orphaned, with nobody who can write to it.
 */
export class CannotLeaveAsOwnerError extends AuthorizationError {
  constructor(householdId: string) {
    super(
      'The household owner cannot leave — the household would be left with nobody who can manage it',
      'CANNOT_LEAVE_AS_OWNER',
      { householdId }
    );
    this.name = 'CannotLeaveAsOwnerError';
  }
}

/**
 * 409 — the leaver is clocked in. Same strand as MemberHasRunningEntryError,
 * addressed to the person themselves rather than to a parent about someone
 * else: a distinct error exists purely so the message is second-person, since
 * "ask them to clock out first" is nonsense shown to the carer who IS them.
 */
export class CannotLeaveWhileClockedInError extends ConflictError {
  constructor(householdId: string) {
    super(
      'You are clocked in — clock out before leaving this household',
      'CANNOT_LEAVE_WHILE_CLOCKED_IN',
      { householdId }
    );
    this.name = 'CannotLeaveWhileClockedInError';
  }
}

/** 400 — removing yourself is not this endpoint; leaving a household is its own feature. */
export class CannotRemoveSelfError extends ValidationError {
  constructor(householdId: string) {
    super(
      'You cannot remove yourself from a household',
      'CANNOT_REMOVE_SELF',
      400,
      { householdId }
    );
    this.name = 'CannotRemoveSelfError';
  }
}

/**
 * 409 — the member is clocked in. Removing them would strand a running time
 * entry that nobody can close: they lose access to the household, and the
 * hours never reach a timesheet.
 */
export class MemberHasRunningEntryError extends ConflictError {
  constructor(memberId: string) {
    super(
      'This person is clocked in — ask them to clock out first',
      'MEMBER_HAS_RUNNING_ENTRY',
      { memberId }
    );
    this.name = 'MemberHasRunningEntryError';
  }
}

/**
 * 400 — the member PATCH only accepts `status: 'removed'`. Reactivating a
 * removed member is deliberately NOT a field a parent can set: it happens by
 * the person redeeming a fresh invite, so the single-use code stays the one
 * thing that grants household access.
 */
export class UnsupportedMemberUpdateError extends ValidationError {
  constructor() {
    super(
      "The only supported member update is status: 'removed' — to bring someone back, send them a new invite",
      'UNSUPPORTED_MEMBER_UPDATE',
      400
    );
    this.name = 'UnsupportedMemberUpdateError';
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

/**
 * 409 — `week_starts_on` cannot change once any timesheet exists for the
 * household. It defines pay-week boundaries (FLSA fixed workweek,
 * 075_household_week_starts_on.sql); moving it after hours have been
 * recorded against the old boundary would reprice weeks nobody re-approved.
 */
export class WeekStartLockedError extends ConflictError {
  constructor(householdId: string) {
    super(
      'Week start cannot change once hours have been recorded — it defines pay weeks',
      'WEEK_START_LOCKED',
      { householdId }
    );
    this.name = 'WeekStartLockedError';
  }
}
