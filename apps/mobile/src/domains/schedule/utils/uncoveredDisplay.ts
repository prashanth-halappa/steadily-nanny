/**
 * @module domains/schedule/utils/uncoveredDisplay
 *
 * Display helpers for live uncovered-care UI — cause inference, all-day
 * detection, and deterministic copy rotation. Interval maths stay in
 * shared-types; this is presentation-only.
 */

import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { localDateInZone } from '@/src/lib/localDate';
import { localDateToWeekday } from './shiftGrouping';

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

export function overlappingShifts(
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

// =============================================================================
// Cover-ask lifecycle overlay (§2.4a / §5.1) — a SEPARATE fact from the gap's
// original cause above. The original cause answers "why did this window open
// up"; this answers "what has the parent already done about it". Both can be
// true of the same window at once (a shift was cancelled, AND the parent has
// since asked someone to cover it).
// =============================================================================

export type AskState = 'pending' | 'declined' | 'expired';

export interface AskStateDetail {
  state: AskState;
  shift: Shift;
}

/**
 * The most-recently-created outstanding cover-ask overlapping `window`, or
 * `null` when there is none to show. D-48 keeps at most one open ask per
 * window in practice, so "most recent" is a tie-break that should rarely
 * matter rather than the primary selection rule.
 *
 * `withdrawn` (cancelled WITH `cancelled_by` set) is deliberately excluded —
 * §5.3's table has the gap return to its plain "none asked" row on a
 * withdrawal, so it falls through here exactly as if no ask had been made.
 * `expired` is DERIVED (cancelled_by null + expiry in the past) — never a
 * wire status of its own.
 */
export function inferAskState(
  window: UncoveredWindow,
  shifts: readonly Shift[],
  nowMs: number
): AskStateDetail | null {
  const asks = overlappingShifts(window, shifts).filter(
    shift =>
      shift.carer_id !== null &&
      (shift.kind === SHIFT_KINDS.EXTRA || shift.kind === SHIFT_KINDS.COVER)
  );
  const latest = [...asks].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
  )[0];
  if (!latest) return null;
  if (latest.status === 'pending') return { state: 'pending', shift: latest };
  if (latest.status === 'declined') {
    return { state: 'declined', shift: latest };
  }
  if (
    latest.status === 'cancelled' &&
    latest.cancelled_by === null &&
    latest.cover_ask_expires_at &&
    Date.parse(latest.cover_ask_expires_at) <= nowMs
  ) {
    return { state: 'expired', shift: latest };
  }
  return null;
}

/**
 * The gap card's cause line while a cover-ask is in flight (§2.4a). Reads the
 * WINDOW's own hours, not the ask shift's — this sentence says the WINDOW is
 * still uncovered, unlike `describeUncoveredCause` which describes a shift.
 *
 * M15: sentence order is load-bearing. Every line leads with the window; the
 * carer's name appears only in the second clause, and never as the subject of
 * a verdict ("can't cover this one", never "declined"/"unavailable").
 *
 * `carerName` is required (not nullable like `describeUncoveredCause`'s):
 * `inferAskState` only ever returns a shift with `carer_id` set, and every
 * caller resolves it through `resolveCarerName`'s guaranteed-string fallback
 * — there is no "no one to name" case here the way there is for the original
 * cause (which can point at an unassigned shift).
 */
export function describeAskCause(args: {
  state: AskState;
  window: UncoveredWindow;
  shift: Shift;
  carerName: string;
  timeZone: string;
  t: (key: string, vars?: Record<string, unknown>) => string;
}): string {
  const { state, window, shift, carerName, timeZone, t } = args;
  const start = formatClockTime(window.startsAt, timeZone);
  const end = formatClockTime(window.endsAt, timeZone);
  if (state === 'expired' && shift.cover_ask_expires_at) {
    const expiredDay = weekdayName(shift.cover_ask_expires_at, timeZone, t);
    return t('cover.causeAsk.expired', { start, end, carerName, expiredDay });
  }
  if (state === 'pending') {
    const askedDay = weekdayName(shift.created_at, timeZone, t);
    return t('cover.causeAsk.pending', { start, end, carerName, askedDay });
  }
  return t('cover.causeAsk.declined', { start, end, carerName });
}

/** Local weekday name for an instant, via the same `weekday.N` keys `TodayCoverage` already uses. */
function weekdayName(
  instant: string,
  timeZone: string,
  t: (key: string, vars?: Record<string, unknown>) => string
): string {
  const localDate = localDateInZone(timeZone, new Date(instant));
  return t(`weekday.${localDateToWeekday(localDate)}`);
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
