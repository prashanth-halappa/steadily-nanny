/**
 * Shift command service (CQRS-lite: writes). This domain owns exactly ONE
 * write path — the parent-only time/note edit — deliberately narrow per the
 * wave-2 spec: accept/counter-offer/cancel/split are flows 1d/1e, out of
 * scope here. Setting `origin = 'parent_proposed'` on every edit is the
 * load-bearing part: it's exactly the flag
 * `scheduleMaterialisationService.isManuallyTouched` reads to decide "a
 * human touched this, do not overwrite it" on the next re-materialisation —
 * see that module's header comment.
 *
 * The write itself goes through `ShiftRepository.applyParentEdit` (Postgres
 * RPC) so the shift row update and the `shift_updated` day-thread event are
 * atomic (D23/D24). This service sends the edit INTENT only — the resulting
 * `sequence` and the event's before/after snapshots are derived inside the
 * RPC from the row it locks (migration 031), because this service's own read
 * is unlocked and a concurrent accept can land between the two.
 *
 * @module domains/shift/services/shiftCommandService
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ValidationError } from '../../../errors';
import {
  HOUSEHOLD_ROLES,
  type HouseholdMember,
  HouseholdMemberRepository,
  NotAHouseholdParentError,
} from '../../household';
import { ShiftRepository } from '../repositories/shiftRepository';
import type { ParentEditShiftInput } from '../types';
import { type ShiftQueryService, shiftQueryService } from './shiftQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

export class ShiftCommandService {
  constructor(
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly queries: ShiftQueryService = shiftQueryService
  ) {}

  /**
   * A parent edits a shift's time and/or note. Owner/parent only. Validates
   * the RESULTING range (existing time for any field the caller omitted),
   * since a one-sided `starts_at`-only edit can still violate
   * `shifts_time_order` against the shift's current `ends_at`.
   */
  async update(
    userId: string,
    shiftId: string,
    input: ParentEditShiftInput
  ): Promise<Shift> {
    const shift = await this.queries.getOwned(userId, shiftId);
    await this.assertWriteMember(userId, shift.household_id);

    const effectiveStarts = input.starts_at ?? shift.starts_at;
    const effectiveEnds = input.ends_at ?? shift.ends_at;
    if (effectiveEnds <= effectiveStarts) {
      throw new ValidationError(
        'ends_at must be after starts_at',
        'INVALID_SHIFT_TIME_RANGE',
        400,
        { shiftId, starts_at: effectiveStarts, ends_at: effectiveEnds }
      );
    }

    const setStartsAt = input.starts_at !== undefined;
    const setEndsAt = input.ends_at !== undefined;
    const setNote = input.note !== undefined;

    // Deliberately NOT sending a sequence or a before/after snapshot: the
    // read above is unlocked, so anything derived from it can be overtaken by
    // a concurrent accept before the RPC takes its lock. The RPC builds both
    // from the locked row — see migration 031.
    return this.shiftRepo.applyParentEdit({
      shiftId,
      actorId: userId,
      startsAt: input.starts_at ?? null,
      endsAt: input.ends_at ?? null,
      note: input.note ?? null,
      setStartsAt,
      setEndsAt,
      setNote,
      origin: 'parent_proposed',
    });
  }

  private async assertWriteMember(
    userId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new NotAHouseholdParentError(householdId, 'none');
    }
    this.assertWriteRole(householdId, membership);
  }

  private assertWriteRole(
    householdId: string,
    membership: HouseholdMember
  ): void {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const shiftCommandService = new ShiftCommandService();
