/**
 * No-show sweep.
 *
 * Tells a household's parents when nobody has clocked in twenty minutes into a
 * confirmed shift. Runs every ten minutes on pg_cron (migration 066) — hourly
 * is far too coarse for a twenty-minute threshold.
 *
 * WINDOW: `starts_at + 20min <= now < starts_at + 2h`. The lower bound is the
 * grace period (traffic, a late handover, a phone that has not synced yet);
 * the upper bound stops the sweep from re-asking a question whose answer
 * stopped being actionable hours ago — by then the parent either knows or the
 * shift is nearly over, and a push at that point is noise.
 *
 * "ALREADY CLOCKED IN" is deliberately the same association
 * `timesheetCommandService.matchConfirmedShift` uses when it auto-attaches a
 * clock-in to a shift: any entry from `starts_at - 2h` onwards would be
 * matched to this shift, so any such entry means she is here. `hasClockedIn`
 * below adds the two cases the tolerance window alone would miss — an entry
 * explicitly carrying this `shift_id`, and an older session still running (or
 * one that ran past the start), where she is demonstrably at work even though
 * no auto-match would have fired.
 *
 * CLAIM: `push_reminder_log` (047/060), key `no_show:<shiftId>`, one row per
 * parent. No date segment, so the alert fires once ever per shift rather than
 * once per ten-minute tick across the whole window. The two-phase
 * claim/confirm and the crash-window reasoning are `reminderJob`'s —
 * `claimAndSend` is imported from there rather than copied.
 *
 * QUIET HOURS: `canDeliver` suppresses a push inside the recipient's quiet
 * hours, and that suppression is accepted here — an unclaimed candidate is
 * retried on later ticks until the window closes, and a shift that starts
 * inside a parent's own quiet hours is an edge worth losing on rather than a
 * reason to bypass their preferences.
 *
 * SETUP: scheduled every ten minutes via pg_cron in migration
 * `066_no_show_cron.sql` (POST `/api/jobs/no-show-sweep`). Requires Vault
 * secrets `cron_api_base_url` and `cron_job_api_key` (see migration 007).
 *
 * @module jobs/noShowJob
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { supabaseService } from '../config/supabase';
import { ReminderLogRepository } from '../domains/notification/repositories/reminderLogRepository';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';
import {
  claimAndSend,
  DefaultReminderParentLister,
  defaultPushService,
  emptyRuleStats,
  type ReminderJobClock,
  type ReminderLogClaim,
  type ReminderParentLister,
  type ReminderPushService,
  type ReminderRuleStats,
} from './reminderJob';

/** Grace period before a missing clock-in counts as a no-show. */
const NO_SHOW_GRACE_MS = 20 * 60 * 1000;
/** Past this the alert is stale — see the window note in the module doc. */
const NO_SHOW_WINDOW_END_MS = 2 * 60 * 60 * 1000;
/**
 * Mirrors `CLOCK_IN_MATCH_TOLERANCE_MS` in `timesheetCommandService`. These
 * two must stay equal: this job's "she is here" test is the inverse of that
 * service's "this clock-in belongs to that shift" test.
 */
const CLOCK_IN_MATCH_TOLERANCE_MS = 2 * 60 * 60 * 1000;

const UNNAMED_CARER_DISPLAY_NAME = 'Carer';

/**
 * Shift row plus the two pieces of context the copy needs — resolved by the
 * candidate source so the sweep itself stays a pure function of its inputs.
 */
export interface NoShowShiftCandidate
  extends Pick<Shift, 'id' | 'household_id' | 'carer_id' | 'starts_at'> {
  status: Shift['status'];
  /** Snapshot of the carer's profile name, or `Carer` when she has none. */
  carer_display_name: string;
  /** The HOUSEHOLD's IANA zone — the shift time is spoken in their words. */
  timezone: string;
}

/** Narrow time-entry row the coverage test needs. */
export type NoShowTimeEntry = Pick<
  TimeEntry,
  'shift_id' | 'clock_in_at' | 'clock_out_at'
>;

export interface NoShowCandidateSource {
  listStartedShifts(now: Date): Promise<NoShowShiftCandidate[]>;
}

export interface NoShowTimeEntryLister {
  /** Entries for this carer, in this household, that could cover the start. */
  listCoveringEntries(
    carerId: string,
    shift: NoShowShiftCandidate
  ): Promise<NoShowTimeEntry[]>;
}

