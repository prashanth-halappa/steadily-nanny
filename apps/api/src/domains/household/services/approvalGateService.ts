/**
 * Approval gate — the single choke point every OTHER domain's command
 * service (schedule, shift, timesheet, …) calls before applying a mutation
 * that might need co-parent sign-off (design flow 1f). Household
 * `approval_mode` decides who may act alone:
 *
 * - `owner_only`  — only the owner may proceed; anyone else is rejected.
 * - `either`      — any owner/parent may proceed alone, no approval needed.
 * - `ask_other`   — an owner/parent may proceed alone UNLESS `action` is
 *   in the household's `approval_scope` (`all` -> everything;
 *   `short_notice_and_cancellations` -> `cancel` + `short_notice_change`
 *   only), in which case a pending `co_parent_approvals` row is created and
 *   the caller must NOT apply the mutation yet.
 *
 * Callers branch on the returned `needsApproval` flag rather than a thrown
 * error for the ask_other/pending case — creating the approval row IS the
 * expected outcome of calling this, not a failure.
 *
 * @module domains/household/services/approvalGateService
 */
import { NotHouseholdOwnerError } from '../errors/approvalErrors';
import { CoParentApprovalRepository } from '../repositories/coParentApprovalRepository';
import {
  CO_PARENT_APPROVAL_STATUSES,
  HOUSEHOLD_APPROVAL_MODES,
  HOUSEHOLD_APPROVAL_SCOPES,
  HOUSEHOLD_ROLES,
} from '../schemas';
import type {
  CoParentApproval,
  CoParentApprovalAction,
  Household,
  HouseholdMember,
} from '../types';
import { assertHouseholdWriteRole } from '../utils/assertHouseholdRole';

/** The two shapes `assertApprovalAllows` can resolve to. */
export type ApprovalGateResult =
  | { needsApproval: false }
  | { needsApproval: true; approval: CoParentApproval };

const SHORT_NOTICE_AND_CANCELLATION_ACTIONS: ReadonlySet<CoParentApprovalAction> =
  new Set(['cancel', 'short_notice_change']);

export class ApprovalGateService {
  constructor(
    private readonly approvalRepo: CoParentApprovalRepository = new CoParentApprovalRepository()
  ) {}

  /**
   * Decide whether `membership` may apply `action` to `household` alone, or
   * must wait for the other parent. `payload` is the opaque data the
   * applying side will need to reconstruct the mutation once approved (e.g.
   * a shift id and proposed times) — stored as-is on the approval row.
   */
  async assertApprovalAllows(
    household: Household,
    membership: HouseholdMember,
    action: CoParentApprovalAction,
    payload: Record<string, unknown> = {}
  ): Promise<ApprovalGateResult> {
    if (household.approval_mode === HOUSEHOLD_APPROVAL_MODES.OWNER_ONLY) {
      if (membership.role !== HOUSEHOLD_ROLES.OWNER) {
        throw new NotHouseholdOwnerError(household.id, membership.role);
      }
      return { needsApproval: false };
    }

    // either / ask_other both require an owner/parent caller to begin with —
    // a nanny/helper mutation is never something the OTHER PARENT approves.
    assertHouseholdWriteRole(household.id, membership);

    if (household.approval_mode === HOUSEHOLD_APPROVAL_MODES.EITHER) {
      return { needsApproval: false };
    }

    if (!this.isInScope(household.approval_scope, action)) {
      return { needsApproval: false };
    }

    const timeoutAt = new Date(
      Date.now() + household.approval_timeout_minutes * 60_000
    ).toISOString();
    const approval = await this.approvalRepo.create({
      household_id: household.id,
      requested_by: membership.user_id,
      action,
      payload,
      status: CO_PARENT_APPROVAL_STATUSES.PENDING,
      timeout_at: timeoutAt,
    });
    return { needsApproval: true, approval };
  }

  private isInScope(
    scope: Household['approval_scope'],
    action: CoParentApprovalAction
  ): boolean {
    if (scope === HOUSEHOLD_APPROVAL_SCOPES.ALL) {
      return true;
    }
    return SHORT_NOTICE_AND_CANCELLATION_ACTIONS.has(action);
  }
}

// Singleton for other domains' command services that don't need DI.
export const approvalGateService = new ApprovalGateService();
