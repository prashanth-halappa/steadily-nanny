/**
 * Shift command service (CQRS-lite: writes). Owns the parent-only time/note
 * edit and the carer-only accept/decline-pending pair. Setting `origin =
 * 'parent_proposed'` on every parent edit is the load-bearing part: it's
 * exactly the flag `scheduleMaterialisationService.isManuallyTouched` reads
 * to decide "a human touched this, do not overwrite it" on the next
 * re-materialisation — see that module's header comment.
 *
 * Parent time edits go through `ShiftRepository.applyParentEdit` (Postgres
 * RPC) so the shift row update and the `shift_updated` day-thread event are
 * atomic (D23/D24). Time changes demote `confirmed` → `pending` inside the
 * RPC (migration 071 value diff); this service then fire-and-forget pushes
 * the carer with `shift_needs_reconfirm` only when the RPC actually demoted
 * confirmed → pending. Resent-identical times and note-only edits do not demote
 * or push.
 *
 * @module domains/shift/services/shiftCommandService
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  SHIFT_KINDS,
  SHIFT_ORIGINS,
  SHIFT_STATUSES,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import {
  type ChildQueryService,
  childQueryService,
} from '../../child/services/childQueryService';
import { detectUncoveredCareForDate } from '../../child/services/detectUncoveredCareForDate';
import {
  HOUSEHOLD_ROLES,
  type HouseholdMember,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyHouseholdParents, notifyUser } from '../../notification';
import { ShiftNotFoundError } from '../errors/shiftErrors';
import { ShiftEventRepository } from '../repositories/shiftEventRepository';
import type { ShiftWithChildren } from '../repositories/shiftRepository';
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
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository(),
    private readonly children: ChildQueryService = childQueryService,
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository()
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

    // Parents need to know the nanny accepted — they cannot see this from the carer app.
    try {
      notifyHouseholdParents(shift.household_id, {
        title: 'Shift confirmed',
        body: 'The nanny confirmed a pending shift.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CONFIRMED,
          shiftId: updated.id,
          householdId: shift.household_id,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw.
    }

    return updated;
  }

  /**
   * Assigned carer declines a pending shift — the symmetric "no" to
   * `accept`, and gated identically: same assigned-carer check, same
   * not-found shape for "missing" / "not a member" / "not the assigned
   * carer", same soft `assertMutable` preflight + CAS write
   * (`declinePending`).
   *
   * `pending` is the ONLY source state. A confirmed shift is not declined,
   * it is cancelled or change-requested (the parent has already planned
   * around it and, on the money side, a late cancel can be payable);
   * draft/cancelled/completed/declined are not the carer's to answer at all.
   * `assertMutable` additionally refuses a shift anyone has clocked into —
   * worked reality must not be un-scheduled out from under the timesheet.
   */
  async decline(userId: string, shiftId: string): Promise<Shift> {
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
        'Only a pending shift can be declined',
        'SHIFT_NOT_PENDING',
        400,
        { shiftId, status: shift.status }
      );
    }

    const updated = await this.shiftRepo.declinePending(shiftId);

    // Fire-and-forget for the same reason as `accept`: declinePending has
    // already committed, so failing here would 500 on a shift that IS
    // declined and the retry would 400 SHIFT_NOT_PENDING.
    //
    // KEYED (migration 025), unlike `shift_confirmed`: `declined` is terminal
    // — there is no path back to pending — so at most one `shift_declined`
    // may ever exist per shift, and the partial unique index on
    // (household_id, local_date, event_type, payload->>'key') enforces it.
    // Accept must stay unkeyed: a parent time edit demotes confirmed →
    // pending (migration 034), so the same shift can legitimately be
    // confirmed more than once and a key would swallow the later ones.
    try {
      await this.eventRepo.insertMany([
        {
          household_id: shift.household_id,
          shift_id: shift.id,
          local_date: shift.local_date,
          actor_id: userId,
          event_type: 'shift_declined',
          payload: {
            previous_status: shift.status,
            key: shift.id,
          },
        },
      ]);
    } catch (error) {
      logger.warn(
        'Failed to record shift_declined event; shift is still declined',
        {
          shiftId: shift.id,
          householdId: shift.household_id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // Parents need to know: the family now has a gap where they thought they
    // had cover, and they cannot see the refusal from the carer app — unless
    // uncovered-care detection already pushed for the gap (one parent push per
    // event).
    let uncoveredInserted: Awaited<
      ReturnType<typeof detectUncoveredCareForDate>
    > = [];
    try {
      uncoveredInserted = await detectUncoveredCareForDate({
        householdId: shift.household_id,
        localDate: shift.local_date,
        cause: 'declined',
        actorId: userId,
      });
    } catch (error) {
      logger.error('Uncovered-care detection failed after decline', {
        shiftId: shift.id,
        householdId: shift.household_id,
        localDate: shift.local_date,
        error,
      });
    }

    if (uncoveredInserted.length === 0) {
      // Fire-and-forget, and NOT awaited: the enriched copy needs a member
      // lookup and a child lookup, and neither belongs on the critical path of
      // her decline. A slow or failing directory read must never delay — or
      // fail — the act of saying no. On any error we still send, with the
      // generic body.
      void this.buildDeclinePushBody(userId, shift)
        .catch(error => {
          logger.warn(
            'Failed to build decline push copy; sending generic body',
            {
              shiftId: shift.id,
              householdId: shift.household_id,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          return 'The nanny declined a pending shift.';
        })
        .then(body => {
          try {
            notifyHouseholdParents(shift.household_id, {
              title: 'Shift declined',
              body,
              data: {
                type: PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED,
                shiftId: updated.id,
                householdId: shift.household_id,
              },
            });
          } catch {
            // notifyHouseholdParents is sync fire-and-forget; swallow.
          }
        });
    }

    return updated;
  }

  /**
   * Parent marks themselves as covering a need window — writes a real
   * `parent_cover` shift with no carer so the uncovered alert clears.
   */
  async createParentCover(
    userId: string,
    householdId: string,
    input: { starts_at: string; ends_at: string; child_id: string }
  ): Promise<Shift> {
    await this.assertWriteMember(userId, householdId);
    await this.children.getOwned(userId, householdId, input.child_id);

    const household = await this.householdRepo.findById(householdId);
    if (!household) {
      throw new ShiftNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }

    // ponytail: check-then-act; a unique index like 059's if double-submit ever shows up in the wild
    const existing = await this.shiftRepo.findParentCoverInWindow(
      householdId,
      input.starts_at,
      input.ends_at
    );
    if (existing) {
      return existing;
    }

    const shift = await this.shiftRepo.createShift({
      household_id: householdId,
      carer_id: null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      timezone: household.timezone,
      kind: SHIFT_KINDS.PARENT_COVER,
      status: SHIFT_STATUSES.CONFIRMED,
      origin: SHIFT_ORIGINS.PARENT_COVER,
      created_by: userId,
    });

    await this.shiftRepo.insertChildren(shift.id, [input.child_id]);

    try {
      await this.eventRepo.insertMany([
        {
          household_id: householdId,
          shift_id: shift.id,
          local_date: shift.local_date,
          actor_id: userId,
          event_type: 'parent_cover_added',
          payload: {
            shift_id: shift.id,
            child_id: input.child_id,
          },
        },
      ]);
    } catch (error) {
      logger.warn(
        'Failed to record parent_cover_added event; shift is still created',
        {
          shiftId: shift.id,
          householdId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    await this.notifyCarersParentCover(householdId, shift);

    return shift;
  }

  /**
   * Assigned carer signals she is running late — a message to parents, not a
   * punctuality metric. Deliberately carries no minutes or ETA in the event
   * payload so nothing downstream can build a lateness record from it.
   */
  async runningLate(userId: string, shiftId: string): Promise<void> {
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

    if (
      shift.status !== SHIFT_STATUSES.PENDING &&
      shift.status !== SHIFT_STATUSES.CONFIRMED
    ) {
      throw new ValidationError(
        'Only a pending or confirmed shift can be marked running late',
        'SHIFT_NOT_RUNNING_LATE_ELIGIBLE',
        400,
        { shiftId, status: shift.status }
      );
    }

    try {
      await this.eventRepo.insertMany([
        {
          household_id: shift.household_id,
          shift_id: shift.id,
          local_date: shift.local_date,
          actor_id: userId,
          event_type: 'running_late',
          payload: {
            shift_id: shift.id,
          },
        },
      ]);
    } catch (error) {
      logger.warn('Failed to record running_late event; push still sent', {
        shiftId: shift.id,
        householdId: shift.household_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const carerName = await this.resolveCarerDisplayName(
        shift.household_id,
        userId
      );
      notifyHouseholdParents(shift.household_id, {
        title: 'Running late',
        body: `${carerName} says she's running late.`,
        data: {
          type: 'running_late',
          shiftId: shift.id,
          householdId: shift.household_id,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw.
    }
  }

  /**
   * Undo a parent-cover shift — hard-deletes only `parent_cover` rows so this
   * cannot become a way to delete a real shift.
   */
  async removeParentCover(userId: string, shiftId: string): Promise<void> {
    const shift = await this.queries.getOwned(userId, shiftId);
    await this.assertWriteMember(userId, shift.household_id);

    if (shift.kind !== SHIFT_KINDS.PARENT_COVER) {
      throw new ValidationError(
        'Only a parent-cover shift can be removed this way',
        'SHIFT_NOT_PARENT_COVER',
        400,
        { shiftId, kind: shift.kind }
      );
    }

    await this.shiftRepo.delete(shiftId);
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

    // `applyParentEdit` is an RPC, so it bypasses the repository's guarded
    // `update()` and its settled-reality check with it. Without this, a parent
    // could rewrite the span of a shift the carer is CLOCKED INTO: clock-out
    // then freezes `scheduled_minutes` from the edited times
    // (`timesheetCommandService.freezeScheduledMinutes`) and the consent trail
    // records an edit to a shift that was already being worked. Same soft
    // preflight as `accept` — the hard serialisation would have to live inside
    // the RPC, under its FOR UPDATE lock.
    await this.shiftRepo.assertMutable(shiftId);

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

    // Deliberately NOT sending a sequence or a before/after snapshot: the
    // read above is unlocked, so anything derived from it can be overtaken by
    // a concurrent accept before the RPC takes its lock. The RPC builds both
    // from the locked row — see migration 031. Demotion confirmed→pending on
    // a real time change also happens inside the RPC (migration 071 value diff).
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
    const demoted =
      updated.status === SHIFT_STATUSES.PENDING &&
      shift.status === SHIFT_STATUSES.CONFIRMED;
    if (demoted && carerId) {
      this.notifyNeedsReconfirm(updated, carerId);
    }

    return updated;
  }

  private async buildDeclinePushBody(
    carerId: string,
    shift: ShiftWithChildren
  ): Promise<string> {
    const carerName = await this.resolveCarerDisplayName(
      shift.household_id,
      carerId
    );
    const childName = await this.resolvePrimaryChildName(carerId, shift);
    const dayLabel = formatPushShortDate(shift.local_date, shift.timezone);
    const startLabel = formatPushTime12h(shift.starts_at, shift.timezone);
    const endLabel = formatPushTime12h(shift.ends_at, shift.timezone);
    return `${carerName} turned down ${dayLabel}, ${startLabel}–${endLabel} (${childName}).`;
  }

  private async resolveCarerDisplayName(
    householdId: string,
    carerId: string
  ): Promise<string> {
    const member = await this.memberRepo.findActiveMembership(
      householdId,
      carerId
    );
    const override = member?.display_name_override?.trim();
    if (override) {
      return override;
    }
    try {
      const members = await this.memberRepo.listActiveByHousehold(householdId);
      const profile = members
        .find(m => m.user_id === carerId)
        ?.profile_name?.trim();
      if (profile) {
        return profile;
      }
    } catch {
      // Partial mocks in unit tests may omit listActiveByHousehold.
    }
    return 'The nanny';
  }

  private async resolvePrimaryChildName(
    actorId: string,
    shift: ShiftWithChildren
  ): Promise<string> {
    try {
      const childId = shift.shift_children[0]?.child_id;
      if (childId) {
        const child = await this.children.getOwned(
          actorId,
          shift.household_id,
          childId
        );
        return child.name.trim() || 'your child';
      }
      const children = await this.children.listForHousehold(
        actorId,
        shift.household_id
      );
      const fallbackName = children[0]?.name?.trim();
      return fallbackName || 'your child';
    } catch {
      return 'your child';
    }
  }

  /** Quiet FYI — both sentences or neither per carer. */
  private async notifyCarersParentCover(
    householdId: string,
    cover: Shift
  ): Promise<void> {
    try {
      const [members, dayShifts] = await Promise.all([
        this.memberRepo.listActiveByHousehold(householdId),
        this.shiftRepo.findByHouseholdAndLocalDate(
          householdId,
          cover.local_date
        ),
      ]);
      const carers = members.filter(member => CARER_ROLES.has(member.role));
      for (const carer of carers) {
        const nextShift = dayShifts
          .filter(
            shift =>
              shift.carer_id === carer.user_id &&
              (shift.status === SHIFT_STATUSES.PENDING ||
                shift.status === SHIFT_STATUSES.CONFIRMED) &&
              Date.parse(shift.starts_at) >= Date.parse(cover.ends_at)
          )
          .sort(
            (left, right) =>
              Date.parse(left.starts_at) - Date.parse(right.starts_at)
          )[0];

        if (!nextShift || nextShift.starts_at !== cover.ends_at) {
          continue;
        }

        const startLabel = formatPushTimePlain(cover.starts_at, cover.timezone);
        const endLabel = formatPushTimePlain(cover.ends_at, cover.timezone);
        const nextStart = formatPushTimePlain(
          nextShift.starts_at,
          cover.timezone
        );

        try {
          notifyUser(carer.user_id, {
            title: 'Parent is covering',
            body: `Parent is covering ${startLabel} – ${endLabel}. Your day starts ${nextStart} as planned.`,
            data: {
              type: 'parent_covering',
              shiftId: cover.id,
              householdId,
            },
          });
        } catch {
          // notifyUser is sync fire-and-forget; swallow any unexpected throw.
        }
      }
    } catch (error) {
      logger.error('Failed to notify carers of parent cover', {
        householdId,
        shiftId: cover.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

function formatPushShortDate(localDate: string, timeZone: string): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${localDate}T12:00:00`));
    return formatted.replace(',', '');
  } catch {
    return localDate;
  }
}

function formatPushTime12h(instantIso: string, timeZone: string): string {
  const instant = new Date(instantIso);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(instant);
    const hour = parts.find(part => part.type === 'hour')?.value ?? '0';
    const minute = parts.find(part => part.type === 'minute')?.value ?? '00';
    const dayPeriod = (
      parts.find(part => part.type === 'dayPeriod')?.value ?? 'am'
    ).toLowerCase();
    return `${hour}:${minute} ${dayPeriod}`;
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(instant)
      .toLowerCase();
  }
}

function formatPushTimePlain(instantIso: string, timeZone: string): string {
  const instant = new Date(instantIso);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const hour = parts.find(part => part.type === 'hour')?.value ?? '0';
    const minute = parts.find(part => part.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
  } catch {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const hour = parts.find(part => part.type === 'hour')?.value ?? '0';
    const minute = parts.find(part => part.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
  }
}
