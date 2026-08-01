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
 * @module domains/timesheet/services/timesheetCommandService
 */

import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import { ShiftRepository } from '../../shift';
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
import { weekStartOf } from '../utils/weekStart';
import {
  type TimesheetQueryService,
  timesheetQueryService,
} from './timesheetQueryService';

const CARER_ROLES: ReadonlySet<string> = new Set([HOUSEHOLD_ROLES.NANNY]);
const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);
/** A timesheet can only be actioned once there is submitted time on it. */
const ACTIONABLE_STATUSES: ReadonlySet<string> = new Set(['submitted']);

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
   */
  async clockIn(userId: string, input: ClockInInput): Promise<TimeEntry> {
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

    const household = await this.householdRepo.findById(input.household_id);
    return this.timeEntryRepo.clockIn({
      household_id: input.household_id,
      carer_id: userId,
      shift_id: input.shift_id ?? null,
      clock_in_at: new Date().toISOString(),
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

  /** Find-or-create the week's timesheet and add this entry's worked minutes to its total. */
  private async rollUpIntoTimesheet(entry: TimeEntry): Promise<void> {
    if (!entry.clock_in_at || !entry.clock_out_at) {
      return; // defensive — clockOut always sets both before calling this
    }

    const household = await this.householdRepo.findById(entry.household_id);
    const weekStart = weekStartOf(
      new Date(entry.clock_in_at),
      household?.timezone ?? 'UTC'
    );
    const workedMinutes = computeWorkedMinutes(
      entry.clock_in_at,
      entry.clock_out_at,
      entry.break_minutes
    );

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
        total_minutes: workedMinutes,
        status: 'submitted',
      });
      return;
    }

    await this.timesheetRepo.update(existing.id, {
      total_minutes: existing.total_minutes + workedMinutes,
      // A fresh 'open' timesheet becomes 'submitted' on its first hours; an
      // already-actioned one (submitted/approved/queried) keeps its status —
      // late hours landing on an approved week are a reconciliation call for
      // a human, not something this rollup silently resolves.
      status: existing.status === 'open' ? 'submitted' : existing.status,
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
