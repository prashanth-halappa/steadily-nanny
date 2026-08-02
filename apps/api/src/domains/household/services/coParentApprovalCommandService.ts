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
import {
  ApprovalNotFoundError,
  ApprovalNotPendingError,
  SelfApprovalNotAllowedError,
} from '../errors/approvalErrors';
import { CoParentApprovalRepository } from '../repositories/coParentApprovalRepository';
import { CO_PARENT_APPROVAL_STATUSES } from '../schemas';
import type {
  CoParentApproval,
  CoParentApprovalAction,
  RespondToCoParentApprovalInput,
} from '../types';
import { assertHouseholdWriteRole } from '../utils/assertHouseholdRole';
import { approvalApplierRegistry } from './approvalApplierRegistry';
import {
  type HouseholdQueryService,
  householdQueryService,
} from './householdQueryService';

export class CoParentApprovalCommandService {
  constructor(
    private readonly approvalRepo: CoParentApprovalRepository = new CoParentApprovalRepository(),
    private readonly households: HouseholdQueryService = householdQueryService
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
    return this.approvalRepo.create({
      household_id: householdId,
      requested_by: requestedBy,
      action,
      payload,
      status: CO_PARENT_APPROVAL_STATUSES.PENDING,
      timeout_at: timeoutAt,
    });
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
   * from the change having been applied.
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
      await approvalApplierRegistry.apply(responded);
    }

    return responded;
  }
}

// Singleton for controllers that don't need DI.
export const coParentApprovalCommandService =
  new CoParentApprovalCommandService();
