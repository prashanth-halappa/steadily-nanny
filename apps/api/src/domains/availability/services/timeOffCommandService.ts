/**
 * Time-off command service (CQRS-lite: writes).
 *
 * On create/update: scan the carer's confirmed shifts overlapping the
 * range and push each affected household's parents with THAT household's
 * count only — never leak cross-family totals or ids. Push failures never
 * fail the write.
 *
 * @module domains/availability/services/timeOffCommandService
 */

import { HOUSEHOLD_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { SHIFT_CHANGE_REQUEST_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ExternalServiceError, ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { HouseholdMemberRepository } from '../../household';
import { notifyHouseholdParents, type PushPayload } from '../../notification';
import { ptoCommandService } from '../../pay/services/ptoCommandService';
import { ShiftChangeRequestRepository } from '../../shift/repositories/shiftChangeRequestRepository';
import { CarerTimeOffRepository } from '../repositories/carerTimeOffRepository';
import {
  type OverlappingBookedShift,
  OverlappingShiftRepository,
} from '../repositories/overlappingShiftRepository';
import { CARER_TIME_OFF_KINDS, CARER_TIME_OFF_STATUSES } from '../schemas';
import type {
  CarerTimeOff,
  CarerTimeOffKind,
  CarerTimeOffMutationResponse,
  CreateCarerTimeOffInput,
  UpdateCarerTimeOffInput,
} from '../types';
import {
  type TimeOffQueryService,
  timeOffQueryService,
} from './timeOffQueryService';

/** Narrow contract for the overlapping-shift lookup (test seam). */
export interface OverlappingShiftLookup {
  listConfirmedForCarerInRange(
    carerId: string,
    from: string,
    to: string
  ): Promise<OverlappingBookedShift[]>;
}

/** Fire-and-forget parent notify — injectable for tests. */
export type NotifyHouseholdParentsFn = (
  householdId: string,
  payload: PushPayload
) => void;

/**
 * Reverse any paid-PTO usage recorded against a cancelled time off —
 * injectable for tests. AWAITED at the call site (F-B9-2): it moves money,
 * so a cancel that returns before it lands is a cancel that lied.
 */
export type ReconcilePtoUsageFn = (timeOffId: string) => Promise<void>;

/**
 * The conflict push copy, branched on `kind` (068).
 *
 * This push is the ONLY signal a family gets that a booked shift is about to
 * go uncovered, so it has to name which thing happened. "Your carer has taken
 * time off" is a planned absence you plan around; "your carer has called in
 * sick" is today, and someone has to cover this morning. Same notification
 * type, same per-household count, different urgency — sending the holiday
 * wording for a sick day buries the emergency inside the routine.
 *
 * The personal-kind strings are byte-identical to the pre-068 ones and are
 * pinned in `timeOffConflictNotify.test.ts` — every existing family is already
 * receiving them.
 *
 * `count` is THIS household's own overlap count and `householdId` its own id:
 * never the cross-household total, never another family's id. `kind` is safe
 * to include here precisely because this push only ever reaches households
 * whose confirmed shifts the absence hits — it is deliberately NOT in the
 * anonymised busy-block view, where a sick day stays plain `time_off`
 * (see 068's privacy note and `AnonymisedBusyBlockSchema`).
 */
function buildConflictPush(
  kind: CarerTimeOffKind,
  householdId: string,
  count: number
): PushPayload {
  const shifts = count === 1 ? '1 booked shift' : `${count} booked shifts`;
  const isSick = kind === CARER_TIME_OFF_KINDS.SICK;

  return {
    title: isSick
      ? 'Carer has called in sick'
      : 'Carer time off overlaps shifts',
    body: isSick
      ? `Your carer has called in sick and will miss ${shifts}.`
      : `Your carer has taken time off that overlaps ${shifts}.`,
    data: {
      type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
      householdId,
      affectedShiftCount: count,
      kind,
    },
  };
}

/**
 * The requested-push copy, branched on `kind`, mirroring `buildConflictPush`
 * above (follow-up to 068). A sick day with no booked shifts still reaches
 * this path — `scanAndNotify` only fires when there IS an overlap — so
 * without a branch here every sick day reads to parents as a holiday
 * request, the same bug the conflict push was fixed for.
 *
 * The personal-kind strings are byte-identical to the pre-fix ones — every
 * existing family is already receiving them — and are pinned in
 * `timeOffRequestedNotify.test.ts`.
 */
function buildRequestedPush(
  kind: CarerTimeOffKind,
  householdId: string
): PushPayload {
  const isSick = kind === CARER_TIME_OFF_KINDS.SICK;

  return {
    title: isSick ? 'Carer is off sick' : 'Time off requested',
    body: isSick
      ? 'Your carer has recorded a sick day — open Time off to see the dates.'
      : 'Your nanny has requested time off — open Time off to review.',
    data: {
      type: PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED,
      householdId,
    },
  };
}

/**
 * N10's copy (matrix §1.3). One push for the whole sick day, naming the count
 * and the earliest affected date — never a bare count, which tells a parent to
 * go hunting, and never one push per shift, which is the A6 violation this row
 * exists to prevent.
 */
export function buildSickShiftsAffectedPush(
  householdId: string,
  shifts: readonly OverlappingBookedShift[]
): PushPayload {
  // Date.parse, never a string compare: starts_at serialisations mix offset
  // and 'Z' forms, which do not string-order by instant (GOLDEN #25).
  const sorted = [...shifts].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)
  );
  const earliest = sorted[0];
  const count = sorted.length;
  const noun = count === 1 ? 'shift' : 'shifts';
  const when = earliest ? formatSickDateLabel(earliest) : '';

  return {
    title: 'Your carer reported sick',
    body: `${count} ${noun}${when ? ` from ${when}` : ''} need your answer.`,
    data: {
      type: PUSH_NOTIFICATION_TYPES.CARER_SICK_SHIFTS_AFFECTED,
      householdId,
      affectedShiftCount: count,
      localDate: earliest?.local_date ?? null,
    },
  };
}

