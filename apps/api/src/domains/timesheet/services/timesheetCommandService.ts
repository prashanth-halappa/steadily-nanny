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
import { MAX_MONEY_MINOR } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { EARNINGS_RESULT_STATUSES } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { logger } from '../../../middlewares/logger';
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
import { allocateMinutes } from '../../pay/utils/allocateMinutes';
import {
  SHIFT_STATUSES,
  ShiftNotFoundError,
  ShiftRepository,
} from '../../shift';
import {
  type NewShiftEventInput,
  ShiftEventRepository,
} from '../../shift/repositories/shiftEventRepository';
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
  TimeEntryOverlapError,
  TimesheetGrossTooLargeError,
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
  ReopenTimesheetInput,
  TimeEntry,
  Timesheet,
  UpdateTimeEntryInput,
} from '../types';
import { mondayMidnightInstant } from '../utils/mondayMidnight';
import { toWireTimesheet } from '../utils/toWireTimesheet';
import {
  weekEndExclusive,
  weekStartOf,
  weekStartOfLocalDate,
} from '../utils/weekStart';
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

/**
 * Hard ceiling on a single worked session span (`clock_out - clock_in`).
 *
 * Soft counterpart on mobile: `MAX_UNSCHEDULED_SHIFT_MS` in
 * `apps/mobile/src/domains/today/utils/clockOutReminder.ts` (10h reminder).
 * This hard reject must stay ABOVE that reminder so the client warns before
 * the server refuses — same concept, two thresholds.
 *
 * Service-layer, not a DB constraint: a live-in or split arrangement may
 * legitimately need a higher bound later without a migration.
 *
 * ponytail: calibration knob, not a law of physics — raise if a real
 * household's longest legitimate session sits above 16h. Raising it past 24h
 * needs `clockOutAcrossWeeks` to loop: it splits at ONE week boundary because
 * no session shorter than a day can cross two.
 */
const MAX_SESSION_SPAN_MS = 16 * 60 * 60 * 1000;

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

/**
 * Do two clock spans collide? A null end means "no finish yet" — a running
 * entry, or a clock-in being started right now.
 *
 * Both finished: the ordinary half-open intersection, `[a,b)` overlaps
 * `[c,d)` iff `a < d && c < b`. Touching end-to-start is allowed —
 * back-to-back sessions are ordinary, and a carer clocking in the moment a
 * paid-cancellation span ends is exactly that.
 *
 * One unfinished: it is OPEN-ENDED, `[in, ∞)` — not an instant. A session
 * with no finish will still be running at every later moment, so anything
 * ending after it started collides with it. The single exception is a span
 * that FINISHED at or before it began, which is the ordinary
 * forgotten-clock-in recovery for earlier work and must stay legal.
 *
 * Treating an open end as a zero-length instant instead (`in <= other.in`)
 * admits every span that starts after the clock-in — e.g. she clocks in at
 * 09:00, forgets, then files 14:00–17:00. That write lands, and afterwards
 * EVERY clock-out of the 09:00 row throws, stranding it. Since
 * `time_entries_one_running_per_carer` is keyed on `carer_id` with no
 * household predicate, one stranded row locks her out of clocking in for
 * every household she works for, and neither `updateEntry` (submitted-only)
 * nor any route can clear it. Refusing the write is the only state that
 * stays recoverable.
 *
 * Both unfinished is unreachable for one carer — that index admits a single
 * runner — and is not an overlap either way.
 */
function spansOverlap(
  aIn: number,
  aOut: number | null,
  bIn: number,
  bOut: number | null
): boolean {
  if (aOut !== null && bOut !== null) return aIn < bOut && bIn < aOut;
  if (aOut !== null) return aOut > bIn;
  if (bOut !== null) return bOut > aIn;
  return false;
}

/**
 * `[startMs, endMs)` minus every span the carer already has — the parts of a
 * cancelled window that nobody was actually working.
 *
 * Cancellation pay means she is paid for the time that WAS cancelled, so a
 * shift she had already partly worked owes her the remainder, not nothing
 * (which silently underpaid her) and not the whole window (which banked the
 * same minutes twice — `sumWorkedMinutes` and the earnings engine both add
 * `worked` and `cancellation_paid` kinds).
 *
 * A RUNNING entry consumes `[in, ∞)`, the same open-ended reading
 * `spansOverlap` uses: her finish is unknown, and ending the remainder where
 * she clocked in is the only choice that stays correct for every clock-out
 * she might eventually make.
 *
 * Returns the gaps in order. Empty means she worked the whole window; more
 * than one means the worked time sits in the MIDDLE, and since 053 every
 * fragment is paid rather than the shape being refused.
 *
 * ASSUMES `endMs > startMs`. A backwards window would return OVERLAPPING
 * gaps and overpay the inverted stretch rather than crash. Unreachable
 * today — `017_time_tracking.sql` has `check (clock_out_at > clock_in_at)`
 * and `assertCancellationPaidSpan` rejects it before this is called — but
 * the safety lives in those two places, not in here.
 */
function remainingSpans(
  startMs: number,
  endMs: number,
  existing: TimeEntry[]
): { from: number; to: number }[] {
  const busy: { from: number; to: number }[] = [];
  for (const entry of existing) {
    if (!entry.clock_in_at) continue;
    const from = new Date(entry.clock_in_at).getTime();
    const to = entry.clock_out_at
      ? new Date(entry.clock_out_at).getTime()
      : Number.POSITIVE_INFINITY;
    // Drop anything outside the window — an entry starting after it ends
    // would otherwise open a gap running past `endMs`.
    if (to > startMs && from < endMs) busy.push({ from, to });
  }
  busy.sort((a, b) => a.from - b.from);

  const gaps: { from: number; to: number }[] = [];
  let cursor = startMs;
  for (const { from, to } of busy) {
    if (from > cursor) gaps.push({ from: cursor, to: from });
    cursor = Math.max(cursor, to);
  }
  if (cursor < endMs) gaps.push({ from: cursor, to: endMs });
  return gaps;
}

