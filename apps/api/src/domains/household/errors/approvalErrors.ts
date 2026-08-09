/**
 * Co-parent approval domain errors (design flow 1f).
 * @module domains/household/errors/approvalErrors
 */
import { AuthorizationError } from '../../../errors';

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