/** "Tue 12 Aug", in the shift's own zone. */
function formatSickDateLabel(shift: OverlappingBookedShift): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: shift.timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(shift.starts_at));
  } catch {
    return shift.local_date;
  }
}

/**
 * Open a cancel request on the carer's behalf — injectable for tests.
 *
 * Goes to the REPOSITORY RPC, not `shiftChangeRequestCommandService.create`,
 * and that is deliberate rather than a shortcut. `assertKindAllowedForRole`
 * lets a nanny open `counter_offer` and nothing else, so routing a sick day
 * through the service would 400 on its own role gate. This is the SYSTEM
 * acting on a fact she reported, not her using a UI she does not have — and
 * the RPC still supersedes any other pending request on the shift, so the
 * one-live-ask-per-shift invariant (migration 030) holds either way.
 *
 * Imported by concrete path, not through the shift barrel: the same
 * cycle-avoidance convention this module already uses for `ptoCommandService`.
 */
export type OpenCancelRequestFn = (
  shiftId: string,
  carerId: string
) => Promise<unknown>;

export class TimeOffCommandService {
  constructor(
    private readonly timeOffRepo: CarerTimeOffRepository = new CarerTimeOffRepository(),
    private readonly queries: TimeOffQueryService = timeOffQueryService,
    private readonly overlapRepo: OverlappingShiftLookup = new OverlappingShiftRepository(),
    private readonly notifyParents: NotifyHouseholdParentsFn = notifyHouseholdParents,
    // Imported by concrete path, not through the pay barrel: the pay domain
    // imports this domain's repositories, so barrel-to-barrel would cycle.
    // Same convention as the timesheet domain's weekEarningsService import.
    private readonly reconcilePtoUsage: ReconcilePtoUsageFn = timeOffId =>
      ptoCommandService.reconcileCancelledTimeOff(timeOffId),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    // D-23. See `OpenCancelRequestFn` for why this is the RPC and not the
    // command service.
    private readonly openCancelRequest: OpenCancelRequestFn = (
      shiftId,
      carerId
    ) =>
      new ShiftChangeRequestRepository().openWithSupersede({
        p_shift_id: shiftId,
        p_requested_by: carerId,
        p_kind: SHIFT_CHANGE_REQUEST_KINDS.CANCEL,
        p_proposed_starts_at: null,
        p_proposed_ends_at: null,
        p_message: 'Reported sick',
      })
  ) {}