export interface NoShowJobResult {
  noShow: ReminderRuleStats;
  errorCount: number;
  message: string;
}

export function buildNoShowKey(shiftId: string): string {
  return `no_show:${shiftId}`;
}

/**
 * `HH:MM` in `timeZone`, falling back to UTC when the household carries a
 * timezone Postgres accepted but `Intl` does not — a wrong-by-an-offset time
 * in the body is still a useful alert; throwing would lose it entirely.
 */
export function formatLocalTime(instantIso: string, timeZone: string): string {
  const instant = new Date(instantIso);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant);
  }
}

/**
 * Is there evidence this carer is actually working this shift? See the
 * module doc for why these three cases and no others.
 */
export function hasClockedIn(
  shift: NoShowShiftCandidate,
  entries: NoShowTimeEntry[]
): boolean {
  const startsMs = Date.parse(shift.starts_at);

  return entries.some(entry => {
    if (entry.shift_id === shift.id) {
      return true;
    }

    // Null on a manual adjustment, which proves nothing about attendance —
    // if one belongs to this shift the `shift_id` check above already caught
    // it.
    const clockInMs = entry.clock_in_at
      ? Date.parse(entry.clock_in_at)
      : Number.NaN;
    if (Number.isNaN(clockInMs)) {
      return false;
    }

    // What `matchConfirmedShift` would attach to this shift. No upper bound
    // is needed: the sweep only runs while `now < starts_at + 2h`, and the
    // query never returns an entry that starts after `now`.
    if (clockInMs >= startsMs - CLOCK_IN_MATCH_TOLERANCE_MS) {
      return true;
    }

    // An earlier session that is still running, or that ran past the start.
    const clockOutMs = entry.clock_out_at
      ? Date.parse(entry.clock_out_at)
      : Number.POSITIVE_INFINITY;
    return clockOutMs >= startsMs;
  });
}

