/**
 * @module domains/schedule/utils/uncoveredWeek
 *
 * Thin adapter: map mobile/API row shapes into `computeUncovered` inputs and
 * aggregate per-day uncovered windows for a visible week. Interval maths live
 * in `@steadily-nanny/shared-types/uncoveredCare` only.
 */
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  type ClosureInput,
  type CoveredShiftInput,
  computeUncovered,
  type NeedWindowInput,
  type UncoveredWindow,
} from '@steadily-nanny/shared-types/uncoveredCare';

/** DB row -> the pure input shape `computeUncovered` consumes (API mirror). */
export function toCoveredShift(shift: Shift): CoveredShiftInput {
  return {
    id: shift.id,
    startsAt: shift.starts_at,
    endsAt: shift.ends_at,
    status: shift.status,
    children: (shift.shift_children ?? []).map(child => ({
      childId: child.child_id,
      startsAt: child.starts_at,
      endsAt: child.ends_at,
    })),
  };
}

/** DB row -> the pure input shape `computeUncovered` consumes (API mirror). */
export function toNeedWindow(commitment: ChildCommitment): NeedWindowInput {
  return {
    id: commitment.id,
    childId: commitment.child_id,
    rrule: commitment.rrule,
    startTime: commitment.start_time,
    endTime: commitment.end_time,
    startsOn: commitment.starts_on,
    endsOn: commitment.ends_on,
    exdates: commitment.exdates,
  };
}

function nextCalendarDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = (type: string): number =>
    Number(parts.find(p => p.type === type)?.value ?? '0');
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return (localAsUtc - utcMillis) / 60_000;
}

function zonedWallTimeToUtcMillis(
  dateStr: string,
  timeStr: string,
  timeZone: string
): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh = 0, mi = 0, ss = 0] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh, mi, ss);
  const offset1 = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;
  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return utc;
}

/** Closures overlapping one local calendar day (API mirror). */
export function closuresForLocalDate(
  closures: readonly HouseholdClosure[],
  localDate: string,
  timezone: string
): ClosureInput[] {
  const dayStart = zonedWallTimeToUtcMillis(localDate, '00:00:00', timezone);
  const dayEnd = zonedWallTimeToUtcMillis(
    nextCalendarDate(localDate),
    '00:00:00',
    timezone
  );
  return closures
    .filter(
      closure =>
        Date.parse(closure.starts_at) < dayEnd &&
        Date.parse(closure.ends_at) > dayStart
    )
    .map(closure => ({
      startsAt: closure.starts_at,
      endsAt: closure.ends_at,
    }));
}

/** UTC millis for a commitment's nominal wall-clock span on one local date. */
export function commitmentBoundsOnLocalDate(
  commitment: ChildCommitment,
  localDate: string,
  timezone: string
): { startUtc: number; endUtc: number } {
  return {
    startUtc: zonedWallTimeToUtcMillis(
      localDate,
      commitment.start_time,
      timezone
    ),
    endUtc: zonedWallTimeToUtcMillis(localDate, commitment.end_time, timezone),
  };
}

export interface UncoveredWeekResult {
  byDay: Record<string, UncoveredWindow[]>;
  totalCount: number;
}

export function computeUncoveredWeek(args: {
  weekDates: readonly string[];
  timezone: string;
  commitments: readonly ChildCommitment[];
  shifts: readonly Shift[];
  closures: readonly HouseholdClosure[];
}): UncoveredWeekResult {
  const needWindows = args.commitments.map(toNeedWindow);
  const byDay: Record<string, UncoveredWindow[]> = {};
  let totalCount = 0;

  for (const localDate of args.weekDates) {
    const dayClosures = closuresForLocalDate(
      args.closures,
      localDate,
      args.timezone
    );
    const dayShifts = args.shifts
      .filter(shift => shift.local_date === localDate)
      .map(toCoveredShift);
    const windows = computeUncovered({
      localDate,
      timezone: args.timezone,
      needWindows,
      shifts: dayShifts,
      closures: dayClosures,
    });
    byDay[localDate] = windows;
    totalCount += windows.length;
  }

  return { byDay, totalCount };
}
