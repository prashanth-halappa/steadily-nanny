/**
 * Co-parent approval command service (CQRS-lite: writes).
 *
 * `create` is deliberately NOT wired to an HTTP route — a client must never
 * be able to open an arbitrary pending approval for an arbitrary action.
 * It's called internally by other domains' command services (schedule,
 * shift, timesheet, …), typically via `approvalGateService.assertApprovalAllows`
 * rather than this method directly; it's exposed here too for a domain that
 * wants to open an approval without the mode/scope gate (e.g. always asking
 * for extra-shift sign-off regardless of `approval_scope`).
 *
 * @module domains/household/services/coParentApprovalCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { logger } from '../../../middlewares/logger';
import { notifyUser } from '../../notification';
import {
  ApprovalApplyFailedError,
  ApprovalNotFoundError,
  ApprovalNotPendingError,
  SelfApprovalNotAllowedError,
} from '../errors/approvalErrors';
import { CoParentApprovalRepository } from '../repositories/coParentApprovalRepository';
import { HouseholdMemberRepository } from '../repositories/householdMemberRepository';
import { CO_PARENT_APPROVAL_STATUSES, HOUSEHOLD_ROLES } from '../schemas';
import type {
  CoParentApproval,
  CoParentApprovalAction,
  RespondToCoParentApprovalInput,
} from '../types';
import { assertHouseholdWriteRole } from '../utils/assertHouseholdRole';
import {
  approvalApplierRegistry,
  failureCostsAttempt,
  notifyRequesterApplyFailed,
} from './approvalApplierRegistry';
import {
  type HouseholdQueryService,
  householdQueryService,
} from './householdQueryService';

const PARENT_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

function approvalActionLabel(action: CoParentApprovalAction): string {
  switch (action) {
    case 'short_notice_change':
      return 'short-notice schedule change';
    case 'cancel':
      return 'shift cancellation';
    case 'extra_shift':
      return 'extra shift';
    case 'other':
      return 'schedule change';
    default:
      return 'schedule change';
  }
}

function formatApprovalDeadline(timeoutAt: string): string {
  return new Date(timeoutAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export class CoParentApprovalCommandService {
  constructor(
    private readonly approvalRepo: CoParentApprovalRepository = new CoParentApprovalRepository(),
    private readonly households: HouseholdQueryService = householdQueryService,
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /** Open a pending approval directly, bypassing the mode/scope gate. */
  async create(
    householdId: string,
    requestedBy: string,
    action: CoParentApprovalAction,
    payload: Record<string, unknown>,
    timeoutMinutes: number
  ): Promise<CoParentApproval> {
    const timeoutAt = new Date(
      Date.now() + timeoutMinutes * 60_000
    ).toISOString();
    const approval = await this.approvalRepo.create({
      household_id: householdId,
      requested_by: requestedBy,
      action,
      payload,
      status: CO_PARENT_APPROVAL_STATUSES.PENDING,
      timeout_at: timeoutAt,
    });
    this.notifyOtherParentsApprovalRequested(
      householdId,
      requestedBy,
      action,
      timeoutAt
    );
    return approval;
  }

  /**
   * The OTHER parent approves or declines. Owner/parent only — same write
   * gate as every other household mutation; a nanny/helper has no say in
   * co-parent sign-off — and never the requester themselves, or `ask_other`
   * would gate nothing at all.
   *
   * On approval the gated mutation is re-driven through
   * `approvalApplierRegistry`; an applier failure propagates rather than being
   * swallowed, because a silent no-op here is indistinguishable to the user
   * from the change having been applied. `respond` has already CAS'd the row
   * to `approved` by then, so a failure ALSO reverts that claim — otherwise
   * the row is terminally approved with the payload never applied and no
   * retry possible (the second `respond` would fail the `pending` CAS).
   */
  async respond(
    userId: string,
    householdId: string,
    approvalId: string,
    input: RespondToCoParentApprovalInput
  ): Promise<CoParentApproval> {
    const membership = await this.households.getMembership(userId, householdId);
    assertHouseholdWriteRole(householdId, membership);

    const approval = await this.approvalRepo.findById(approvalId);
    if (!approval || approval.household_id !== householdId) {
      throw new ApprovalNotFoundError(approvalId);
    }
    if (approval.requested_by === userId) {
      throw new SelfApprovalNotAllowedError(approvalId);
    }
    if (approval.status !== CO_PARENT_APPROVAL_STATUSES.PENDING) {
      throw new ApprovalNotPendingError(approvalId, approval.status);
    }

    const responded = await this.approvalRepo.respond(
      approvalId,
      input.status,
      userId
    );

    if (responded.status === CO_PARENT_APPROVAL_STATUSES.APPROVED) {
      try {
        await approvalApplierRegistry.apply(responded);
        await this.clearApplyMarkers(responded);
      } catch (error) {
        await this.recordFailedApply(responded, error);
        // O2: the raw internal applier message (e.g. a missing-payload-key
        // error) must never reach the responding parent — log it in full
        // here, then surface a clean, typed error instead. The revert to
        // `pending` above is unchanged; only what's thrown back changes.
        logger.error(
          "Co-parent approval applier failed on respond; reverted to 'pending'",
          {
            approvalId: responded.id,
            householdId: responded.household_id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        throw new ApprovalApplyFailedError(responded.id);
      }
    }

    this.notifyRequesterApprovalResolved(responded);

    return responded;
  }

  /**
   * Best-effort bookkeeping for the `approved` claim after a failed apply, so
   * the request goes back to awaiting a response (or settles as terminally
   * failed) instead of sitting approved with nothing applied. A failure here
   * must never mask the applier error the caller is about to see.
   */
  private async recordFailedApply(
    approval: CoParentApproval,
    cause: unknown
  ): Promise<void> {
    const reason = cause instanceof Error ? cause.message : String(cause);
    try {
      const outcome = await this.approvalRepo.recordFailedApply(
        approval,
        CO_PARENT_APPROVAL_STATUSES.APPROVED,
        reason,
        failureCostsAttempt(cause)
      );
      // D3: exhausted retries on the respond-path — same terminal push as the
      // expiry sweep's `applyAllSettled` (`approvalApplierRegistry`), so a
      // failed apply never vanishes silently regardless of which path hit it.
      if (outcome === 'failed') {
        notifyRequesterApplyFailed(approval);
      }
    } catch (error) {
      logger.error('Failed to record an approval whose applier threw', {
        approvalId: approval.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Best-effort; a stale marker must never fail an apply that just succeeded. */
  private async clearApplyMarkers(approval: CoParentApproval): Promise<void> {
    try {
      await this.approvalRepo.clearApplyMarkers(approval);
    } catch (error) {
      logger.error('Failed to clear approval apply markers', {
        approvalId: approval.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** The other parent must respond before silence auto-approves the request. */
  private notifyOtherParentsApprovalRequested(
    householdId: string,
    requestedBy: string,
    action: CoParentApprovalAction,
    timeoutAt: string
  ): void {
    void this.memberRepo
      .listActiveByHousehold(householdId)
      .then(members => {
        const recipients = members.filter(
          m => PARENT_ROLES.has(m.role) && m.user_id !== requestedBy
        );
        const actionLabel = approvalActionLabel(action);
        const deadline = formatApprovalDeadline(timeoutAt);
        const payload = {
          title: 'Approval needed',
          body: `Your co-parent needs you to approve a ${actionLabel}. Respond by ${deadline}.`,
          data: {
            type: PUSH_NOTIFICATION_TYPES.CO_PARENT_APPROVAL_REQUESTED,
            householdId,
          },
        };
        for (const member of recipients) {
          try {
            notifyUser(member.user_id, payload);
          } catch {
            // notifyUser is sync fire-and-forget; swallow any unexpected throw
          }
        }
      })
      .catch(error => {
        logger.error('Failed to notify other parent of approval request', {
          householdId,
          requestedBy,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /** Tell the waiting parent their co-parent answered — distinct from any applier push. */
  private notifyRequesterApprovalResolved(approval: CoParentApproval): void {
    // `requested_by` is nullable: an approval parked by a system path has no
    // waiting human, so there is nobody to tell the outcome to.
    const requestedBy = approval.requested_by;
    if (!requestedBy) return;

    const actionLabel = approvalActionLabel(approval.action);
    const approved = approval.status === CO_PARENT_APPROVAL_STATUSES.APPROVED;
    const body = approved
      ? `Your co-parent approved your request for a ${actionLabel}.`
      : `Your co-parent declined your request for a ${actionLabel}.`;
    try {
      notifyUser(requestedBy, {
        title: approved ? 'Request approved' : 'Request declined',
        body,
        data: {
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_APPROVAL_RESOLVED,
          householdId: approval.household_id,
        },
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw
    }
  }
}

// Singleton for controllers that don't need DI.
export const coParentApprovalCommandService =
  new CoParentApprovalCommandService();