class DefaultNoShowCandidateSource implements NoShowCandidateSource {
  async listStartedShifts(now: Date): Promise<NoShowShiftCandidate[]> {
    const nowMs = now.getTime();
    // `(now - 2h, now - 20min]` — the exact window, re-applied in-process by
    // `runNoShowJob` so the rule never depends on this query alone.
    const windowStart = new Date(nowMs - NO_SHOW_WINDOW_END_MS).toISOString();
    const windowEnd = new Date(nowMs - NO_SHOW_GRACE_MS).toISOString();

    const { data, error } = await supabaseService
      .from('shifts')
      .select('id, household_id, carer_id, starts_at, status')
      .eq('status', SHIFT_STATUSES.CONFIRMED)
      .not('carer_id', 'is', null)
      .gt('starts_at', windowStart)
      .lte('starts_at', windowEnd);

    if (error) {
      throw new DatabaseError(
        'Failed to list no-show candidates',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const shifts = (data ?? []) as Array<
      Pick<Shift, 'id' | 'household_id' | 'carer_id' | 'starts_at' | 'status'>
    >;
    if (shifts.length === 0) {
      return [];
    }

    const [timezones, names] = await Promise.all([
      this.loadTimezones([...new Set(shifts.map(s => s.household_id))]),
      this.loadCarerNames([
        ...new Set(
          shifts.map(s => s.carer_id).filter((id): id is string => !!id)
        ),
      ]),
    ]);

    return shifts.map(shift => ({
      ...shift,
      carer_display_name:
        (shift.carer_id ? names.get(shift.carer_id) : null) ??
        UNNAMED_CARER_DISPLAY_NAME,
      timezone: timezones.get(shift.household_id) ?? 'UTC',
    }));
  }

  private async loadTimezones(
    householdIds: string[]
  ): Promise<Map<string, string>> {
    const { data, error } = await supabaseService
      .from('households')
      .select('id, timezone')
      .in('id', householdIds);

    if (error) {
      throw new DatabaseError(
        'Failed to load household timezones for the no-show sweep',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const rows = (data ?? []) as Array<{ id: string; timezone: string }>;
    return new Map(rows.map(row => [row.id, row.timezone]));
  }

  private async loadCarerNames(
    carerIds: string[]
  ): Promise<Map<string, string>> {
    if (carerIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabaseService
      .from('user_profiles')
      .select('user_id, name')
      .in('user_id', carerIds);

    if (error) {
      throw new DatabaseError(
        'Failed to load carer names for the no-show sweep',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const rows = (data ?? []) as Array<{
      user_id: string;
      name: string | null;
    }>;
    const names = new Map<string, string>();
    for (const row of rows) {
      if (row.name) {
        names.set(row.user_id, row.name);
      }
    }
    return names;
  }
}

class DefaultNoShowTimeEntryLister implements NoShowTimeEntryLister {
  async listCoveringEntries(
    carerId: string,
    shift: NoShowShiftCandidate
  ): Promise<NoShowTimeEntry[]> {
    const startsAt = shift.starts_at;
    const toleranceStart = new Date(
      Date.parse(startsAt) - CLOCK_IN_MATCH_TOLERANCE_MS
    ).toISOString();

    // Household-scoped, like `matchConfirmedShift`: a carer clocked in at a
    // DIFFERENT family's home has not turned up at this one, and these
    // parents still need telling. `kind` is not filtered — a cancellation-pay
    // row covering the span means nobody was expected, which is equally a
    // reason not to alert.
    const { data, error } = await supabaseService
      .from('time_entries')
      .select('shift_id, clock_in_at, clock_out_at')
      .eq('carer_id', carerId)
      .eq('household_id', shift.household_id)
      .or(
        `clock_in_at.gte.${toleranceStart},clock_out_at.is.null,clock_out_at.gte.${startsAt}`
      );

    if (error) {
      throw new DatabaseError(
        'Failed to list time entries for the no-show sweep',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    return (data ?? []) as NoShowTimeEntry[];
  }
}

export async function runNoShowJob(
  candidates: NoShowCandidateSource = new DefaultNoShowCandidateSource(),
  entries: NoShowTimeEntryLister = new DefaultNoShowTimeEntryLister(),
  log: ReminderLogClaim = new ReminderLogRepository(),
  parents: ReminderParentLister = new DefaultReminderParentLister(),
  push: ReminderPushService = defaultPushService,
  clock: ReminderJobClock = { now: () => new Date() }
): Promise<NoShowJobResult> {
  const now = clock.now();

  // Same reason as the reminders job: free the claims a crashed run died
  // holding before anything on this pass tries to claim them.
  await log.sweepStaleClaims();

  const shifts = await candidates.listStartedShifts(now);
  const stats = emptyRuleStats();
  stats.candidates = shifts.length;

  for (const shift of shifts) {
    try {
      if (!isInNoShowWindow(shift, now)) {
        stats.skipped++;
        continue;
      }

      const carerId = shift.carer_id;
      if (!carerId) {
        stats.skipped++;
        continue;
      }

      const covering = await entries.listCoveringEntries(carerId, shift);
      if (hasClockedIn(shift, covering)) {
        stats.skipped++;
        continue;
      }

      const parentIds = await parents.listParentUserIds(shift.household_id);
      if (parentIds.length === 0) {
        stats.skipped++;
        continue;
      }

      const reminderKey = buildNoShowKey(shift.id);
      const payload = {
        title: 'No one has clocked in',
        body: `${shift.carer_display_name} hasn't clocked in for the ${formatLocalTime(
          shift.starts_at,
          shift.timezone
        )} shift at your home.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW,
          shiftId: shift.id,
          householdId: shift.household_id,
        },
      };

      for (const parentId of parentIds) {
        await claimAndSend(
          { log, push },
          parentId,
          reminderKey,
          payload,
          stats
        );
      }
    } catch (error) {
      stats.errors++;
      logger.error('No-show sweep failed to alert on a shift', {
        shiftId: shift.id,
        householdId: shift.household_id,
        error,
      });
    }
  }

  return {
    noShow: stats,
    errorCount: stats.errors,
    message: `No-show sweep sent ${stats.sent} push(es)`,
  };
}

/**
 * The status check is re-applied here even though the query filters on it —
 * same defence-in-depth as `matchConfirmedShift`, so the rule holds whatever
 * candidate source is injected.
 */
function isInNoShowWindow(shift: NoShowShiftCandidate, now: Date): boolean {
  if (shift.status !== SHIFT_STATUSES.CONFIRMED) {
    return false;
  }
  const age = now.getTime() - Date.parse(shift.starts_at);
  return age >= NO_SHOW_GRACE_MS && age < NO_SHOW_WINDOW_END_MS;
}
