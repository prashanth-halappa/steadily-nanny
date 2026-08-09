/**
 * Approval gate — the single choke point every OTHER domain's command
 * service (schedule, shift, timesheet, …) calls before applying a mutation
 * that might need owner-only gating (design flow 1f). Household
 * `approval_mode` decides who may act alone:
 *
 * - `owner_only`  — only the owner may proceed; anyone else is rejected.
 * - `either`      — any owner/parent may proceed alone.
 *
 * @module domains/household/services/approvalGateService
 */
import { NotHouseholdOwnerError } from '../errors/approvalErrors';
import { HOUSEHOLD_APPROVAL_MODES, HOUSEHOLD_ROLES } from '../schemas';
import type { Household, HouseholdMember } from '../types';
import { assertHouseholdWriteRole } from '../utils/assertHouseholdRole';

/** Actions that consult the owner-only gate before a parent mutation. */
export type ApprovalGateAction =
  | 'short_notice_change'
  | 'cancel'
  | 'extra_shift'
  | 'other';

export class ApprovalGateService {
  /**
   * Decide whether `membership` may apply `action` to `household` alone.
   * Throws `NotHouseholdOwnerError` when `approval_mode` is `owner_only` and
   * the caller is not the owner.
   */
  async assertApprovalAllows(
    household: Household,
    membership: HouseholdMember,
    _action: ApprovalGateAction,
    _payload: Record<string, unknown> = {}
  ): Promise<void> {
    if (household.approval_mode === HOUSEHOLD_APPROVAL_MODES.OWNER_ONLY) {
      if (membership.role !== HOUSEHOLD_ROLES.OWNER) {
        throw new NotHouseholdOwnerError(household.id, membership.role);
      }
      return;
    }

    // either — any owner/parent may proceed; a nanny/helper mutation is never
    // something the other parent approves.
    assertHouseholdWriteRole(household.id, membership);
  }
}

// Singleton for other domains' command services that don't need DI.
export const approvalGateService = new ApprovalGateService();
