/**
 * Shift query service (CQRS-lite: reads only). Ownership here is MEMBERSHIP
 * of the shift's household, exactly like the household/schedule domains —
 * see `../../household`, imported READ-ONLY for its
 * `HouseholdMemberRepository`. `getOwned` throws the SAME
 * `ShiftNotFoundError` whether the shift truly doesn't exist or the caller
 * just isn't a member of its household, so existence is never leaked to a
 * non-member.
 *
 * This domain only READS `shifts` (plus the one parent-edit write in
 * `shiftCommandService`) — the `schedule` domain's
 * `scheduleMaterialisationService`/`scheduleShiftRepository` is the sole
 * writer for pattern-driven create/update/delete, so there is no overlap.
 *
 * @module domains/shift/services/shiftQueryService
 */
import { HouseholdMemberRepository } from '../../household';
import { ShiftNotFoundError } from '../errors/shiftErrors';
import { ShiftEventRepository } from '../repositories/shiftEventRepository';
import {
  ShiftRepository,
  type ShiftWithChildren,
} from '../repositories/shiftRepository';
import type { ShiftEvent } from '../types';

export class ShiftQueryService {
  constructor(
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /**
   * The primary calendar feed: shifts overlapping `[from, to)`, each with
   * its children (no N+1 — see `ShiftRepository.findByHouseholdAndRange`).
   * Caller must be an active household member.
   */
  async listForHousehold(
    userId: string,
    householdId: string,
    from: string,
    to: string
  ): Promise<ShiftWithChildren[]> {
    await this.assertMember(userId, householdId);
    return this.shiftRepo.findByHouseholdAndRange(householdId, from, to);
  }

  /**
   * Fetch one shift with its children, enforcing membership. Throws
   * ShiftNotFoundError for both "doesn't exist" and "exists but you're not a
   * member of its household" — this is the `lookup` the ownership
   * middleware calls on /shifts/:shiftId routes.
   */
  async getOwned(userId: string, shiftId: string): Promise<ShiftWithChildren> {
    const shift = await this.shiftRepo.findByIdWithChildren(shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(shiftId);
    }
    const membership = await this.memberRepo.findActiveMembership(
      shift.household_id,
      userId
    );
    if (!membership) {
      throw new ShiftNotFoundError(shiftId);
    }
    return shift;
  }

  /** The append-only day thread for one shift. Caller must be an active household member. */
  async listEvents(
    userId: string,
    householdId: string,
    shiftId: string
  ): Promise<ShiftEvent[]> {
    await this.assertMember(userId, householdId);
    return this.eventRepo.listForShift(householdId, shiftId);
  }

  /**
   * Household + local_date day thread (includes nullable-shift_id events).
   * Distinct from the shift-scoped `listEvents` route.
   */
  async listDayThread(
    userId: string,
    householdId: string,
    localDate: string
  ): Promise<ShiftEvent[]> {
    await this.assertMember(userId, householdId);
    return this.eventRepo.listForHouseholdDate(householdId, localDate);
  }

  /** Membership check shared by every household-scoped read above. */
  private async assertMember(
    userId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new ShiftNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const shiftQueryService = new ShiftQueryService();
