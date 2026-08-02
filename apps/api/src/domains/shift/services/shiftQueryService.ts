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
 * ONE DELIBERATE WRITE FROM A READ: `listDayThread` runs the child domain's
 * coverage-gap detection (flow 1g) for the requested date before returning
 * the thread, so a household's gaps actually surface — nothing else invokes
 * it. `coverageGapService.raiseGapsOnce` is idempotent (it filters against
 * `shiftEventRepository.listEventKeysForDate` before inserting), so repeated
 * reads of the same day never double up the thread. Detection is
 * BEST-EFFORT: a failure is logged and swallowed, because a read endpoint
 * must still return the thread it was asked for.
 *
 * @module domains/shift/services/shiftQueryService
 */
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import { logger } from '../../../middlewares/logger';
// Import the child-domain files DIRECTLY — never the `../../child` barrel,
// whose services import back into the household/shift graph. Same rule
// `coverageGapService` itself follows for its shift-repository import.
import { ChildCommitmentRepository } from '../../child/repositories/childCommitmentRepository';
import type {
  GapCommitmentInput,
  GapShiftInput,
} from '../../child/services/coverageGapService';
import {
  type CoverageGapService,
  coverageGapService,
} from '../../child/services/coverageGapService';
import {
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import { ShiftNotFoundError } from '../errors/shiftErrors';
import { ShiftEventRepository } from '../repositories/shiftEventRepository';
import {
  ShiftRepository,
  type ShiftWithChildren,
} from '../repositories/shiftRepository';
import type { ShiftEvent } from '../types';

/** The narrow slice of the child domain's gap detector this read path needs. */
export type DayThreadGapRaiser = Pick<CoverageGapService, 'raiseGapsOnce'>;

export class ShiftQueryService {
  constructor(
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly commitmentRepo: ChildCommitmentRepository = new ChildCommitmentRepository(),
    private readonly gapService: DayThreadGapRaiser = coverageGapService
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
   * Distinct from the shift-scoped `listEvents` route. Raises that date's
   * coverage gaps first (see the module header) so they are part of the
   * thread this call returns.
   */
  async listDayThread(
    userId: string,
    householdId: string,
    localDate: string
  ): Promise<ShiftEvent[]> {
    await this.assertMember(userId, householdId);
    await this.raiseCoverageGaps(householdId, localDate);
    return this.eventRepo.listForHouseholdDate(householdId, localDate);
  }

  /**
   * Flow 1g: carve the day's `excluded_from_cover` commitments out of the
   * day's shift coverage and append any newly-found gap to the thread.
   * Idempotent per (child, commitment, interval) — see
   * `coverageGapService.raiseGapsOnce`. Best-effort: any failure is logged
   * and swallowed so the day thread still returns.
   */
  private async raiseCoverageGaps(
    householdId: string,
    localDate: string
  ): Promise<void> {
    try {
      const household = await this.householdRepo.findById(householdId);
      if (!household) {
        return;
      }
      const [shifts, commitments] = await Promise.all([
        this.shiftRepo.findByHouseholdAndLocalDate(householdId, localDate),
        this.commitmentRepo.findByHouseholdId(householdId),
      ]);
      await this.gapService.raiseGapsOnce(
        householdId,
        localDate,
        household.timezone,
        shifts.map(toGapShift),
        commitments.map(toGapCommitment)
      );
    } catch (error) {
      logger.error('Coverage-gap detection failed for a day thread', {
        householdId,
        localDate,
        error,
      });
    }
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

/** DB row -> the pure input shape `coverageGapService` consumes. */
function toGapShift(shift: ShiftWithChildren): GapShiftInput {
  return {
    id: shift.id,
    startsAt: shift.starts_at,
    endsAt: shift.ends_at,
    children: (shift.shift_children ?? []).map(child => ({
      childId: child.child_id,
      startsAt: child.starts_at,
      endsAt: child.ends_at,
    })),
  };
}

/** DB row -> the pure input shape `coverageGapService` consumes. */
function toGapCommitment(commitment: ChildCommitment): GapCommitmentInput {
  return {
    id: commitment.id,
    childId: commitment.child_id,
    rrule: commitment.rrule,
    startTime: commitment.start_time,
    endTime: commitment.end_time,
    startsOn: commitment.starts_on,
    endsOn: commitment.ends_on,
    exdates: commitment.exdates,
    excludedFromCover: commitment.excluded_from_cover,
  };
}

// Singleton for controllers/routes that don't need DI.
export const shiftQueryService = new ShiftQueryService();
