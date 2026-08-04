/**
 * Shift command service (CQRS-lite: writes). Owns the parent-only time/note
 * edit and the carer-only accept-pending path. Setting `origin =
 * 'parent_proposed'` on every parent edit is the load-bearing part: it's
 * exactly the flag `scheduleMaterialisationService.isManuallyTouched` reads
 * to decide "a human touched this, do not overwrite it" on the next
 * re-materialisation — see that module's header comment.
 *
 * Parent time edits go through `ShiftRepository.applyParentEdit` (Postgres
 * RPC) so the shift row update and the `shift_updated` day-thread event are
 * atomic (D23/D24). Time changes demote `confirmed` → `pending` inside the
 * RPC (migration 034); this service then fire-and-forget pushes the carer
 * with `shift_needs_reconfirm`. Note-only edits do not demote or push.
 *
 * @module domains/shift/services/shiftCommandService
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import {
  HOUSEHOLD_ROLES,
  type HouseholdMember,
  HouseholdMemberRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyUser } from '../../notification';
import { ShiftNotFoundError } from '../errors/shiftErrors';
import { ShiftEventRepository } from '../repositories/shiftEventRepository';
import { ShiftRepository } from '../repositories/shiftRepository';
import type { ParentEditShiftInput } from '../types';
import { type ShiftQueryService, shiftQueryService } from './shiftQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);
const CARER_ROLES: ReadonlySet<string> = new Set([HOUSEHOLD_ROLES.NANNY]);

export class ShiftCommandService {
  constructor(
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly queries: ShiftQueryService = shiftQueryService,
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository()
  ) {}

  /**
   * Assigned carer confirms a pending shift. Same not-found shape for
   * "missing", "not a member", and "not the assigned carer" — never leak
   * existence or assignment to the wrong party.
   *
   * Serialisation: soft `assertMutable` preflight + CAS `confirmPending`
   * (`UPDATE … WHERE status = 'pending'`). Not a FOR UPDATE RPC — that
   * path is reserved for change-request accept (migration 029). Concurrent
   * cancel/clock-in still 409s via assertMutable; a lost pending race
   * surfaces as not-found rather than confirming a non-pending row.
   */
  async accept(userId: string, shiftId: string): Promise<Shift> {
    const shift = await this.queries.getOwned(userId, shiftId);

    if (!shift.carer_id || shift.carer_id !== userId) {
      throw new ShiftNotFoundError(shiftId);
    }

    const membership = await this.memberRepo.findActiveMembership(
      shift.household_id,
      userId
    );
    if (!membership || !CARER_ROLES.has(membership.role)) {
      throw new ShiftNotFoundError(shiftId);
    }

    if (shift.status !== SHIFT_STATUSES.PENDING) {
      throw new ValidationError(
        'Only a pending shift can be accepted',
        'SHIFT_NOT_PENDING',
        400,
        { shiftId, status: shift.status }
      );
    }

    const updated = await this.shiftRepo.confirmPending(shiftId);

    // Fire-and-forget: confirmPending has already committed, so failing here
    // would 500 on a shift that IS confirmed and the retry would 400
    // SHIFT_NOT_PENDING. Nothing reads `shift_confirmed` — advisory audit only.
    try {
      await this.eventRepo.insertMany([
        {
          household_id: shift.household_id,
          shift_id: shift.id,
          local_date: shift.local_date,
          actor_id: userId,
          event_type: 'shift_confirmed',
          payload: {
            previous_status: shift.status,
          },
        },
      ]);
    } catch (error) {
      logger.warn(
        'Failed to record shift_confirmed event; shift is still confirmed',
        {
          shiftId: shift.id,
          householdId: shift.household_id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    return updated;
  }

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
    // Parse both sides: the stored field comes back as `+00:00`, a client edit
    // as `.000Z` — comparing those two serialisations as strings is unreliable.
    if (Date.parse(effectiveEnds) <= Date.parse(effectiveStarts)) {
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
    const timeChanged = setStartsAt || setEndsAt;

    // Deliberately NOT sending a sequence or a before/after snapshot: the
    // read above is unlocked, so anything derived from it can be overtaken by
    // a concurrent accept before the RPC takes its lock. The RPC builds both
    // from the locked row — see migration 031. Demotion confirmed→pending on
    // time change also happens inside the RPC (migration 034).
    const updated = await this.shiftRepo.applyParentEdit({
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

    const carerId = updated.carer_id;
    if (timeChanged && carerId) {
      this.notifyNeedsReconfirm(updated, carerId);
    }

    return updated;
  }

  /** Fire-and-forget: carer must reconfirm after a parent time edit. */
  private notifyNeedsReconfirm(shift: Shift, carerId: string): void {
    try {
      notifyUser(carerId, {
        title: 'Shift needs reconfirmation',
        body: 'A parent changed the times — open Schedule to confirm.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM,
          shiftId: shift.id,
          householdId: shift.household_id,
        },
      });
    } catch {
      // notifyUser is fire-and-forget; never fail the write.
    }
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
