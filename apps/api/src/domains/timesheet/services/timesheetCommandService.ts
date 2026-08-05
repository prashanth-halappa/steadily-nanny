/**
 * Timesheet command service (CQRS-lite: writes). Two distinct role checks
 * live here, copied from the household domain's convention: only the CARER
 * (the `nanny` household role) may clock in/out, and only a PARENT
 * (owner/parent) may approve or query a timesheet — neither may do the
 * other's action.
 *
 * `clockOut` is where "hours only — no payments here" becomes concrete: it
 * freezes `scheduled_minutes` from the linked shift AT THIS INSTANT (so a
 * later shift edit can never rewrite history — see
 * supabase/migrations/017_time_tracking.sql), then rolls the worked minutes
 * into the week's `timesheets` row, creating it on first clock-out of the
 * week. `clockIn`'s pre-check plus `TimeEntryRepository.clockIn`'s 23505
 * translation together guard the DB's
 * `time_entries_one_running_per_carer` partial unique index — the same
 * belt-and-braces pattern as `householdCommandService.redeemInvite`.
 *
 * SECURITY: `clockIn`'s optional `shift_id` is a client-supplied uuid with
 * no FK-level household/carer constraint (`shift_id references shifts(id)`
 * alone — see migration 017). `assertShiftBelongsToCarer` closes that: the
 * DB has no exclusion constraint, so this must be application-enforced. An
 * unvalidated `shift_id` would let a carer attach a clock-in to ANY shift in
 * the system, including a DIFFERENT household's — beyond a bogus
 * `scheduled_minutes`, `scheduleMaterialisationService` treats any shift
 * with a `time_entries` row as permanently immutable, so this could
 * cross-household-pin a stranger's shift shut.
 *
 * @module domains/timesheet/services/timesheetCommandService
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { EARNINGS_RESULT_STATUSES } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import {
  notifyHouseholdParents,
  notifyUser,
} from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
import {
  type WeekEarningsComputer,
  weekEarningsService,
} from '../../pay/services/weekEarningsService';
import {
  SHIFT_STATUSES,
  ShiftNotFoundError,
  ShiftRepository,
} from '../../shift';
import type { ShiftWithChildren } from '../../shift/repositories/shiftRepository';
import { UserService } from '../../user';
import {
  AlreadyClockedInError,
  CancellationPaidAlreadyRecordedError,
  InvalidClockTimesError,
  NotACarerError,
  NotATimesheetParentError,
  TimeEntryNotEditableError,
  TimeEntryNotRunningError,
  TimesheetNotActionableError,
} from '../errors/timesheetErrors';
import { TimeEntryRepository } from '../repositories/timeEntryRepository';
import {
  CLEARED_EARNINGS_SNAPSHOT,
  type TimesheetEarningsSnapshot,
  TimesheetRepository,
} from '../repositories/timesheetRepository';
import type {
  ClockInInput,
  ClockOutInput,
  CreateRetroactiveTimeEntryInput,
  QueryTimesheetInput,
  TimeEntry,
  Timesheet,
  UpdateTimeEntryInput,
} from '../types';
import { toWireTimesheet } from '../utils/toWireTimesheet';
import { weekEndExclusive, weekStartOf } from '../utils/weekStart';
import { computeWorkedMinutes, sumWorkedMinutes } from '../utils/workedMinutes';
import {
  type TimesheetQueryService,
  timesheetQueryService,
} from './timesheetQueryService';

/**
 * Minimal shift shape the cancellation-pay helper needs. Deliberately not the
 * full `ShiftWithChildren` type — the orchestrator (or 1A accept path) can
 * pass the post-accept shift row without dragging the shift domain into this
 * module's public surface.
 */
export interface CancellationPaidShiftInput {
  id: string;
  household_id: string;
  carer_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  cancellation_paid: boolean;
}

/** Injectable push seam — defaults to the fire-and-forget household helpers. */
export interface TimesheetPushNotifier {
  notifyUser: (userId: string, payload: PushPayload) => void;
  notifyHouseholdParents: (householdId: string, payload: PushPayload) => void;
}

/**
 * Auto-match window for an ad-hoc clock-in (no client-supplied `shift_id`):
 * a confirmed shift is only matched if its scheduled span overlaps
 * `[clockInAt - tolerance, clockInAt + tolerance]`. Two hours, deliberately:
 * - Large enough to catch a carer arriving early (traffic, an earlier
 *   school run) or clocking in late (forgot at the start of the shift,
 *   or the shift is genuinely still running) without requiring a
 *   perfectly-timed tap.
 * - Small enough that a carer clocking in at 22:00 can NEVER match
 *   tomorrow's 08:00 shift (10h away) — adjacent-day shifts in this
 *   product are always many hours apart, so 2h leaves a wide, safe gap.
 *
 * Deliberately NOT `household.short_notice_hours`: that field means "how
 * far in advance counts as short notice for cancellation pay" and
 * defaults/ranges up to days — using it here would let a carer clock in
 * many hours before a shift and still match it, which is exactly the
 * false-positive this tolerance exists to prevent. The two concepts are
 * unrelated even though both are "hours of slack" fields.
 */