/**
 * How many of a cancelled window's minutes one row was PRESENT for — the
 * term `recordCancellationPaidEntry` subtracts from the booked total before
 * handing the rest to the fragments (C7).
 *
 * Presence is the clipped SPAN, never span-minus-break. She was in the house
 * for her break; the window was not cancelled around it. Subtracting the
 * break here would hand the difference to a cancellation fragment and pay her
 * for a break nobody agreed to pay for.
 *
 * A row hanging outside the window is clipped to it, and a running row is
 * open-ended and so occupies the rest of it — the same reading
 * `remainingSpans` and `spansOverlap` use.
 */
function presenceMinutesOf(
  entry: TimeEntry,
  startMs: number,
  endMs: number
): number {
  if (!entry.clock_in_at) return 0;
  const inMs = new Date(entry.clock_in_at).getTime();
  const outMs = entry.clock_out_at
    ? new Date(entry.clock_out_at).getTime()
    : Number.POSITIVE_INFINITY;
  const from = Math.max(inMs, startMs);
  const to = Math.min(outMs, endMs);
  return Math.max(0, Math.round((to - from) / 60_000));
}

/**
 * Cut every span at each household-local Monday it crosses, so no fragment
 * ever straddles a week.
 *
 * `local_date` is trigger-derived from `clock_in_at`, and both
 * `rollUpIntoTimesheet` and the approved-week guard bucket by week — so a
 * fragment spanning a Monday prices ALL of its minutes into the week it
 * started in. For a cancelled window that is the whole payout, at the wrong
 * week's rate and against the wrong week's overtime threshold.
 *
 * A loop, unlike `clockOutAcrossWeeks`: a worked session is bounded by
 * `MAX_SESSION_SPAN_MS`, but a cancelled window is bounded only by the shift
 * it came from and can legitimately cover several weeks.
 */
