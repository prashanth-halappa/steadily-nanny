/**
 * Co-parent approval query service (CQRS-lite: reads). The `co_parent_approvals`
 * RLS policy restricts SELECT to household parents (see
 * `private.is_household_parent` in supabase/migrations/022_co_parent_approvals.sql);
 * this mirrors that with the same `assertHouseholdWriteRole` gate the command
 * side uses (owner_only/either/ask_other all still require owner-or-parent —
 * only WHETHER a solo owner/parent write needs the other's sign-off differs,
 * see `approvalGateService`).
 *
 * @module domains/household/services/coParentApprovalQueryService
 */

import { CoParentApprovalRepository } from '../repositories/coParentApprovalRepository';
import type { CoParentApproval } from '../types';
import { assertHouseholdWriteRole } from '../utils/assertHouseholdRole';
import { approvalApplierRegistry } from './approvalApplierRegistry';
import {
  type HouseholdQueryService,
  householdQueryService,
} from './householdQueryService';

export class CoParentApprovalQueryService {
  constructor(
    private readonly approvalRepo: CoParentApprovalRepository = new CoParentApprovalRepository(),
    private readonly households: HouseholdQueryService = householdQueryService
  ) {}

  /**
   * List a household's pending approvals. Expires any past-due pending rows
   * first (on-read auto-approve-by-silence) so a stale row is never shown as
   * still awaiting a response — see `expirePendingApprovals`.
   */
  async listPending(
    userId: string,
    householdId: string
  ): Promise<CoParentApproval[]> {
    const membership = await this.households.getMembership(userId, householdId);
    assertHouseholdWriteRole(householdId, membership);

    await this.expirePendingApprovals(householdId);
    return this.approvalRepo.listPendingByHousehold(householdId);
  }

  /**
   * Times out every still-`pending` approval whose `timeout_at` has passed —
   * a silent phone never blocks a day.
   *
   * Timing out means auto-APPROVE-by-silence (see the header of
   * supabase/migrations/022_co_parent_approvals.sql), so each expired row's
   * gated mutation is re-driven through `approvalApplierRegistry` exactly as
   * an explicit approval would be. Failures are logged and stepped over: this
   * runs as a sweep over many households, and one unappliable row must not
   * strand the rest.
   *
   * Scoped to one household when called on-read from `listPending`; scoped to
   * everything when called with no `householdId` by `scheduleHorizonJob`.
   */
  async expirePendingApprovals(
    householdId?: string
  ): Promise<CoParentApproval[]> {
    const expired = await this.approvalRepo.expireTimedOut(
      new Date().toISOString(),
      householdId
    );

    if (expired.length > 0) {
      await approvalApplierRegistry.applyAllSettled(expired);
    }

    return expired;
  }
}

// Singleton for controllers/routes that don't need DI.
export const coParentApprovalQueryService = new CoParentApprovalQueryService();