const CLOCK_IN_MATCH_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * Fallback for `carer_display_name` when the carer's profile has no `name`
 * set (nullable on `user_profiles` — see 002_user_profiles.sql). Matches the
 * backfill in 033_preserve_payroll_on_carer_deletion.sql so an unnamed
 * profile and a since-deleted one read identically.
 */
const UNNAMED_CARER_DISPLAY_NAME = 'Carer';

/**
 * How far ahead of the server's clock a client-supplied `clock_out_at` (or
 * `clock_in_at`) may sit before it is rejected as "in the future".
 *
 * Not zero, deliberately: the client composes these instants from the
 * device's own clock, and a phone that is a few seconds fast would
 * otherwise have a perfectly ordinary clock-out rejected. A minute absorbs
 * real-world drift without letting a genuinely future-dated entry through —
 * nobody can pre-record tomorrow's shift.
 */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

const CARER_ROLES: ReadonlySet<string> = new Set([HOUSEHOLD_ROLES.NANNY]);
const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);
/** A timesheet can only be actioned once there is submitted time on it. */
const ACTIONABLE_STATUSES: ReadonlySet<string> = new Set(['submitted']);
/**
 * Terminal states a parent has already acted on. New hours landing here must
 * re-open the timesheet rather than silently rewrite a total the parent
 * already signed off on — see `rollUpIntoTimesheet`.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['approved', 'queried']);

/**
 * Re-exported, not defined here: both now live in the dependency-free leaf
 * `../utils/workedMinutes` so `domains/pay/services/weekEarningsService` can
 * price a week with the SAME arithmetic the roll-up totals it with, without
 * importing this module and closing an import cycle. Every existing
 * `from '.../timesheetCommandService'` import keeps resolving.
 */
export { computeWorkedMinutes, sumWorkedMinutes };

