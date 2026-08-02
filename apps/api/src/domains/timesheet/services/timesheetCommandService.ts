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

import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import {
  SHIFT_STATUSES,
  ShiftNotFoundError,
  ShiftRepository,
} from '../../shift';
import type { ShiftWithChildren } from '../../shift/repositories/shiftRepository';
import {
  AlreadyClockedInError,
  NotACarerError,
  NotATimesheetParentError,
  TimeEntryNotRunningError,
  TimesheetNotActionableError,
} from '../errors/timesheetErrors';
import { TimeEntryRepository } from '../repositories/timeEntryRepository';
import { TimesheetRepository } from '../repositories/timesheetRepository';
import type {
  ClockInInput,
  ClockOutInput,
  QueryTimesheetInput,
  TimeEntry,
  Timesheet,
} from '../types';
import { weekEndExclusive, weekStartOf } from '../utils/weekStart';
import {
  type TimesheetQueryService,
  timesheetQueryService,
} from './timesheetQueryService';

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

/** Minutes actually worked: clocked span minus the break, never negative. */
export function computeWorkedMinutes(
  clockInAt: string,
  clockOutAt: string,
  breakMinutes: number
): number {
  const rawMinutes = Math.round(
    (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 60_000
  );
  return Math.max(0, rawMinutes - breakMinutes);
}

/**
 * A week's total worked minutes, DERIVED fresh from its entries rather than
 * accumulated. Summing the same list twice always yields the same total —
 * that's what makes `rollUpIntoTimesheet` idempotent under a retried,
 * duplicated, or replayed clock-out, and lets the total self-heal if an
 * entry is later corrected or deleted. A still-running entry (no
 * `clock_out_at` yet) contributes 0 rather than throwing.
 */
export function sumWorkedMinutes(entries: readonly TimeEntry[]): number {
  return entries.reduce((total, entry) => {
    if (!entry.clock_in_at || !entry.clock_out_at) {
      return total;
    }
    return (
      total +
      computeWorkedMinutes(
        entry.clock_in_at,
        entry.clock_out_at,
        entry.break_minutes
      )
    );
  }, 0);
}

export class TimesheetCommandService {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly queries: TimesheetQueryService = timesheetQueryService
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

    const household = await this.householdRepo.findById(input.household_id);
    return this.timeEntryRepo.clockIn({
      household_id: input.household_id,
      carer_id: userId,
      shift_id: shiftId,
      clock_in_at: clockInAt.toISOString(),
      timezone: household?.timezone ?? 'UTC',
      kind: 'worked',
      status: 'running',
    });
  }

  /**
   * End a clock-in. Only the carer it belongs to may clock it out (enforced
   * by `queries.getOwnedTimeEntry`, which throws the SAME not-found error
   * whether the entry is missing or someone else's — see that method).
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
    const clockOutAt = new Date().toISOString();

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
    await this.rollUpIntoTimesheet(updated);
    return updated;
  }

  /** Owner/parent only. Requires submitted hours to act on. */
  async approve(userId: string, timesheetId: string): Promise<Timesheet> {
    const timesheet = await this.queries.getOwnedTimesheet(userId, timesheetId);
    await this.assertWriteMember(userId, timesheet.household_id);
    this.assertActionable(timesheet);

    return this.timesheetRepo.update(timesheetId, {
      status: 'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
      query_note: null,
    });
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

    return this.timesheetRepo.update(timesheetId, {
      status: 'queried',
      query_note: input.note,
    });
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
  private async rollUpIntoTimesheet(entry: TimeEntry): Promise<void> {
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
      entry.carer_id,
      weekStart,
      weekEndExclusive(weekStart)
    );
    const totalMinutes = sumWorkedMinutes(weekEntries);

    const existing = await this.timesheetRepo.findByWeek(
      entry.household_id,
      entry.carer_id,
      weekStart
    );
    if (!existing) {
      await this.timesheetRepo.create({
        household_id: entry.household_id,
        carer_id: entry.carer_id,
        week_start: weekStart,
        total_minutes: totalMinutes,
        status: 'submitted',
      });
      return;
    }

    // A fresh 'open' timesheet becomes 'submitted' on its first hours and
    // stays 'submitted' as more entries roll in. A timesheet a parent has
    // already acted on ('approved' or 'queried') is a terminal state: it
    // must never absorb new minutes silently. Re-open it to 'submitted' —
    // clearing the approval — so the parent is forced to look again rather
    // than being recorded as having approved hours they never saw.
    const reopening = TERMINAL_STATUSES.has(existing.status);
    await this.timesheetRepo.update(existing.id, {
      total_minutes: totalMinutes,
      status: 'submitted',
      ...(reopening ? { approved_by: null, approved_at: null } : {}),
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
