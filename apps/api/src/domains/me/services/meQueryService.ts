/**
 * Me query service — the caller's cross-household read surface.
 *
 * A nanny with three families must not have to query three household ids by
 * hand. This service lists every shift where the caller is the assigned
 * carer, across every household they actively belong to, and attaches the
 * caller's `membership_role` in that household.
 *
 * It also lists pending change requests awaiting the caller's response across
 * those same households (inbox / NeedsAttentionCard) — one round-trip instead
 * of N per-shift lists.
 *
 * Authorization is membership: we only walk households returned by
 * `HouseholdMemberRepository.listActiveByUser`. Shifts assigned to other
 * carers in those households are filtered out of `listMyShifts` — that is
 * "my shifts", not a household calendar. `listPendingChangeRequestsAwaitingMe`
 * is household-scoped (any member can be the party who must respond).
 *
 * @module domains/me/services/meQueryService
 */
import type { MeShift } from '@steadily-nanny/shared-types/schemas/me.schema';
import type { ShiftChangeRequest } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { HouseholdMemberRepository } from '../../household';
import { ShiftChangeRequestRepository } from '../../shift/repositories/shiftChangeRequestRepository';
import {
  ShiftRepository,
  type ShiftWithChildren,
} from '../../shift/repositories/shiftRepository';

/** Narrow contracts for constructor DI in unit tests. */
export interface MeMembershipLister {
  listActiveByUser(
    userId: string
  ): Promise<Array<{ household_id: string; role: MeShift['membership_role'] }>>;
}

export interface MeShiftRangeLister {
  findByHouseholdAndRange(
    householdId: string,
    from: string,
    to: string
  ): Promise<ShiftWithChildren[]>;
}

export interface MePendingChangeRequestLister {
  listPendingByShiftIds(shiftIds: string[]): Promise<ShiftChangeRequest[]>;
}

export class MeQueryService {
  constructor(
    private readonly memberRepo: MeMembershipLister = new HouseholdMemberRepository(),
    private readonly shiftRepo: MeShiftRangeLister = new ShiftRepository(),
    private readonly changeRequestRepo: MePendingChangeRequestLister = new ShiftChangeRequestRepository()
  ) {}

  /**
   * The caller's own shifts overlapping `[from, to)` across every active
   * household membership. Sorted by `starts_at` ascending.
   */
  async listMyShifts(
    userId: string,
    from: string,
    to: string
  ): Promise<MeShift[]> {
    const memberships = await this.memberRepo.listActiveByUser(userId);
    if (memberships.length === 0) {
      return [];
    }

    const roleByHousehold = new Map(
      memberships.map(m => [m.household_id, m.role])
    );
    const householdIds = [...roleByHousehold.keys()];

    const perHousehold = await Promise.all(
      householdIds.map(householdId =>
        this.shiftRepo.findByHouseholdAndRange(householdId, from, to)
      )
    );

    const mine: MeShift[] = [];
    for (const shifts of perHousehold) {
      for (const shift of shifts) {
        if (shift.carer_id !== userId) continue;
        const membership_role = roleByHousehold.get(shift.household_id);
        if (!membership_role) continue;
        mine.push({ ...shift, membership_role });
      }
    }

    mine.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return mine;
  }

  /**
   * Pending change requests on shifts in the caller's households overlapping
   * `[from, to)`, where someone else opened the request (awaiting the
   * caller's response). Matches `buildInboxItems` change-request gating.
   */
  async listPendingChangeRequestsAwaitingMe(
    userId: string,
    from: string,
    to: string
  ): Promise<ShiftChangeRequest[]> {
    const memberships = await this.memberRepo.listActiveByUser(userId);
    if (memberships.length === 0) {
      return [];
    }

    const householdIds = memberships.map(m => m.household_id);
    const perHousehold = await Promise.all(
      householdIds.map(householdId =>
        this.shiftRepo.findByHouseholdAndRange(householdId, from, to)
      )
    );
    const shiftIds = perHousehold.flat().map(shift => shift.id);
    const pending =
      await this.changeRequestRepo.listPendingByShiftIds(shiftIds);

    // Inbox only surfaces requests the caller did not open themselves.
    return pending.filter(req => req.requested_by !== userId);
  }
}

// Singleton for controllers/routes that don't need DI.
export const meQueryService = new MeQueryService();