export class TimesheetCommandService {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly queries: TimesheetQueryService = timesheetQueryService,
    // Only `getProfileById` is needed, so tests can inject a lightweight stub
    // instead of the full static class.
    private readonly userService: Pick<
      typeof UserService,
      'getProfileById'
    > = UserService,
    private readonly push: TimesheetPushNotifier = {
      notifyUser,
      notifyHouseholdParents,
    },
    // The earnings engine's impure wrapper. Only `approve` uses it — this is
    // the single point in the app where a computed figure becomes a stored
    // one (`docs/11-MONEY.md` §3).
    private readonly earnings: WeekEarningsComputer = weekEarningsService
  ) {}

  /**
   * Start a clock-in. Carer (nanny) only. "Starting early? Clock in
   * whenever — we record what happened, not what was planned" — `shift_id`
   * is optional, and no comparison against the shift's own times happens
   * here.
   *
   * When the client supplies NO `shift_id`, this auto-matches a confirmed
   * shift already scoped to this carer/household near the clock-in instant
   * (see `matchConfirmedShift`), so `scheduled_minutes` can be frozen at
   * clock-out without requiring the carer to pick a shift from a list. A
   * client-supplied `shift_id` still goes through the existing
   * `assertShiftBelongsToCarer` ownership check — auto-matching never
   * bypasses it, since `matchConfirmedShift` itself only ever selects from
   * shifts already scoped to this carer and household.
   *
   * `now` is injectable (defaults to the real clock) purely for
   * deterministic tests of the auto-match window — never supplied by
   * production callers.
   */
  async clockIn(
    userId: string,
    input: ClockInInput,
    now: () => Date = () => new Date()
  ): Promise<TimeEntry> {
    const membership = await this.memberRepo.findActiveMembership(
      input.household_id,
      userId
    );
    if (!membership || !CARER_ROLES.has(membership.role)) {
      throw new NotACarerError(input.household_id, membership?.role ?? 'none');
    }

    const existing = await this.timeEntryRepo.findRunningForCarer(userId);
    if (existing) {
      throw new AlreadyClockedInError(userId);
    }

    const clockInAt = now();
    let shiftId: string | null;
    if (input.shift_id) {
      await this.assertShiftBelongsToCarer(
        input.shift_id,
        input.household_id,
        userId
      );
      shiftId = input.shift_id;
    } else {
      shiftId = await this.matchConfirmedShift(
        input.household_id,
        userId,
        clockInAt
      );
    }

    const [household, carerDisplayName] = await Promise.all([
      this.householdRepo.findById(input.household_id),
      this.resolveCarerDisplayName(userId),
    ]);
    return this.timeEntryRepo.clockIn({
      household_id: input.household_id,
      carer_id: userId,
      carer_display_name: carerDisplayName,
      shift_id: shiftId,
      clock_in_at: clockInAt.toISOString(),
      timezone: household?.timezone ?? 'UTC',
      kind: 'worked',
      status: 'running',
    });
  }

  /**
   * Snapshot the carer's display name AT THIS INSTANT onto the new entry —
   * see supabase/migrations/033_preserve_payroll_on_carer_deletion.sql. Must
   * be captured on insert, never derived on read, so the household's payroll
   * record stays legible after the carer's account (and the profile this
   * would otherwise join against) is gone.
   */
  private async resolveCarerDisplayName(carerId: string): Promise<string> {
    const profile = await this.userService.getProfileById(carerId);
    return profile?.name ?? UNNAMED_CARER_DISPLAY_NAME;
  }

  /**
   * End a clock-in. Only the carer it belongs to may clock it out (enforced
   * by `queries.getOwnedTimeEntry`, which throws the SAME not-found error
   * whether the entry is missing or someone else's — see that method).
   *
   * `input.clock_out_at` is the forgotten-clock-out path (Daylight UX #7):
   * a carer who left at the scheduled finish and only remembers to tap
   * "Clock out" the next morning would otherwise have every idle hour in
   * between recorded as worked. When supplied it is bounded by
   * `assertClockOrder` exactly like a correction — the client may move the
   * finish EARLIER (or a minute of drift later), never invent future hours.
   * Omitted, this behaves as it always has: the server's own clock.
   */
  async clockOut(
    userId: string,
    timeEntryId: string,
    input: ClockOutInput
  ): Promise<TimeEntry> {
    const entry = await this.queries.getOwnedTimeEntry(userId, timeEntryId);
    if (entry.status !== 'running') {
      throw new TimeEntryNotRunningError(timeEntryId, entry.status);
    }

    const scheduledMinutes = await this.freezeScheduledMinutes(entry.shift_id);
    const clockOutAt = input.clock_out_at ?? new Date().toISOString();
    this.assertClockOrder(entry.clock_in_at, clockOutAt);

    const patch: Partial<TimeEntry> = {
      clock_out_at: clockOutAt,
      break_minutes: input.break_minutes ?? entry.break_minutes,
      scheduled_minutes: scheduledMinutes,
      status: 'submitted',
    };
    if (input.note !== undefined) {
      patch.note = input.note;
    }

    const updated = await this.timeEntryRepo.update(timeEntryId, patch);
    // `userId` is the authenticated caller `getOwnedTimeEntry` already
    // verified owns this entry — passed through rather than trusting
    // `updated.carer_id`, which is nullable now that a deleted carer's rows
    // survive with carer_id = NULL (see the schema comment on TimeEntry).
    await this.rollUpIntoTimesheet(updated, userId);
    return updated;
  }

  /**
   * Forgotten clock-in recovery: create a finished `worked` entry in one
   * shot. Lands `submitted` immediately (there is no separate submit step —
   * same honesty as clock-out) and rolls into the week total via
   * `rollUpIntoTimesheet`.
   *
   * Constraints mirror the correction path:
   * - `assertClockOrder` (out after in, not in the future)
   * - both ends must fall in the same household-local week (roll-up only
   *   recomputes one week)
   * - blocked once that week is `approved` (same policy as
   *   `recordCancellationPaidEntry` — never silently un-approve via roll-up)
   * - written as `submitted`, never `running`, so it never contends with
   *   `time_entries_one_running_per_carer` even if the carer is currently
   *   clocked in on a different session
   */
  async createRetroactiveEntry(
    userId: string,
    input: CreateRetroactiveTimeEntryInput
  ): Promise<TimeEntry> {
    const membership = await this.memberRepo.findActiveMembership(
      input.household_id,
      userId
    );
    if (!membership || !CARER_ROLES.has(membership.role)) {
      throw new NotACarerError(input.household_id, membership?.role ?? 'none');
    }

    const { clockInAt, clockOutAt } = this.assertClockOrder(
      input.clock_in_at,
      input.clock_out_at
    );

    const household = await this.householdRepo.findById(input.household_id);
    const timeZone = household?.timezone ?? 'UTC';
    const weekStart = weekStartOf(new Date(clockInAt), timeZone);
    if (weekStartOf(new Date(clockOutAt), timeZone) !== weekStart) {
      throw new InvalidClockTimesError('CLOCK_CROSSES_WEEK', {
        weekStart,
        clockInAt,
        clockOutAt,
      });
    }

    const timesheet = await this.timesheetRepo.findByWeek(
      input.household_id,
      userId,
      weekStart
    );
    if (timesheet?.status === 'approved') {
      throw new TimeEntryNotEditableError('new', 'week_approved');
    }

    let shiftId: string | null = null;
    let scheduledMinutes: number | null = null;
    if (input.shift_id) {
      await this.assertShiftBelongsToCarer(
        input.shift_id,
        input.household_id,
        userId
      );
      shiftId = input.shift_id;
      scheduledMinutes = await this.freezeScheduledMinutes(shiftId);
    }

    const carerDisplayName = await this.resolveCarerDisplayName(userId);
    const created = await this.timeEntryRepo.createSubmitted({
      household_id: input.household_id,
      carer_id: userId,
      carer_display_name: carerDisplayName,
      shift_id: shiftId,
      clock_in_at: clockInAt,
      clock_out_at: clockOutAt,
      break_minutes: input.break_minutes ?? 0,
      scheduled_minutes: scheduledMinutes,
      timezone: timeZone,
      kind: 'worked',
      status: 'submitted',
      note: input.note ?? null,
    });
    await this.rollUpIntoTimesheet(created, userId);
    return created;
  }

  /**
   * Record hours owed under a short-notice cancellation. Idempotent on
   * `shift_id`: a second call for the same paid cancellation returns the
   * existing `cancellation_paid` entry without inserting another.
   *
   * Find-first is an optimisation; the partial unique index
   * `time_entries_one_cancellation_paid_per_shift` (039) is the source of
   * truth under concurrent accepts — a 23505 loses the race, re-fetches,
   * and returns the winner.
   *
   * Span validation is `ends_at > starts_at` ONLY. Do NOT route through
   * `assertClockOrder`: paid-cancel accepts happen before the shift starts,
   * so `ends_at` is intentionally in the future — the future-bound that
   * protects real clock-outs would throw `CLOCK_OUT_IN_FUTURE` and (via the
   * shift accept path swallowing the error) leave the carer owed money with
   * no entry.
   *
   * Approved-week policy matches `createRetroactiveEntry`: block the write
   * with `TimeEntryNotEditableError` rather than inserting and letting
   * `rollUpIntoTimesheet` silently un-approve the week.
   *
   * Exported at module scope as `recordCancellationPaidEntry` for the
   * orchestrator to wire into shift paid-cancel accept — do not duplicate
   * this write in the shift domain.
   */
  async recordCancellationPaidEntry(
    shift: CancellationPaidShiftInput
  ): Promise<TimeEntry | null> {
    if (!shift.cancellation_paid || !shift.carer_id) {
      return null;
    }

    const existing = await this.timeEntryRepo.findCancellationPaidForShift(
      shift.id
    );
    if (existing) {
      return existing;
    }

    this.assertCancellationPaidSpan(shift.starts_at, shift.ends_at);

    // Approved-week boundary is household-local Monday — same as roll-ups /
    // createRetroactiveEntry. `shift.timezone` can disagree and mis-file the
    // guard into the wrong week (money path).
    const household = await this.householdRepo.findById(shift.household_id);
    const weekStart = weekStartOf(
      new Date(shift.starts_at),
      household?.timezone ?? 'UTC'
    );
    const timesheet = await this.timesheetRepo.findByWeek(
      shift.household_id,
      shift.carer_id,
      weekStart
    );
    if (timesheet?.status === 'approved') {
      throw new TimeEntryNotEditableError('new', 'week_approved');
    }

    const scheduledMinutes = Math.round(
      (new Date(shift.ends_at).getTime() -
        new Date(shift.starts_at).getTime()) /
        60_000
    );
    const carerDisplayName = await this.resolveCarerDisplayName(shift.carer_id);

    let created: TimeEntry;
    try {
      created = await this.timeEntryRepo.createSubmitted({
        household_id: shift.household_id,
        carer_id: shift.carer_id,
        carer_display_name: carerDisplayName,
        shift_id: shift.id,
        clock_in_at: shift.starts_at,
        clock_out_at: shift.ends_at,
        break_minutes: 0,
        scheduled_minutes: scheduledMinutes,
        timezone: shift.timezone,
        kind: 'cancellation_paid',
        status: 'submitted',
        note: null,
      });
    } catch (err) {
      if (err instanceof CancellationPaidAlreadyRecordedError) {
        const raced = await this.timeEntryRepo.findCancellationPaidForShift(
          shift.id
        );
        if (raced) {
          return raced;
        }
      }
      throw err;
    }

    await this.rollUpIntoTimesheet(created, shift.carer_id);
    return created;
  }

  /**
   * Correct an already-clocked-out entry — the carer's own fix for a wrong
   * time, a missed break, or a forgotten clock-out she only noticed later
   * (Daylight UX P0-2). Carer-only, via the same `getOwnedTimeEntry` gate as
   * `clockOut`.
   *
   * Two things make this cheap rather than a second write path:
   * `rollUpIntoTimesheet` already DERIVES the week total from the week's
   * entries instead of incrementing one, so a corrected entry self-heals the
   * total; and its terminal-status branch already re-opens a timesheet the
   * parent has acted on. Neither needed changing.
   *
   * Editable only while the week is unapproved. Once a parent has approved,
   * the week is a signed agreement — the way back in is the parent's own
   * query flow, not a silent edit that would revoke an approval they gave.
   * A `running` entry isn't editable either: clocking out IS its edit, and
   * that path can already set its own finish time.
   */
  async updateEntry(
    userId: string,
    timeEntryId: string,
    input: UpdateTimeEntryInput
  ): Promise<TimeEntry> {
    const entry = await this.queries.getOwnedTimeEntry(userId, timeEntryId);
    if (entry.status !== 'submitted') {
      throw new TimeEntryNotEditableError(timeEntryId, entry.status);
    }

    const originalClockInAt = entry.clock_in_at;
    if (!originalClockInAt) {
      throw new InvalidClockTimesError('MISSING_CLOCK_TIME', { timeEntryId });
    }
    const { clockInAt } = this.assertClockOrder(
      input.clock_in_at ?? originalClockInAt,
      input.clock_out_at ?? entry.clock_out_at
    );

    const household = await this.householdRepo.findById(entry.household_id);
    const timeZone = household?.timezone ?? 'UTC';
    const weekStart = weekStartOf(new Date(originalClockInAt), timeZone);

    // ponytail: a clock-in edit that crosses a week boundary is rejected
    // rather than handled — `rollUpIntoTimesheet` recomputes ONE week, so
    // moving an entry out of this one would leave the week it left behind
    // overstated. Teach the roll-up to take both weeks if overnight
    // corrections across a Monday ever turn out to matter.
    if (weekStartOf(new Date(clockInAt), timeZone) !== weekStart) {
      throw new InvalidClockTimesError('CLOCK_IN_CHANGES_WEEK', {
        timeEntryId,
        weekStart,
      });
    }

    const timesheet = await this.timesheetRepo.findByWeek(
      entry.household_id,
      userId,
      weekStart
    );
    if (timesheet?.status === 'approved') {
      throw new TimeEntryNotEditableError(timeEntryId, 'week_approved');
    }

    const patch: Partial<TimeEntry> = {};
    if (input.clock_in_at !== undefined) patch.clock_in_at = input.clock_in_at;
    if (input.clock_out_at !== undefined)
      patch.clock_out_at = input.clock_out_at;
    if (input.break_minutes !== undefined)
      patch.break_minutes = input.break_minutes;
    if (input.note !== undefined) patch.note = input.note;

    const updated = await this.timeEntryRepo.update(timeEntryId, patch);
    await this.rollUpIntoTimesheet(updated, userId);
    return updated;
  }

  /**
   * Reject clock times that can't describe a real session. Mirrors the DB's
   * `time_entries_clock_order` check (017_time_tracking.sql) so a bad edit
   * comes back as a 400 the client can render, instead of a constraint
   * violation surfacing as a 500 — and adds the bound the DB cannot know
   * about: a finish may not be in the future. Both `clockOut` and
   * `updateEntry` route through here, so neither can drift from the other.
   *
   * Returns the pair it validated so callers get the non-null narrowing for
   * free rather than re-asserting it.
   *
   * Not for `recordCancellationPaidEntry` — paid-cancel spans are often
   * still in the future; use `assertCancellationPaidSpan` instead.
   */
  private assertClockOrder(
    clockInAt: string | null,
    clockOutAt: string | null
  ): { clockInAt: string; clockOutAt: string } {
    if (!clockInAt || !clockOutAt) {
      throw new InvalidClockTimesError('MISSING_CLOCK_TIME');
    }
    const inMs = new Date(clockInAt).getTime();
    const outMs = new Date(clockOutAt).getTime();
    if (outMs <= inMs) {
      throw new InvalidClockTimesError('CLOCK_OUT_BEFORE_CLOCK_IN', {
        clockInAt,
        clockOutAt,
      });
    }
    if (outMs > Date.now() + CLOCK_SKEW_TOLERANCE_MS) {
      throw new InvalidClockTimesError('CLOCK_OUT_IN_FUTURE', { clockOutAt });
    }
    return { clockInAt, clockOutAt };
  }

  /**
   * Paid-cancel span check: `ends_at` must be after `starts_at`, matching
   * the DB's `time_entries_clock_order`. Deliberately omits the
   * "not in the future" bound — see `recordCancellationPaidEntry`.
   */
  private assertCancellationPaidSpan(startsAt: string, endsAt: string): void {
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    if (!(endMs > startMs)) {
      throw new InvalidClockTimesError('CLOCK_OUT_BEFORE_CLOCK_IN', {
        clockInAt: startsAt,
        clockOutAt: endsAt,
      });
    }
  }

  /**
   * Owner/parent only. Requires submitted hours to act on.
   *
   * THE MOMENT MONEY STOPS BEING DERIVED. Three steps, and the ordering of
   * the last two is the whole design (TIER0-PLAN.md Phase 2, review finding
   * 13, Phase 2 review finding 1, `docs/11-MONEY.md` §3):
   *
   * 1. Gate on role and status, as this method always has — and remember the
   *    VERSION of the row that gating was done against (`updated_at`).
   * 2. Compute the week's earnings from the entries as they stand right now.
   * 3. Write the snapshot AND the status flip in ONE conditional update
   *    (`... where status = 'submitted' and updated_at = <that version>`).
   *
   * Between 1 and 3 a concurrent clock-out can roll new hours into this week
   * — that is D1's exact surface, and here it would freeze a gross figure
   * that no longer describes the hours on the row.
   *
   * The status half of the predicate catches the roll-up that RE-OPENS an
   * approved or queried week. It does not catch the far more ordinary one:
   * `rollUpIntoTimesheet` writing new `total_minutes` onto a week that was
   * already `submitted` leaves the status untouched, so a status-only
   * predicate would still match and would stamp `approved` — with the OLD
   * gross — over the new hours. The version half closes that: `updated_at` is
   * bumped by the `set_timesheets_updated_at` trigger on every write to the
   * row, so any roll-up at all invalidates this approve.
   *
   * The version is read BEFORE the compute rather than after, deliberately.
   * The engine's own reads happen inside step 2, so a roll-up landing
   * mid-compute must also invalidate the result; anchoring on the earlier
   * value is the conservative choice, and its only cost is an occasional
   * spurious retry.
   *
   * Either way there is no interleaving that produces a snapshot without an
   * approval, an approval without its snapshot, or an approval covering hours
   * nobody looked at.
   *
   * The lost-race failure is `TimesheetNotActionableError` — the same error
   * `assertActionable` raises for a stale status, because it is the same
   * situation, just noticed a few milliseconds later. Both raises live in
   * this method's flow so they cannot drift apart. The parent simply approves
   * again, this time against the hours that are actually there.
   */
  async approve(userId: string, timesheetId: string): Promise<Timesheet> {
    const timesheet = await this.queries.getOwnedTimesheet(userId, timesheetId);
    await this.assertWriteMember(userId, timesheet.household_id);
    this.assertActionable(timesheet);

    // One instant for the approval and the snapshot: they describe the same
    // event, and two `new Date()` calls would let them disagree.
    const at = new Date().toISOString();
    const snapshot = await this.computeSnapshot(timesheet, at);

    const approved = await this.timesheetRepo.approveSubmittedWithEarnings(
      timesheetId,
      { approved_by: userId, approved_at: at, ...snapshot },
      timesheet.updated_at
    );
    if (!approved) {
      throw new TimesheetNotActionableError(timesheetId, 'changed_since_read');
    }
    return toWireTimesheet(approved);
  }

  /**
   * The four snapshot columns for a week about to be approved.
   *
   * A carer-less week (`carer_id` NULL after account deletion — 033) gets an
   * EMPTY snapshot rather than a computed one: there is nobody to resolve an
   * arrangement against, and the read path renders it hours-only anyway. The
   * approval of the HOURS still stands; only the money is absent.
   *
   * A non-`ok` engine arm (`no_arrangement`, `currency_change`) freezes its
   * jsonb but leaves `gross_minor`/`currency` NULL. Migration 042's header
   * describes the four columns as populated "together"; that prose assumes a
   * priceable week. Writing `0` here to satisfy it would be exactly the
   * silently-wrong zero `docs/11-MONEY.md` §4 forbids, so the jsonb carries
   * the honest reason and the amount columns stay empty.
   */
  private async computeSnapshot(
    timesheet: Timesheet,
    computedAt: string
  ): Promise<TimesheetEarningsSnapshot> {
    if (!timesheet.carer_id) {
      return CLEARED_EARNINGS_SNAPSHOT;
    }
    const earnings: WeekEarnings = await this.earnings.computeForWeek(
      timesheet.household_id,
      timesheet.carer_id,
      timesheet.week_start
    );
    if (earnings.status !== EARNINGS_RESULT_STATUSES.OK) {
      return {
        gross_minor: null,
        currency: null,
        earnings,
        earnings_computed_at: computedAt,
      };
    }
    return {
      gross_minor: earnings.gross_minor,
      currency: earnings.currency,
      earnings,
      earnings_computed_at: computedAt,
    };
  }

  /** Owner/parent only. "Query Thursday" — names the disagreement rather than silently withholding payment. */
  async query(
    userId: string,
    timesheetId: string,
    input: QueryTimesheetInput
  ): Promise<Timesheet> {
    const timesheet = await this.queries.getOwnedTimesheet(userId, timesheetId);
    await this.assertWriteMember(userId, timesheet.household_id);
    this.assertActionable(timesheet);

    const updated = await this.timesheetRepo.update(timesheetId, {
      status: 'queried',
      query_note: input.note,
    });

    // Carer currently only learns of a queried week by opening Hours — push
    // her so she can respond. Fire-and-forget: a push failure must never
    // fail the query write the parent already completed.
    if (updated.carer_id) {
      try {
        this.push.notifyUser(updated.carer_id, {
          title: 'Hours queried',
          body: 'A parent has a question about your hours this week.',
          data: {
            type: PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERIED,
            timesheetId: updated.id,
            householdId: updated.household_id,
            weekStart: updated.week_start,
          },
        });
      } catch {
        // notifyUser is sync fire-and-forget; swallow any unexpected throw
      }
    }

    return toWireTimesheet(updated);
  }

  /**
   * Verify a client-supplied `shift_id` is actually THIS carer's shift in
   * THIS household before letting a clock-in reference it — see the module
   * doc's SECURITY note. Throws the shift domain's own `ShiftNotFoundError`
   * (reused cross-domain, same convention as the schedule domain reusing
   * the household domain's `NotAHouseholdParentError`) for "doesn't exist",
   * "belongs to a different household", and "assigned to a different
   * carer" alike — the caller learns nothing about shifts that aren't
   * theirs to clock into.
   */
  private async assertShiftBelongsToCarer(
    shiftId: string,
    householdId: string,
    carerId: string
  ): Promise<void> {
    const shift = await this.shiftRepo.findById(shiftId);
    if (
      !shift ||
      shift.household_id !== householdId ||
      shift.carer_id !== carerId
    ) {
      throw new ShiftNotFoundError(shiftId);
    }
  }

  /**
   * Auto-match an ad-hoc clock-in (no client-supplied `shift_id`) to a
   * confirmed shift, or return null for a genuinely unscheduled clock-in.
   *
   * SECURITY: reuses `shiftRepo.findByHouseholdAndRange`, which is already
   * scoped to `householdId`, then filters to THIS carer and `confirmed`
   * status in-process — never widens beyond what `assertShiftBelongsToCarer`
   * would itself accept, so auto-matching cannot become a way to attach a
   * clock-in to another carer's or another household's shift.
   *
   * Candidates are any confirmed shift whose scheduled span overlaps
   * `[clockInAt - tolerance, clockInAt + tolerance]` (see
   * `CLOCK_IN_MATCH_TOLERANCE_MS` for why 2h). The `[from, to)` args passed
   * to the repo are a coarse pre-filter for efficiency; the exact tolerance
   * check is re-applied in-process below so this method's behaviour never
   * depends on the repo's own overlap semantics staying in lockstep with
   * this method's. Ties (more than one shift in range — e.g. back-to-back
   * shifts) resolve deterministically: closest `starts_at` to the clock-in
   * instant wins; a further tie (identical `starts_at`, which the app
   * doesn't otherwise create) falls back to the lower `id` so the result
   * never depends on array order.
   */
  private async matchConfirmedShift(
    householdId: string,
    carerId: string,
    clockInAt: Date
  ): Promise<string | null> {
    const instantMs = clockInAt.getTime();
    const from = new Date(
      instantMs - CLOCK_IN_MATCH_TOLERANCE_MS
    ).toISOString();
    const to = new Date(instantMs + CLOCK_IN_MATCH_TOLERANCE_MS).toISOString();

    const inRange = await this.shiftRepo.findByHouseholdAndRange(
      householdId,
      from,
      to
    );
    const candidates = inRange.filter(
      shift =>
        shift.carer_id === carerId &&
        shift.status === SHIFT_STATUSES.CONFIRMED &&
        this.isWithinClockInTolerance(shift, instantMs)
    );
    if (candidates.length === 0) {
      return null;
    }

    const nearest = candidates.reduce((best, candidate) =>
      this.isCloserMatch(candidate, best, instantMs) ? candidate : best
    );
    return nearest.id;
  }

  /** Exact tolerance check: does `instantMs` fall within `[shift.starts_at - tolerance, shift.ends_at + tolerance]`? */
  private isWithinClockInTolerance(
    shift: ShiftWithChildren,
    instantMs: number
  ): boolean {
    const startsMs = new Date(shift.starts_at).getTime();
    const endsMs = new Date(shift.ends_at).getTime();
    return (
      instantMs >= startsMs - CLOCK_IN_MATCH_TOLERANCE_MS &&
      instantMs <= endsMs + CLOCK_IN_MATCH_TOLERANCE_MS
    );
  }

  /** Deterministic "is `candidate` a better match than `best`?" — see `matchConfirmedShift`. */
  private isCloserMatch(
    candidate: ShiftWithChildren,
    best: ShiftWithChildren,
    instantMs: number
  ): boolean {
    const candidateDiff = Math.abs(
      new Date(candidate.starts_at).getTime() - instantMs
    );
    const bestDiff = Math.abs(new Date(best.starts_at).getTime() - instantMs);
    if (candidateDiff !== bestDiff) {
      return candidateDiff < bestDiff;
    }
    if (candidate.starts_at !== best.starts_at) {
      return candidate.starts_at < best.starts_at;
    }
    return candidate.id < best.id;
  }

  /**
   * The shift's scheduled span AT THIS INSTANT, or null for an unscheduled
   * clock-in. Frozen onto the time entry so a later shift edit can never
   * rewrite recorded history (see module doc).
   */
  private async freezeScheduledMinutes(
    shiftId: string | null
  ): Promise<number | null> {
    if (!shiftId) {
      return null;
    }
    const shift = await this.shiftRepo.findById(shiftId);
    if (!shift) {
      return null;
    }
    return Math.round(
      (new Date(shift.ends_at).getTime() -
        new Date(shift.starts_at).getTime()) /
        60_000
    );
  }

  /**
   * Find-or-create the week's timesheet and set its total to the FULL
   * recomputed sum of the week's entries — never an increment. Blind
   * addition (`existing.total_minutes + workedMinutes`) double-counts a
   * retried, duplicated, or replayed clock-out; re-deriving the total from
   * `listForCarerWeek` on every call is idempotent by construction (calling
   * this twice for the same underlying entries is a no-op the second time)
   * and self-heals if an entry is later corrected or deleted.
   */
  private async rollUpIntoTimesheet(
    entry: TimeEntry,
    carerId: string
  ): Promise<void> {
    if (!entry.clock_in_at || !entry.clock_out_at) {
      return; // defensive — clockOut always sets both before calling this
    }

    const household = await this.householdRepo.findById(entry.household_id);
    const weekStart = weekStartOf(
      new Date(entry.clock_in_at),
      household?.timezone ?? 'UTC'
    );

    const weekEntries = await this.timeEntryRepo.listForCarerWeek(
      entry.household_id,
      carerId,
      weekStart,
      weekEndExclusive(weekStart)
    );
    const totalMinutes = sumWorkedMinutes(weekEntries);

    const existing = await this.timesheetRepo.findByWeek(
      entry.household_id,
      carerId,
      weekStart
    );
    if (!existing) {
      await this.timesheetRepo.create({
        household_id: entry.household_id,
        carer_id: carerId,
        // Snapshotted from the entry that triggered this roll-up, not
        // re-resolved — the entry's own snapshot is already frozen at
        // clock-in, so reusing it keeps entry and timesheet in agreement.
        carer_display_name: entry.carer_display_name,
        week_start: weekStart,
        total_minutes: totalMinutes,
        status: 'submitted',
      });
      this.push.notifyHouseholdParents(entry.household_id, {
        title: 'Hours submitted',
        body: `${entry.carer_display_name ?? 'Your carer'} logged hours for this week.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED,
          householdId: entry.household_id,
          weekStart,
        },
      });
      return;
    }

    // A fresh 'open' timesheet becomes 'submitted' on its first hours and
    // stays 'submitted' as more entries roll in. A timesheet a parent has
    // already acted on ('approved' or 'queried') is a terminal state: it
    // must never absorb new minutes silently. Re-open it to 'submitted' —
    // clearing the approval — so the parent is forced to look again rather
    // than being recorded as having approved hours they never saw.
    //
    // The earnings snapshot goes with it, in the SAME update. A frozen gross
    // figure that outlived the hours it was computed from is the identical
    // class of bug D1 fixed for `approved_by`/`approved_at`, and strictly
    // worse: it is a number someone gets paid against
    // (`docs/11-MONEY.md` §3, migration 042's header). One update, so there
    // is no window in which the row claims a settled amount for hours that
    // have already changed.
    //
    // THE CLEAR IS UNCONDITIONAL, not gated on "was it terminal?" (Phase 2
    // review, finding 1). `existing.status` is a PRE-READ, and an approve
    // landing between that read and this write would make it lie: the flag
    // would say `submitted` → nothing to clear, while the row the write
    // actually lands on is `approved` with a frozen gross and an approver on
    // it. The result is a `submitted` row wearing a settled amount — exactly
    // the invariant 042's header says these columns keep, broken by a race.
    //
    // Stating it unconditionally is not a wider write, it is the invariant
    // itself: EVERY write here sets `status = 'submitted'`, and a submitted
    // week has no snapshot and no approver, full stop. Writing nulls over
    // nulls is idempotent and depends on nothing that was read earlier, so
    // there is no window left to race. The alternatives both only narrow the
    // window rather than closing it — a re-read is still a separate statement
    // from the write (the same TOCTOU one level down), and CASing this write
    // would turn a clock-out into something that can FAIL because a parent
    // tapped Approve, which it must never be: the hours happened and have to
    // be recorded.
    //
    // `query_note` is still preserved (D1): it records what was disputed,
    // which is not a stale approval claim.
    //
    // `reopening`/`newlySubmitted` survive only to decide whether to push.
    // A best-effort notification may be judged on a pre-read; a money column
    // may not.
    const reopening = TERMINAL_STATUSES.has(existing.status);
    const newlySubmitted = existing.status !== 'submitted';
    await this.timesheetRepo.update(existing.id, {
      total_minutes: totalMinutes,
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      ...CLEARED_EARNINGS_SNAPSHOT,
    });
    if (newlySubmitted || reopening) {
      this.push.notifyHouseholdParents(entry.household_id, {
        title: 'Hours submitted',
        body: `${entry.carer_display_name ?? 'Your carer'} logged hours for this week.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED,
          householdId: entry.household_id,
          weekStart,
          timesheetId: existing.id,
        },
      });
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
    if (!membership || !WRITE_ROLES.has(membership.role)) {
      throw new NotATimesheetParentError(
        householdId,
        membership?.role ?? 'none'
      );
    }
  }

  private assertActionable(timesheet: Timesheet): void {
    if (!ACTIONABLE_STATUSES.has(timesheet.status)) {
      throw new TimesheetNotActionableError(timesheet.id, timesheet.status);
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const timesheetCommandService = new TimesheetCommandService();

/**
 * Orchestrator seam: wire into shift paid-cancel accept. Idempotent — safe
 * to call from a retried accept path. Returns null when the shift is not
 * cancellation-paid (or has no carer).
 */
export function recordCancellationPaidEntry(
  shift: CancellationPaidShiftInput
): Promise<TimeEntry | null> {
  return timesheetCommandService.recordCancellationPaidEntry(shift);
}
