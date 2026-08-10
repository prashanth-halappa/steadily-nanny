/**
 * @module domains/schedule/utils/uncoveredDisplay
 *
 * Display helpers for live uncovered-care UI — cause inference, all-day
 * detection, and deterministic copy rotation. Interval maths stay in
 * shared-types; this is presentation-only.
 */

import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';

export type UncoveredCause =
  | 'cancelled'
  | 'declined'
  | 'needsAdded'
  | 'closureRemoved'
  | 'nothingScheduled';

export interface UncoveredWindowDisplay extends UncoveredWindow {
  cause: UncoveredCause;
}

function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function shiftCoversChild(shift: Shift, childId: string): boolean {
  const children = shift.shift_children ?? [];
  if (children.length === 0) {
    return true;
  }
  return children.some(child => child.child_id === childId);
}

function overlappingShifts(
  window: UncoveredWindow,
  shifts: readonly Shift[]
): Shift[] {
  const winStart = Date.parse(window.startsAt);
  const winEnd = Date.parse(window.endsAt);
  return shifts.filter(shift => {
    if (!shiftCoversChild(shift, window.childId)) {
      return false;
    }
    return intervalsOverlap(
      winStart,
      winEnd,
      Date.parse(shift.starts_at),
      Date.parse(shift.ends_at)
    );
  });
}

/** Best-effort cause from current shift rows (live computation has no event history). */
export function inferUncoveredCauseDetail(
  window: UncoveredWindow,
  shifts: readonly Shift[]
): { cause: UncoveredCause; shift: Shift | null } {
  const overlapping = overlappingShifts(window, shifts);
  const cancelled = overlapping.find(shift => shift.status === 'cancelled');
  if (cancelled) {
    return { cause: 'cancelled', shift: cancelled };
  }
  const declined = overlapping.find(shift => shift.status === 'declined');
  if (declined) {
    return { cause: 'declined', shift: declined };
  }
  return { cause: 'nothingScheduled', shift: null };
}

export function inferUncoveredCause(
  window: UncoveredWindow,
  shifts: readonly Shift[]
): UncoveredCause {
  return inferUncoveredCauseDetail(window, shifts).cause;
}

/**
 * The gap's reason, naming the person when there is one to name.
 *
 * The times come from the SHIFT, never from the uncovered window — the named
 * sentence reads "{carer}'s {start} – {end} shift was cancelled", so feeding it
 * the window would describe a 09:00–17:00 shift as a "09:00–11:22 shift"
 * whenever cover partially survived. Callers used to pass the window's times
 * and got exactly that wrong sentence, so the formatting now lives in here
 * where it cannot be mismatched.
 */
export function describeUncoveredCause(args: {
  cause: UncoveredCause;
  shift: Shift | null;
  carerName: string | null;
  timeZone: string;
  t: (key: string, vars?: Record<string, unknown>) => string;
}): string {
  const { cause, shift, carerName, timeZone, t } = args;
  if (shift && carerName && (cause === 'cancelled' || cause === 'declined')) {
    return t(`cover.causeNamed.${cause}`, {
      carerName,
      start: formatClockTime(shift.starts_at, timeZone),
      end: formatClockTime(shift.ends_at, timeZone),
    });
  }
  return t(`cover.cause.${cause}`);
}

/** Whether the uncovered slice spans the full need window for display as "all day". */
export function isFullDayUncovered(
  window: UncoveredWindow,
  needStartUtc: number,
  needEndUtc: number
): boolean {
  const winStart = Date.parse(window.startsAt);
  const winEnd = Date.parse(window.endsAt);
  return winStart <= needStartUtc + 60_000 && winEnd >= needEndUtc - 60_000;
}

export function withCauses(
  windows: readonly UncoveredWindow[],
  shifts: readonly Shift[]
): UncoveredWindowDisplay[] {
  return windows.map(window => ({
    ...window,
    cause: inferUncoveredCause(window, shifts),
  }));
}