  /**
   * Create a time-off row for the caller; scan + notify on overlaps.
   *
   * Gated on the caller STILL actively belonging to a household. There is no
   * household in the URL or the body to check against — `carer_time_off` is
   * person-scoped — so without this a removed nanny got a clean 201. See
   * `TimeOffQueryService.assertActiveMember` for the full reasoning and the
   * limits of a membership-anywhere gate.
   */
  async create(
    userId: string,
    input: CreateCarerTimeOffInput
  ): Promise<CarerTimeOffMutationResponse> {
    await this.queries.assertActiveMember(userId);
    const carer_time_off = await this.timeOffRepo.create({
      ...input,
      // Explicit rather than left to the column default (068): `kind` decides
      // what the affected families are told, and "absent" is not a state this
      // domain has. A client that omits it means a planned personal request.
      kind: input.kind ?? CARER_TIME_OFF_KINDS.PERSONAL,
      user_id: userId,
    });
    // D-23 / S10: a sick day is not a note, it is an absence with consequences
    // for booked shifts. Handled on its own path so the planned-time-off flow
    // below is untouched.
    if (carer_time_off.kind === CARER_TIME_OFF_KINDS.SICK) {
      const affected_shift_count = await this.safeOpenSickCancellations(
        userId,
        carer_time_off.starts_at,
        carer_time_off.ends_at
      );
      if (affected_shift_count === 0) {
        // "if it overlaps none, emit `time_off_requested` as today" (§1.4).
        this.notifyTimeOffRequested(userId, carer_time_off.kind);
      }
      return { carer_time_off, affected_shift_count };
    }

    const affected_shift_count = await this.safeScanAndNotify(
      userId,
      carer_time_off.starts_at,
      carer_time_off.ends_at,
      carer_time_off.kind
    );
    this.notifyTimeOffRequested(userId, carer_time_off.kind);
    return { carer_time_off, affected_shift_count };
  }

