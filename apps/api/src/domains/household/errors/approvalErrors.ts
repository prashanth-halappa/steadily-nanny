/**
 * Co-parent approval domain errors (design flow 1f).
 * @module domains/household/errors/approvalErrors
 */
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the approval does not exist OR it belongs to a different household
 * than the one in the URL. SAME error for both cases, exactly like
 * `HouseholdNotFoundError` — a caller must never learn that an approval id
 * exists in someone else's household.
 */
export class ApprovalNotFoundError extends NotFoundError {
  constructor(approvalId: string, metadata?: ErrorMetadata) {
    super('Approval not found', 'APPROVAL_NOT_FOUND', {
      approvalId,
      ...metadata,
    });
    this.name = 'ApprovalNotFoundError';
  }
}

/** 409 — `respond` was called on an approval that is no longer `pending` (already responded to, or timed out). */
export class ApprovalNotPendingError extends ConflictError {
  constructor(approvalId: string, status: string) {
    super(
      'This approval is no longer awaiting a response',
      'APPROVAL_NOT_PENDING',
      {
        approvalId,
        status,
      }
    );
    this.name = 'ApprovalNotPendingError';
  }
}

/**
 * 403 — the parent who OPENED the approval tried to respond to it. The whole
 * point of `approval_mode = 'ask_other'` is that the other parent signs off;
 * letting the requester approve their own request would make the gate
 * decorative. Timing out is the only way an unanswered request resolves
 * itself — see `coParentApprovalQueryService.expirePendingApprovals`.
 */
export class SelfApprovalNotAllowedError extends AuthorizationError {
  constructor(approvalId: string) {
    super(
      'You cannot respond to an approval you requested yourself',
      'SELF_APPROVAL_NOT_ALLOWED',
      { approvalId }
    );
    this.name = 'SelfApprovalNotAllowedError';
  }
}

/**
 * 409 — an applier threw while re-driving an approved mutation during
 * `respond()`. The approval was reverted to `pending` so it can be retried
 * (see `coParentApprovalCommandService.respond`) — this is a transient
 * conflict, not the responding parent's fault, so the raw internal applier
 * message (e.g. "Approval payload is missing the extra shift it was gating")
 * must never reach them. The underlying cause is logged in full by the
 * caller before this is thrown (O2).
 */
export class ApprovalApplyFailedError extends ConflictError {
  constructor(approvalId: string) {
    super(
      "This change couldn't be applied. It's been returned to pending so it can be tried again.",
      'APPROVAL_APPLY_FAILED',
      { approvalId }
    );
    this.name = 'ApprovalApplyFailedError';
  }
}

/**
 * 403 — the household's `approval_mode` is `owner_only` and the caller is an
 * active member but not the owner.
 */
export class NotHouseholdOwnerError extends AuthorizationError {
  constructor(householdId: string, role: string) {
    super('Only the household owner can perform this action', 'NOT_OWNER', {
      householdId,
      role,
    });
    this.name = 'NotHouseholdOwnerError';
  }
}