function splitAtWeekBoundaries(
  spans: readonly { from: number; to: number }[],
  timeZone: string
): { from: number; to: number }[] {
  const pieces: { from: number; to: number }[] = [];
  for (const span of spans) {
    let from = span.from;
    while (from < span.to) {
      const boundary = mondayMidnightInstant(
        new Date(from),
        timeZone
      ).getTime();
      // Always strictly after `from` (it is the END of `from`'s own week), so
      // this terminates.
      const to = Math.min(boundary, span.to);
      pieces.push({ from, to });
      from = to;
    }
  }
  return pieces;
}

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
    private readonly earnings: WeekEarningsComputer = weekEarningsService,
    // Day-thread append for money-visible reopen audits. Default instance
    // keeps existing callers/tests on the nine-arg constructor working.
    private readonly eventRepo: Pick<
      ShiftEventRepository,
      'insertMany'
    > = new ShiftEventRepository()
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
    // A clock-in landing INSIDE an existing completed entry — most often a
    // paid-cancellation span, which covers the whole shift — can never be
    // clocked out: every clock-out fails the overlap check, and the stranded
    // `running` row then blocks every future clock-in via
    // `time_entries_one_running_per_carer`. Refuse the start instead of
    // creating a row with no way out (F-B2-4).
    await this.assertNoOverlap(
      input.household_id,
      userId,
      clockInAt.toISOString(),
      null
    );

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
    const { clockInAt } = this.assertClockOrder(entry.clock_in_at, clockOutAt);

    // Overlap guard on the RESOLVED finish — never `input.clock_out_at`,
    // which is omitted on the ordinary "tap Clock out" path that uses the
    // server clock. `excludeEntryId` is the running row itself (already in
    // the table); without it the span would overlap its own clock_in.
    // The guard is span-based, so a finish that lands in the following week
    // is checked against the entries that are actually there rather than
    // against one week's worth (F-B1-1b).
    //
    // ponytail: read-then-write TOCTOU — another completed entry could land
    // between the list and the update. Unreachable for a single carer today
    // because `time_entries_one_running_per_carer` admits only one runner;
    // upgrade to a btree_gist exclusion constraint if concurrent clock-outs
    // across carers (or a future multi-device path) ever race here.
    //
    // A session that runs across the household's Monday is TWO weeks' work
    // and is split into two rows (C6) — see `clockOutAcrossWeeks`. Unlike
    // `createRetroactiveEntry` and `updateEntry`, this path never rejects a
    // week crossing: refusing would strand the `running` row with no way to
    // close it, the exact stuck-entry class F-B2-4 exists to remove, and the
    // hours already happened.
    const boundary = this.weekBoundaryWithin(clockInAt, clockOutAt, entry);
    if (boundary) {
      return this.clockOutAcrossWeeks(userId, entry, {
        clockInAt,
        clockOutAt,
        boundary,
        breakMinutes: input.break_minutes ?? entry.break_minutes,
        scheduledMinutes,
        note: input.note,
      });
    }

    await this.assertNoOverlap(
      entry.household_id,
      userId,
      clockInAt,
      clockOutAt,
      timeEntryId
    );

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
   * The instant this session crosses into a new week, or null if it doesn't.
   *
   * The zone is the ENTRY's own frozen `timezone`, not the household's
   * current one: `local_date` was derived from that column by the trigger and
   * every week read filters on `local_date`, so a household that PATCHed its
   * timezone mid-session would otherwise have the split boundary and the
   * bucket disagree (the same anchoring `updateEntry` documents).
   *
   * A finish exactly AT the boundary is not a crossing: ranges here are
   * half-open, so those minutes are all in week A and a second fragment would
   * be a zero-length row.
   *
   * `MAX_SESSION_SPAN_MS` (16h) is what makes one boundary enough — no loop
   * is needed because no legal session can span two Mondays.
   */
  private weekBoundaryWithin(
    clockInAt: string,
    clockOutAt: string,
    entry: TimeEntry
  ): string | null {
    const timeZone = entry.timezone;
    if (
      weekStartOf(new Date(clockInAt), timeZone) ===
      weekStartOf(new Date(clockOutAt), timeZone)
    ) {
      return null;
    }
    const midnight = mondayMidnightInstant(new Date(clockInAt), timeZone);
    return new Date(clockOutAt).getTime() > midnight.getTime()
      ? midnight.toISOString()
      : null;
  }

  /**
   * Close a Sunday-night session as TWO rows, one per week (C6).
   *
   * Filing the whole session under the clock-in's week overstates one
   * timesheet and leaves the other empty — and a parent then approves a week
   * that never contained those hours. `rollUpIntoTimesheet` recomputes ONE
   * week from `local_date`, so the split has to happen at the write.
   *
   * WRITE ORDER — B first, then A, so every crash state is recoverable by the
   * carer simply tapping Clock out again:
   *   1. adopt an identical fragment B left by a previous crashed attempt, if
   *      there is one, and overlap-check what we are about to write;
   *   2. INSERT fragment B (`[midnight, out)`, submitted);
   *   3. UPDATE the running row into fragment A (`[in, midnight)`) — it KEEPS
   *      its id, so the client's reference stays valid and this returns the
   *      row the caller asked about;
   *   4. roll up A's week, then B's.
   * Crashing after 2 leaves B written and the runner still open; the retry
   * adopts B rather than double-paying Monday morning. Crashing after 3
   * leaves both rows complete and the totals stale, which any later roll-up
   * self-heals and the `timesheet_total_mismatch` integrity check catches.
   * A runner the carer never comes back to is caught by `stuck_runner`.
   *
   * ROUNDING AND THE BREAK. Each fragment's span rounds on its own, so the
   * pair can differ from the whole by a minute: `drift` is that difference,
   * and folding it into the break total makes `minutesA + minutesB` equal the
   * minutes the session actually worked. The break itself is apportioned by
   * duration through `allocateMinutes`, the one place minutes are divided.
   *
   * Roll-up un-approve semantics are unchanged: B's week is the current week
   * and cannot be approved yet; A's week behaves exactly as any other
   * Sunday-night clock-out into an approved week does today.
   */
  private async clockOutAcrossWeeks(
    userId: string,
    entry: TimeEntry,
    plan: {
      clockInAt: string;
      clockOutAt: string;
      boundary: string;
      breakMinutes: number;
      scheduledMinutes: number | null;
      note?: string | null;
    }
  ): Promise<TimeEntry> {
    const inMs = new Date(plan.clockInAt).getTime();
    const boundaryMs = new Date(plan.boundary).getTime();
    const outMs = new Date(plan.clockOutAt).getTime();
    const durations = [boundaryMs - inMs, outMs - boundaryMs];

    const [breakA, breakB] = this.splitBreak(plan.breakMinutes, durations, {
      inMs,
      boundaryMs,
      outMs,
    });
    const [schedA, schedB] =
      plan.scheduledMinutes === null
        ? [null, null]
        : allocateMinutes(plan.scheduledMinutes, durations);

    const adopted = await this.findAbandonedFragment(
      userId,
      entry,
      plan.boundary
    );
    // Each span is checked SEPARATELY, so fragment A is never compared
    // against fragment B — they are adjacent, and 055's ranges are half-open,
    // so touching is legal. The running row itself is excluded from both.
    await this.assertNoOverlap(
      entry.household_id,
      userId,
      plan.clockInAt,
      plan.boundary,
      entry.id
    );

    let fragmentB = adopted;
    if (!fragmentB) {
      await this.assertNoOverlap(
        entry.household_id,
        userId,
        plan.boundary,
        plan.clockOutAt,
        entry.id
      );
      fragmentB = await this.timeEntryRepo.createSubmitted({
        household_id: entry.household_id,
        carer_id: userId,
        // The snapshot already frozen on the running row, not a fresh profile
        // read — the two halves of one session must not disagree about who
        // worked it (033_preserve_payroll_on_carer_deletion.sql).
        carer_display_name: entry.carer_display_name,
        shift_id: entry.shift_id,
        clock_in_at: plan.boundary,
        clock_out_at: plan.clockOutAt,
        break_minutes: breakB ?? 0,
        scheduled_minutes: schedB,
        timezone: entry.timezone,
        kind: 'worked',
        status: 'submitted',
        // Both halves carry the carer's explanation: it describes the
        // session, and a Monday-morning row with no context is the half a
        // parent is most likely to query.
        note: plan.note ?? entry.note,
      });
    }

    const patch: Partial<TimeEntry> = {
      clock_out_at: plan.boundary,
      break_minutes: breakA ?? 0,
      scheduled_minutes: schedA,
      status: 'submitted',
    };
    if (plan.note !== undefined) {
      patch.note = plan.note;
    }
    const fragmentA = await this.timeEntryRepo.update(entry.id, patch);

    await this.rollUpIntoTimesheet(fragmentA, userId);
    await this.rollUpIntoTimesheet(fragmentB, userId);
    return fragmentA;
  }

  /**
   * Apportion the break across the two fragments so their minutes still add
   * up to the session's.
   *
   * `drift` is what independent rounding costs: `round(A) + round(B)` can
   * exceed or fall short of `round(whole)` by one. Adding it to the break
   * total before apportioning cancels it exactly, since each fragment's
   * minutes are its rounded span minus its share of the break. The price is
   * that the two rows can record a minute more break between them than the
   * carer typed — a display-only artifact, taken deliberately because the
   * minutes she is PAID for are the number that must not move.
   *
   * ponytail: `drift === -1` with no break at all would need a NEGATIVE
   * break, which `017_time_tracking.sql` forbids (`check (break_minutes >=
   * 0)`) and which would be a lie about the session anyway. That corner
   * accepts a one-minute deviation instead. Unlike a cancelled window there
   * is no booked figure to conserve against here — both roundings are within
   * 30 seconds of the truth — so the honest column wins over the tidy sum.
   */
  private splitBreak(
    breakMinutes: number,
    durations: readonly number[],
    spans: { inMs: number; boundaryMs: number; outMs: number }
  ): number[] {
    const drift =
      Math.round((spans.boundaryMs - spans.inMs) / 60_000) +
      Math.round((spans.outMs - spans.boundaryMs) / 60_000) -
      Math.round((spans.outMs - spans.inMs) / 60_000);
    const target = breakMinutes + drift;
    return target < 0 ? [0, 0] : allocateMinutes(target, durations);
  }

  /**
   * Fragment B from a previous attempt that crashed after writing it, or
   * null.
   *
   * Identity is `(this household, worked, starts exactly at the boundary)` —
   * the shape only this split writes. Adopting it is what makes the retry
   * idempotent; inserting a second one would pay Monday morning twice.
   */
  private async findAbandonedFragment(
    carerId: string,
    entry: TimeEntry,
    boundary: string
  ): Promise<TimeEntry | null> {
    const candidates = await this.timeEntryRepo.listOverlapCandidatesForCarer(
      carerId,
      boundary,
      boundary
    );
    const boundaryMs = new Date(boundary).getTime();
    return (
      candidates.find(
        row =>
          row.id !== entry.id &&
          row.household_id === entry.household_id &&
          row.kind === 'worked' &&
          // INSTANTS, never the strings. PostgREST returns timestamptz as
          // `2026-01-12T00:00:00+00:00` while `toISOString()` produces
          // `...T00:00:00.000Z` — the same moment, and a string compare that
          // is never true. It would make this adoption dead code in
          // production only: the orphan would then be rejected as an overlap
          // and the running row could never be closed at all.
          !!row.clock_in_at &&
          new Date(row.clock_in_at).getTime() === boundaryMs
      ) ?? null
    );
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

    await this.assertNoOverlap(
      input.household_id,
      userId,
      clockInAt,
      clockOutAt
    );

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
   * Record hours owed under a short-notice cancellation, trimmed to the parts
   * of the window she did NOT already work. Returns the fragments THIS CALL
   * wrote — `[]` means nothing was owed, which is what
   * `cancellationPayReconcileJob` reads as "settled".
   *
   * Idempotent, but NOT on `shift_id` — since 053 a window can be several
   * rows and "one exists" is the wrong question (it reads a half-written
   * remainder as done). Idempotency is structural instead: rows already
   * written come back from the overlap query and are subtracted from the
   * remainder, so a second call computes no gaps and returns `[]`.
   *
   * `time_entries_one_cancellation_paid_per_span` (053, keyed on
   * `(shift_id, clock_in_at)`) is the source of truth under concurrent
   * accepts — a 23505 loses the race for THAT FRAGMENT and re-fetches by
   * span. Only the raced fragment's winner comes back; the others are this
   * call's own inserts.
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
  ): Promise<TimeEntry[]> {
    if (!shift.cancellation_paid || !shift.carer_id) {
      return [];
    }

    // No shift-wide find-first any more. Since 053 a cancelled window can be
    // SEVERAL rows, and "one of them exists" is the wrong question — it would
    // return early after a partial write and never write the missing
    // fragment. Idempotency now falls out of the arithmetic instead: rows
    // already written are candidates below, so they are subtracted from the
    // remainder and a re-call writes only what is genuinely missing.
    this.assertCancellationPaidSpan(shift.starts_at, shift.ends_at);

    const household = await this.householdRepo.findById(shift.household_id);
    const timeZone = household?.timezone ?? 'UTC';

    // Pay for the parts of the window that were ACTUALLY cancelled. Writing
    // the whole booked span over time she already worked is wrong twice over:
    // - across a RUNNING session it leaves no valid clock-out at all —
    //   `assertClockOrder` needs a finish after the clock-in, and every such
    //   finish would land inside the span — stranding the row permanently
    //   and, via the carer-global `time_entries_one_running_per_carer`,
    //   blocking clock-ins in every household she works for;
    // - across COMPLETED worked time it double-pays: `sumWorkedMinutes` and
    //   the earnings engine both add `worked` and `cancellation_paid` kinds,
    //   so the same minutes are banked twice.
    //
    // Writing nothing is equally wrong — it silently underpays her for every
    // hour that genuinely was cancelled. So pay the remainder, all of it:
    // worked time in the MIDDLE leaves two disjoint fragments and she is owed
    // both. Migration 053 keys the unique index on `(shift_id, clock_in_at)`
    // precisely so both can exist; before it, only one row per shift was
    // representable and this refused the shape outright.
    const alreadyBooked =
      await this.timeEntryRepo.listOverlapCandidatesForCarer(
        shift.carer_id,
        shift.starts_at,
        shift.ends_at
      );
    // THIS household's rows only. The cancelling household owes the window IT
    // booked; hours she worked for another family are not this household's
    // credit to take, and subtracting them made her pay depend on when the
    // reconcile job happened to run. The query is carer-global because the
    // OTHER question it serves (`assertNoOverlap`) has to be — one filter
    // here is cheaper than a second query.
    const thisHousehold = alreadyBooked.filter(
      row => row.household_id === shift.household_id
    );
    const startMs = new Date(shift.starts_at).getTime();
    const endMs = new Date(shift.ends_at).getTime();
    // Only real presence is subtracted from the BUDGET — a cancellation row
    // is money already spent on the window, not time she was there.
    const presence = thisHousehold.filter(
      row => row.kind !== 'cancellation_paid'
    );
    // The stretches that still have no row at all. Cancellation rows DO close
    // a gap here: they already cover it.
    const remainders = splitAtWeekBoundaries(
      remainingSpans(startMs, endMs, thisHousehold),
      timeZone
    );

    // Approved-week guard, AFTER the arithmetic and against EVERY fragment's
    // own week — household-local Monday, same as roll-ups /
    // createRetroactiveEntry. Checking only the window's start week was safe
    // while a cancellation was one row; an overnight window reaches the
    // following Monday, and `rollUpIntoTimesheet` un-approves whatever week it
    // lands on UNCONDITIONALLY — nulling the frozen gross a parent signed off.
    // Every fragment now lies inside ONE week (`splitAtWeekBoundaries`), so
    // taking each one's start week covers every week that can be touched. It
    // refuses BEFORE anything is written, so a partial write cannot leave one
    // fragment banked against a refusal.
    for (const weekStart of new Set(
      remainders.map(span => weekStartOf(new Date(span.from), timeZone))
    )) {
      const existing = await this.timesheetRepo.findByWeek(
        shift.household_id,
        shift.carer_id,
        weekStart
      );
      if (existing?.status === 'approved') {
        throw new TimeEntryNotEditableError('new', 'week_approved');
      }
    }

    // ROUND ONCE, AGAINST THE WINDOW (C7). Rounding every piece
    // independently drifts by up to a minute per boundary, and a middle split
    // has two of them: 11:00:20-12:00:40 gave 60 + 419 = 479 against a 480
    // window, 11:00:31-12:00:29 gave 481, and 08:00:00-09:00:30 gave 481 on
    // the half-minute tie (Math.round is half-up on both sides). ~£0.25 a
    // shift at £15/h, in a direction nobody chose.
    //
    // So the booked window is rounded ONCE and two things come off it: the
    // time she was PRESENT for (`presenceMinutesOf`) and the minutes this
    // window has ALREADY banked. What is left is apportioned across the
    // stretches still missing a row. The window therefore always banks
    // exactly what it booked, whatever has been written before and in
    // whatever order.
    //
    // These minutes are what gets PAID: `entryMinutes` reads
    // `scheduled_minutes` as authoritative for this kind, and the SQL twin in
    // 061_integrity_checks_departed_carers.sql re-checks the same sum.
    const bookedMinutes = Math.round((endMs - startMs) / 60_000);
    const budget = presence.reduce(
      (left, row) => left - presenceMinutesOf(row, startMs, endMs),
      bookedMinutes
    );
    if (budget < 0) {
      // Only reachable if the presence rows already cover more than the
      // window booked — drifted data, not arithmetic. Pay nothing rather than
      // a negative, and say so: `017`'s check constraints would not catch a
      // negative here, and a silent one becomes a wrong paycheck.
      logger.error('Cancellation residual went negative', {
        shiftId: shift.id,
        bookedMinutes,
        budget,
      });
    }
    // What is still OWED, apportioned across the fragments about to be
    // written, by duration. `allocateMinutes` is the one place this codebase
    // divides minutes, and it conserves exactly — so the window always banks
    // `budget`, whatever has already been written and in whatever order.
    //
    // Subtracting what is already banked is what keeps a REPAIR honest. A
    // reconcile re-run after the carer shortened a worked entry finds a small
    // freed sliver inside a gap the household has already paid most of;
    // apportioning the gap's whole worth to it banked 270 minutes for 30
    // minutes of window, permanently (NEW-9).
    //
    // WHOLLY INSIDE, not merely overlapping. `listOverlapCandidatesForCarer`
    // is inclusive at both ends and 055 permits touching ranges, so the
    // NEIGHBOURING cancelled shift's fragment comes back here too — a morning
    // 08:00-16:00 and an afternoon 16:00-20:00 are two windows, and counting
    // one against the other paid the second nothing at all. Containment is
    // the right test precisely because 055 keeps this household's
    // cancellation rows disjoint: a row inside this window can only be one of
    // this window's own.
    //
    // What this does NOT promise: that a fragment's minutes equal its own
    // rounded span. Sub-minute boundaries mean the window's rounded total is
    // not the sum of its pieces' rounded spans, and that difference has to
    // land somewhere; a randomized sweep over ~7,500 windows puts the worst
    // case at 2 minutes. The window total is the figure that must be exact,
    // and it always is.
    const alreadyBankedMinutes = thisHousehold.reduce(
      (sum, row) =>
        row.kind === 'cancellation_paid' &&
        row.clock_in_at !== null &&
        row.clock_out_at !== null &&
        // Instants, never the strings — PostgREST's `+00:00` and our own
        // `.000Z` are the same moment (CRIT-1).
        new Date(row.clock_in_at).getTime() >= startMs &&
        new Date(row.clock_out_at).getTime() <= endMs
          ? sum + Math.max(0, row.scheduled_minutes ?? 0)
          : sum,
      0
    );
    const owed = budget - alreadyBankedMinutes;
    if (owed < 0 && remainders.length > 0) {
      // The window has banked MORE than it booked and still has an unwritten
      // stretch — it cannot pay for it, and it cannot un-write the excess
      // either. Clamping to zero is right, staying quiet is not. NOTE this log
      // line is the ONLY detector: none of `run_integrity_checks`' checks
      // compares a shift's summed fragment minutes against its booked span, so
      // a fully-settled over-banked window (no unwritten stretch left) is
      // invisible everywhere. Unreachable after the containment fix except via
      // pre-fix leftovers or a manual DB edit; the upgrade path is a ninth
      // integrity check "Σ cancellation fragments per shift <= booked span".
      logger.error('Cancelled window has banked more than it booked', {
        shiftId: shift.id,
        bookedMinutes,
        alreadyBankedMinutes,
        unwrittenSpans: remainders.length,
      });
    }
    const shares = allocateMinutes(
      Math.max(0, owed),
      remainders.map(span => span.to - span.from)
    );

    const carerDisplayName = await this.resolveCarerDisplayName(shift.carer_id);
    const created: TimeEntry[] = [];
    for (const [index, span] of remainders.entries()) {
      created.push(
        await this.writeCancellationFragment(shift, {
          carerId: shift.carer_id,
          clockInAt: new Date(span.from).toISOString(),
          clockOutAt: new Date(span.to).toISOString(),
          carerDisplayName,
          timezone: timeZone,
          scheduledMinutes: shares[index] ?? 0,
        })
      );
    }

    // Roll up per fragment rather than once at the end: the roll-up is
    // idempotent and recomputes a whole week, and two fragments of an
    // overnight window can land in different weeks.
    for (const entry of created) {
      await this.rollUpIntoTimesheet(entry, shift.carer_id);
    }
    return created;
  }

  /**
   * Insert ONE fragment of a cancelled window, recovering the winner if a
   * concurrent accept got there first.
   *
   * The 23505 recovery is span-scoped, matching 053's
   * `(shift_id, clock_in_at)` unique index. A shift-wide re-fetch would be
   * ambiguous now that a window can be several rows — it could return a
   * different fragment than the one whose insert just lost.
   */
  private async writeCancellationFragment(
    shift: CancellationPaidShiftInput,
    fragment: {
      carerId: string;
      clockInAt: string;
      clockOutAt: string;
      carerDisplayName: string;
      timezone: string;
      /**
       * The minutes this fragment BANKS — computed once against the whole
       * window by the caller, never re-derived here from the fragment's own
       * span. Passed explicitly because it is the number that gets paid
       * (`entryMinutes`), and the last fragment's differs from its span.
       */
      scheduledMinutes: number;
    }
  ): Promise<TimeEntry> {
    try {
      return await this.timeEntryRepo.createSubmitted({
        household_id: shift.household_id,
        carer_id: fragment.carerId,
        carer_display_name: fragment.carerDisplayName,
        shift_id: shift.id,
        clock_in_at: fragment.clockInAt,
        clock_out_at: fragment.clockOutAt,
        break_minutes: 0,
        // This fragment's share of the window, never the shift's original
        // booking — a row claiming 480 scheduled while its clock times cover
        // 180 would misreport against itself. Within a minute of its own
        // span; the difference is the round-once residual (C7).
        scheduled_minutes: fragment.scheduledMinutes,
        // HOUSEHOLD zone, not `shift.timezone`. `local_date` is trigger-derived
        // from THIS column (017_time_tracking.sql) and every week read filters
        // on `local_date`, so a shift zone that disagrees files these paid
        // minutes into a week nobody sums.
        timezone: fragment.timezone,
        kind: 'cancellation_paid',
        status: 'submitted',
        note: null,
      });
    } catch (err) {
      if (err instanceof CancellationPaidAlreadyRecordedError) {
        const winner = await this.timeEntryRepo.findCancellationPaidForSpan(
          shift.id,
          fragment.clockInAt
        );
        if (winner) {
          return winner;
        }
        // The violation says a row exists; the re-fetch says it does not, so
        // the winner's transaction rolled back in between. Nothing was
        // written and nothing is owed to anyone yet — surfacing beats
        // returning null, which dropped the fragment with no error, no log
        // and no roll-up, and left the shift reading as settled.
        logger.error('Cancellation fragment lost its 23505 winner', {
          shiftId: shift.id,
          clockInAt: fragment.clockInAt,
        });
      }
      throw err;
    }
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
    // Cancellation pay is system-generated compensation, not a record of
    // something she did, so there is nothing here for her to correct. Since
    // C7 its PAY is the stored `scheduled_minutes`, apportioned once against
    // the whole cancelled window: moving the clock times would leave a row
    // reading three hours while banking four, and would corrupt the presence
    // arithmetic the next reconcile run does over that same window. A wrong
    // cancellation is fixed by fixing the shift.
    if (entry.kind === 'cancellation_paid') {
      throw new TimeEntryNotEditableError(timeEntryId, 'cancellation_paid');
    }

    const originalClockInAt = entry.clock_in_at;
    if (!originalClockInAt) {
      throw new InvalidClockTimesError('MISSING_CLOCK_TIME', { timeEntryId });
    }
    const { clockInAt, clockOutAt } = this.assertClockOrder(
      input.clock_in_at ?? originalClockInAt,
      input.clock_out_at ?? entry.clock_out_at
    );

    // The ROW's own frozen zone, not the household's current one. `local_date`
    // was derived from this column when the row was written and nothing
    // rewrites it, so the household PATCHing its timezone would otherwise
    // make this guard check one week while `rollUpIntoTimesheet` rewrites
    // another — an edit on an approved week would slip straight through
    // (F-B1-4, same family). Anchoring here keeps guard, week-crossing check
    // and roll-up bucket on one source: `weekStartOf(clock_in, entry.timezone)`
    // is by construction `weekStartOfLocalDate(entry.local_date)`, and the
    // trigger recomputes `local_date` from this same unchanged column.
    const timeZone = entry.timezone;
    const weekStart = weekStartOf(new Date(originalClockInAt), timeZone);

    // ponytail: a clock edit that crosses a week boundary is rejected
    // rather than handled — `rollUpIntoTimesheet` recomputes ONE week, so
    // moving an entry out of this one would leave the week it left behind
    // overstated. Both ends must stay in the original week: checking only
    // clock-in let a finish land on the following Sunday and still price
    // entirely into the original week. Teach the roll-up to take both weeks
    // if overnight corrections across a Monday ever turn out to matter.
    if (weekStartOf(new Date(clockInAt), timeZone) !== weekStart) {
      throw new InvalidClockTimesError('CLOCK_IN_CHANGES_WEEK', {
        timeEntryId,
        weekStart,
      });
    }
    if (weekStartOf(new Date(clockOutAt), timeZone) !== weekStart) {
      throw new InvalidClockTimesError('CLOCK_OUT_CHANGES_WEEK', {
        timeEntryId,
        weekStart,
        clockOutAt,
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

    await this.assertNoOverlap(
      entry.household_id,
      userId,
      clockInAt,
      clockOutAt,
      timeEntryId
    );

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
   * violation surfacing as a 500 — and adds the bounds the DB cannot know
   * about: a finish may not be in the future, and a single session may not
   * exceed `MAX_SESSION_SPAN_MS`. `clockOut`, `createRetroactiveEntry`, and
   * `updateEntry` all route through here, so one guard covers every write
   * path that invents worked hours.
   *
   * Returns the pair it validated so callers get the non-null narrowing for
   * free rather than re-asserting it.
   *
   * Not for `recordCancellationPaidEntry` — paid-cancel spans are often
   * still in the future and are already bounded by the shift; use
   * `assertCancellationPaidSpan` instead.
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
    if (outMs - inMs > MAX_SESSION_SPAN_MS) {
      throw new InvalidClockTimesError('CLOCK_SPAN_TOO_LONG', {
        clockInAt,
        clockOutAt,
        maxSpanMs: MAX_SESSION_SPAN_MS,
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
   * Reject a span that intersects another entry for the same carer — ANY
   * other entry, in any week, running or finished.
   *
   * Candidates come from `listOverlapCandidatesForCarer`, which asks about
   * CLOCK INSTANTS, not `local_date`. The week-filtered lookup this used to
   * do had three holes, all of them ways to bank the same minutes twice or
   * to strand a row nobody can clock out (F-B1-1, F-B2-4):
   * - an entry on the other side of Monday is filed under the previous week
   *   and was simply invisible — and a legitimate overnight session is well
   *   inside `MAX_SESSION_SPAN_MS`, so this is ordinary, not exotic;
   * - `clockOut` derived the week from the clock-IN alone, so a finish
   *   landing in the next week was checked against the wrong week entirely;
   * - a RUNNING entry was skipped outright, in every week.
   *
   * `clockOutAt` is null for a clock-IN: there is no finish yet, so the
   * prospective entry is the instant it starts (see `spansOverlap`).
   * `excludeEntryId` lets `updateEntry`/`clockOut` ignore the row being
   * written so it never counts as overlapping itself.
   *
   * Since 055 there IS a DB backstop: two `tstzrange` exclusion constraints
   * reproduce the permission table below exactly (worked-vs-worked per carer,
   * and anything-vs-anything within one household, cancellation pay exempt
   * across households). This check is still the one that produces a
   * renderable 409 instead of a 23P01 — and it sees RUNNING rows, which the
   * constraints deliberately do not. The two must stay in agreement; 055's
   * header is the spec both are written against.
   */
  private async assertNoOverlap(
    householdId: string,
    carerId: string,
    clockInAt: string,
    clockOutAt: string | null,
    excludeEntryId?: string
  ): Promise<void> {
    const inMs = new Date(clockInAt).getTime();
    const outMs = clockOutAt === null ? null : new Date(clockOutAt).getTime();
    const candidates = await this.timeEntryRepo.listOverlapCandidatesForCarer(
      carerId,
      clockInAt,
      clockOutAt ?? clockInAt
    );
    for (const other of candidates) {
      if (excludeEntryId && other.id === excludeEntryId) continue;
      if (!other.clock_in_at) continue;
      const otherIn = new Date(other.clock_in_at).getTime();
      const otherOut = other.clock_out_at
        ? new Date(other.clock_out_at).getTime()
        : null;
      if (!spansOverlap(inMs, outMs, otherIn, otherOut)) continue;
      // Every caller writes WORKED time, so two clauses decide it:
      //   other is worked      -> refuse, she cannot be in two places at once
      //   same household       -> refuse, that is the within-household
      //                           double-bank (`sumWorkedMinutes` and the
      //                           earnings engine add both kinds together)
      // Anything else is another household's `cancellation_paid`, which is
      // compensation for time deliberately NOT worked and therefore does not
      // occupy the clock. She may work for B inside a window A is paying her
      // to have free.
      if (other.kind !== 'worked' && other.household_id !== householdId) {
        continue;
      }
      throw new TimeEntryOverlapError({
        clockInAt,
        clockOutAt,
        overlappingEntryId: other.id,
        overlappingClockInAt: other.clock_in_at,
        overlappingClockOutAt: other.clock_out_at,
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

    // Carer currently only learns of an approved week by opening Hours — push
    // her so she knows her pay is final for the week. Fire-and-forget: a push
    // failure must never fail the approval write the parent already completed.
    if (approved.carer_id) {
      try {
        this.push.notifyUser(approved.carer_id, {
          title: 'Hours approved',
          body: 'A parent approved your hours this week.',
          data: {
            type: PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED,
            timesheetId: approved.id,
            householdId: approved.household_id,
            weekStart: approved.week_start,
          },
        });
      } catch {
        // notifyUser is sync fire-and-forget; swallow any unexpected throw
      }
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
    // INDIVIDUALLY-CAPPED INPUTS MULTIPLY INTO UNBOUNDED COMPUTED MONEY — the
    // DB CHECK is the backstop, this guard is the clean failure.
    // `rate_minor` is capped at MAX_MONEY_MINOR (041/063 and the Zod schema)
    // and a week bounds the hours, and neither bound says anything about
    // `hours x rate`: 40 hours at the schema-legal maximum rate computes
    // 3_999_999_960, past migration 063's `timesheets_gross_minor_upper` AND
    // past int4, so the approve write below died on a raw Postgres "value out
    // of range" — a 500 for the parent, unattributable in the logs. Refusing
    // here, where the ok-arm's gross is first known and before the CAS, makes
    // it a readable 400 with the offending figure attached.
    //
    // NOT CLAMPED, deliberately (`docs/11-MONEY.md` §1): a gross trimmed to
    // fit is a wrong figure a parent would sign off and a nanny would be paid.
    // Only the `ok` arm reaches here — the unpriceable arms returned NULL
    // above and have no product to bound.
    if (earnings.gross_minor > MAX_MONEY_MINOR) {
      throw new TimesheetGrossTooLargeError(
        timesheet.id,
        earnings.gross_minor,
        MAX_MONEY_MINOR
      );
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
   * Owner/parent only. Undo for `approve`: return an approved week to
   * `submitted` and clear the frozen earnings snapshot so corrections can
   * land again. Without this, an approved week that is no longer the current
   * week is permanently frozen — every write path rejects it, and even
   * `query` is refused because only `submitted` is actionable.
   *
   * Snapshot clear reuses `CLEARED_EARNINGS_SNAPSHOT` — the same literal
   * `rollUpIntoTimesheet` writes — so approve and reopen cannot drift on
   * which columns null out. The caller-supplied reason is written BOTH as
   * display state on the timesheet row (`reopen_reason`, cleared on the
   * next approve) AND as an append-only day-thread event — reopening is a
   * money-visible act and must not be silent. Deliberately NOT on
   * `query_note`: that column means "a parent queried this week", and
   * `ParentWeekView` renders it as "Queried: {{note}}" whenever the status
   * is 'queried'. Writing a reopen reason there would mislabel an
   * undo-approve as an open dispute the next time anyone reads the row.
   * The two are different facts about a week and must not share a column.
   */
  async reopen(
    userId: string,
    timesheetId: string,
    input: ReopenTimesheetInput
  ): Promise<Timesheet> {
    const timesheet = await this.queries.getOwnedTimesheet(userId, timesheetId);
    await this.assertWriteMember(userId, timesheet.household_id);
    if (timesheet.status !== 'approved') {
      throw new TimesheetNotActionableError(timesheetId, timesheet.status);
    }

    const updated = await this.timesheetRepo.update(timesheetId, {
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      reopen_reason: input.reason,
      ...CLEARED_EARNINGS_SNAPSHOT,
    });

    const auditEvent: NewShiftEventInput = {
      household_id: timesheet.household_id,
      shift_id: null,
      local_date: timesheet.week_start,
      actor_id: userId,
      event_type: 'timesheet_reopened',
      payload: {
        timesheetId,
        reason: input.reason,
        weekStart: timesheet.week_start,
      },
    };
    try {
      await this.eventRepo.insertMany([auditEvent]);
    } catch {
      // Day-thread append is best-effort audit: the reopen write already
      // succeeded and must not be rolled back for a logging failure.
    }

    // Carer currently only learns of a reopened week by opening Hours — push
    // her so she knows her pay is no longer final. Fire-and-forget: a push
    // failure must never fail the reopen write the parent already completed.
    if (updated.carer_id) {
      try {
        this.push.notifyUser(updated.carer_id, {
          title: 'Hours reopened',
          body: 'A parent has reopened your hours this week.',
          data: {
            type: PUSH_NOTIFICATION_TYPES.TIMESHEET_REOPENED,
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

    // Bucket from the entry's OWN frozen `local_date`, never by re-deriving a
    // week from the current household timezone. `listForCarerWeek` filters on
    // `local_date`, and nothing rewrites that column when a household PATCHes
    // its timezone (the trigger fires only on clock/timezone column updates),
    // so deriving the bucket the other way makes the sum and the filter
    // disagree and drops entries out of the recomputed total. Same date, one
    // source — see `weekStartOfLocalDate`.
    const weekStart = weekStartOfLocalDate(entry.local_date);

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
      const created = await this.timesheetRepo.create({
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
      // A week CREATED `submitted` is the other way into that status, and
      // the parent's first notice that hours exist at all — the only other
      // signal is `reminderJob`'s 09:00 digest the next morning.
      this.notifyParentsOfSubmission(entry, weekStart, created.id);
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
      this.notifyParentsOfSubmission(entry, weekStart, existing.id);
    }
  }

  /**
   * The parent nudge for a week that has just moved INTO `submitted` — the
   * ONLY transition that fires it. A roll-up onto an already-`submitted`
   * week (Wednesday's clock-out on a week that started Monday) is not a
   * transition and pushes nothing: the parent has already been told, and a
   * notification per clock-out would train her to ignore the one that
   * matters. Both call sites above decide THAT; this method only knows how
   * to send it, so the two ways into `submitted` (a week created submitted,
   * and a week re-opened from `approved`/`queried`) can never drift into
   * sending different payloads.
   *
   * The `data` keys are a contract with the mobile route map, whose
   * `hoursHref` reads `householdId`/`weekStart`/`timesheetId` — `timesheetId`
   * used to be absent on the create branch, which left the very first push of
   * a week unable to deep-link to it.
   *
   * FIRE-AND-FORGET, and the try/catch is load-bearing rather than
   * belt-and-braces: this runs inside `clockOut`/`createRetroactiveEntry`,
   * i.e. AFTER the hours are already written. A synchronous throw out of the
   * push seam would surface as a failed clock-out for work that has in fact
   * been recorded, and the carer would clock out again. `notifyHouseholdParents`
   * swallows its own async delivery errors; this catches the unexpected
   * synchronous ones, the same guard `approve`/`query`/`reopen` put around
   * their own pushes.
   */
  private notifyParentsOfSubmission(
    entry: TimeEntry,
    weekStart: string,
    timesheetId: string
  ): void {
    try {
      this.push.notifyHouseholdParents(entry.household_id, {
        title: 'Hours submitted',
        body: `${entry.carer_display_name ?? 'Your carer'} logged hours for this week.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED,
          householdId: entry.household_id,
          weekStart,
          timesheetId,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any
      // unexpected throw so a dead push service cannot reject real hours.
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
): Promise<TimeEntry[]> {
  return timesheetCommandService.recordCancellationPaidEntry(shift);
}