  /**
   * D-23 — one action, whole record consistent.
   *
   * Before this, `SickTimeOffButton` wrote a `carer_time_off` row and nothing
   * else: the overlapping shifts stayed `confirmed`, so the schedule still
   * said she was coming, the no-show sweep still expected her, and the family
   * had a push telling them she was sick sitting next to a calendar telling
   * them she was booked. S10's "no path cancels the overlapping shift".
   *
   * What happens now, per overlapping shift: a `cancel` change request is
   * opened on her behalf, exactly as if she had raised it by hand. It is a
   * REQUEST, not a cancellation — cancellation is always two-party (S14),
   * there is no direct cancel endpoint, and a sick day does not get to
   * unilaterally rewrite the parent's schedule. Pay then resolves by the
   * normal three-arm rule when the parent accepts, with no sick-specific
   * branch anywhere: D-23 says "pay by the normal rule", and a special case
   * here would be a second cancellation policy nobody agreed to.
   *
   * PTO IS NOT TOUCHED, deliberately (3-E3 hand-off): the sick label lives on
   * the `carer_time_off` row already, and mark-paid draws the labelled ledger
   * row for free. Stamping anything here would double-count.
   *
   * ONE PUSH, NOT N+1 (A6, matrix row N10). `time_off_requested` plus one
   * `shift_change_requested` per overlapping shift is up to six buzzes for one
   * fact. `carer_sick_shifts_affected` batches them, names the count and the
   * earliest date, and is quiet-hours exempt because a nanny reporting sick at
   * 22:30 for an 07:00 start is precisely the case deferral must not eat.
   *
   * Best-effort per shift: one request failing to open must not abandon the
   * rest, and none of it may fail her sick day. She is ill; the write lands.
   */
  private async safeOpenSickCancellations(
    carerId: string,
    startsAt: string,
    endsAt: string
  ): Promise<number> {
    let shifts: OverlappingBookedShift[];
    try {
      shifts = await this.overlapRepo.listConfirmedForCarerInRange(
        carerId,
        startsAt,
        endsAt
      );
    } catch (error) {
      logger.error('Sick-day overlap scan failed after write', {
        carerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
    if (shifts.length === 0) {
      return 0;
    }

    const opened: OverlappingBookedShift[] = [];
    for (const shift of shifts) {
      try {
        await this.openCancelRequest(shift.id, carerId);
        opened.push(shift);
      } catch (error) {
        logger.error('Failed to open a sick-day cancel request', {
          carerId,
          shiftId: shift.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (opened.length === 0) {
      return 0;
    }

    const byHousehold = new Map<string, OverlappingBookedShift[]>();
    for (const shift of opened) {
      const bucket = byHousehold.get(shift.household_id) ?? [];
      bucket.push(shift);
      byHousehold.set(shift.household_id, bucket);
    }

    for (const [householdId, householdShifts] of byHousehold) {
      try {
        this.notifyParents(
          householdId,
          buildSickShiftsAffectedPush(householdId, householdShifts)
        );
      } catch {
        // Fire-and-forget: a sync throw must never fail the time-off write.
      }
    }

    return opened.length;
  }

  /**
   * Cancel (soft-delete) the caller's OWN time-off row. Verifies ownership
   * first via `queries.getOwned` (throws `TimeOffNotFoundError` for both
   * "missing" and "not yours"), then sets `status = 'cancelled'` — NEVER a
   * hard delete, since the partial index `carer_time_off_user_range_idx
   * ... where status <> 'cancelled'` implies cancelled rows persist.
   *
   * IDEMPOTENT (Phase 3/4 review, BLOCKER 1). `getOwned` checks ownership
   * only, so cancelling an already-cancelled time off used to "succeed" and
   * re-run everything below it. `cancelById` is now conditional on the row
   * not already being cancelled and returns `null` when it changed nothing;
   * the caller still gets a success and the row as it stands — a second
   * DELETE is not an error.
   *
   * THE PTO REVERSAL IS PART OF THE CANCEL, NOT A SIDE EFFECT (F-B9-2). A
   * household may already have marked this time off as paid PTO. Leaving
   * that usage row behind keeps a paid day the carer is no longer taking, so
   * it is reversed with an append-only adjustment (never a delete; the
   * ledger is evidence). That reversal used to be fire-and-forget, on the
   * reasoning that a bookkeeping failure must never leave her unable to
   * cancel — and the consequence was worse than the problem: a failed
   * reversal returned 200, left real money owed on the ledger, and could
   * NEVER be repaired, because the conditional cancel above made a retried
   * DELETE short-circuit before ever reaching it.
   *
   * So it is awaited, its failure is surfaced as a retryable 503, and it
   * runs on EVERY cancel including the ones that transitioned nothing —
   * which is precisely what lets the retry the 503 asks for finish the job.
   * Running it again is free: `reconcileCancelledTimeOff` writes only the
   * difference between what a household has paid and what it has already
   * reversed, so a second run against a reversed ledger writes nothing.
   */
  async cancel(userId: string, timeOffId: string): Promise<CarerTimeOff> {
    // FIRST, ahead of the ownership lookup and well ahead of the reconcile:
    // the PTO reversal below appends adjustment rows to every household that
    // paid for this time off, so a removed member reaching it writes to a past
    // household's money ledger on her way to being refused.
    await this.queries.assertActiveMember(userId);
    const existing = await this.queries.getOwned(userId, timeOffId);
    const cancelled = await this.timeOffRepo.cancelById(timeOffId);

    try {
      await this.reconcilePtoUsage(timeOffId);
    } catch (error) {
      logger.error('Failed to reconcile PTO usage after time-off cancel', {
        timeOffId,
        error: error instanceof Error ? error.message : String(error),
      });
      // The row IS cancelled; only the ledger correction failed. Retrying
      // the DELETE is the repair, and the reconciliation above is idempotent,
      // so the client is told to do exactly that.
      throw new ExternalServiceError(
        'Time off was cancelled but its paid-PTO reversal did not complete — please try again',
        'PTO_RECONCILE_FAILED',
        503,
        { timeOffId }
      );
    }

    return cancelled ?? existing;
  }

  /**
   * Edit dates/message on the caller's OWN active time-off row. Verifies
   * ownership via `queries.getOwned` (throws `TimeOffNotFoundError` for both
   * "missing" and "not yours"), rejects cancelled rows, validates the
   * RESULTING date range, and never accepts `status` — cancel stays on DELETE.
   * Re-scans overlaps on the effective range after the write.
   */
  async update(
    userId: string,
    timeOffId: string,
    input: UpdateCarerTimeOffInput
  ): Promise<CarerTimeOffMutationResponse> {
    // Same gate as create/cancel — PATCH is a write too, and shipping the
    // other two without it would leave the hole open on a sibling route.
    await this.queries.assertActiveMember(userId);
    const row = await this.queries.getOwned(userId, timeOffId);

    if (row.status === CARER_TIME_OFF_STATUSES.CANCELLED) {
      throw new ValidationError(
        'Cannot edit cancelled time off',
        'TIME_OFF_CANCELLED',
        400,
        { timeOffId }
      );
    }

    if (Date.parse(row.ends_at) <= Date.now()) {
      throw new ValidationError(
        'Cannot edit past time off',
        'TIME_OFF_PAST',
        400,
        { timeOffId }
      );
    }

    if (input.status !== undefined) {
      throw new ValidationError(
        'Use DELETE to cancel time off',
        'TIME_OFF_STATUS_NOT_PATCHABLE',
        400,
        { timeOffId }
      );
    }

    const effectiveStarts = input.starts_at ?? row.starts_at;
    const effectiveEnds = input.ends_at ?? row.ends_at;
    if (Date.parse(effectiveEnds) <= Date.parse(effectiveStarts)) {
      throw new ValidationError(
        'ends_at must be after starts_at',
        'INVALID_TIME_OFF_RANGE',
        400,
        { timeOffId, starts_at: effectiveStarts, ends_at: effectiveEnds }
      );
    }

    const carer_time_off = await this.timeOffRepo.update(timeOffId, {
      ...input,
      sequence: row.sequence + 1,
    });
    const affected_shift_count = await this.safeScanAndNotify(
      userId,
      carer_time_off.starts_at,
      carer_time_off.ends_at,
      carer_time_off.kind
    );
    return { carer_time_off, affected_shift_count };
  }

  /**
   * Scan failures must not 500 a successful write — return 0 (best-effort
   * count) and log. Push errors inside the scan are also swallowed.
   */
  private async safeScanAndNotify(
    carerId: string,
    startsAt: string,
    endsAt: string,
    kind: CarerTimeOffKind
  ): Promise<number> {
    try {
      return await this.scanAndNotify(carerId, startsAt, endsAt, kind);
    } catch (error) {
      logger.error('Time-off overlap scan failed after write', {
        carerId,
        startsAt,
        endsAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Group overlapping confirmed shifts by household, push each household
   * only its own count, return the total. Push errors are swallowed.
   */
  private async scanAndNotify(
    carerId: string,
    startsAt: string,
    endsAt: string,
    kind: CarerTimeOffKind
  ): Promise<number> {
    const shifts = await this.overlapRepo.listConfirmedForCarerInRange(
      carerId,
      startsAt,
      endsAt
    );
    if (shifts.length === 0) return 0;

    const counts = new Map<string, number>();
    for (const shift of shifts) {
      counts.set(shift.household_id, (counts.get(shift.household_id) ?? 0) + 1);
    }

    for (const [householdId, count] of counts) {
      const payload = buildConflictPush(kind, householdId, count);
      try {
        this.notifyParents(householdId, payload);
      } catch {
        // Fire-and-forget: a sync throw must never fail the time-off write.
      }
    }

    return shifts.length;
  }

  /**
   * Parents of every household where the carer is an active nanny need to
   * know about a new request — time off is person-scoped, so a multi-family
   * carer fans out one push per household. Complements the conflict push when
   * shifts overlap; both are intentional (request vs overlap detail).
   */
  private notifyTimeOffRequested(
    carerId: string,
    kind: CarerTimeOffKind
  ): void {
    void this.memberRepo
      .listActiveByUser(carerId)
      .then(memberships => {
        const householdIds = new Set(
          memberships
            .filter(m => m.role === HOUSEHOLD_ROLES.NANNY)
            .map(m => m.household_id)
        );
        for (const householdId of householdIds) {
          const payload = buildRequestedPush(kind, householdId);
          try {
            this.notifyParents(householdId, payload);
          } catch {
            // notifyParents is sync fire-and-forget; swallow any unexpected throw
          }
        }
      })
      .catch(error => {
        logger.error('Failed to notify parents of time-off request', {
          carerId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

// Singleton for controllers that don't need DI.
export const timeOffCommandService = new TimeOffCommandService();
