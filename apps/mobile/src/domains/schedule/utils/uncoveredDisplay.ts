/**
 * @module domains/schedule/utils/uncoveredDisplay
 *
 * Display helpers for live uncovered-care UI — cause inference, all-day
 * detection, and deterministic copy rotation. Interval maths stay in
 * shared-types; this is presentation-only.
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';

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

/** Best-effort cause from current shift rows (live computation has no event history). */
export function inferUncoveredCause(
  window: UncoveredWindow,
  shifts: readonly Shift[]
): UncoveredCause {
  const winStart = Date.parse(window.startsAt);
  const winEnd = Date.parse(window.endsAt);
  const overlapping = shifts.filter(shift => {
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
  if (overlapping.some(shift => shift.status === 'cancelled')) {
    return 'cancelled';
  }
  if (overlapping.some(shift => shift.status === 'declined')) {
    return 'declined';
  }
  return 'nothingScheduled';
}

/** Stable non-negative hash for deterministic daily copy rotation. */
export function hashLocalDate(localDate: string): number {
  let hash = 0;
  for (let i = 0; i < localDate.length; i++) {
    hash = (hash * 31 + localDate.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function coveredVariantIndex(localDate: string): number {
  return hashLocalDate(localDate) % 4;
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
