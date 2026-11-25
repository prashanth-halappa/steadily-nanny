/**
 * @module domains/schedule/utils/uncoveredDisplay
 *
 * Display helpers for live uncovered-care UI — cause inference, all-day
 * detection, and deterministic copy rotation. Interval maths stay in
 * shared-types; this is presentation-only.
 */

import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type {
  Shift,
  ShiftEvent,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  type CoveredShiftInput,
  computeUncovered,
  type UncoveredWindow,
} from '@steadily-nanny/shared-types/uncoveredCare';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { localDateInZone } from '@/src/lib/localDate';
import { localDateToWeekday } from './shiftGrouping';
import {
  closuresForLocalDate,
  toCoveredShift,
  toNeedWindow,
  zonedWallTimeToUtcMillis,
} from './uncoveredWeek';

export type UncoveredCause =
  | 'cancelled'
  | 'declined'
  | 'needsAdded'
  | 'closureRemoved'
  | 'nothingScheduled';

/** Runtime guard for the union above — `payload.cause` arrives as `unknown`. */
const UNCOVERED_CAUSES: ReadonlySet<string> = new Set<UncoveredCause>([
  'cancelled',
  'declined',
  'needsAdded',
  'closureRemoved',
  'nothingScheduled',
]);

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

/**
 * The cause the API actually recorded, from the day thread's `uncovered_care`
 * rows (P3). `closureRemoved` and `needsAdded` are UNREACHABLE by inference —
 * no shift row remembers that a parent deleted an away-day or widened care
 * hours — so without this the app told a parent "nobody's booked yet" in the
 * one place it had a specific answer to give.
 *
 * Matched on child + commitment + overlap rather than on the exact
 * `payload.key`: the stored window is whatever was uncovered WHEN it was
 * raised, and a later partial cover narrows the live window without changing
 * why the gap opened. Most recent matching row wins. Every field is validated
 * — `payload` is `Record<string, unknown>` on the wire.
 */
function serverUncoveredCause(
  window: UncoveredWindow,
  events: readonly ShiftEvent[]
): UncoveredCause | null {
  const winStart = Date.parse(window.startsAt);
  const winEnd = Date.parse(window.endsAt);
  const matches = events.filter(event => {
    if (event.event_type !== 'uncovered_care') return false;
    const payload = event.payload ?? {};
    if (payload.child_id !== window.childId) return false;
    if (payload.commitment_id !== window.commitmentId) return false;
    if (typeof payload.cause !== 'string') return false;
    if (!UNCOVERED_CAUSES.has(payload.cause)) return false;
    const start = Date.parse(String(payload.starts_at));
    const end = Date.parse(String(payload.ends_at));
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return intervalsOverlap(winStart, winEnd, start, end);
  });
  const latest = [...matches].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
  )[0];
  return latest ? (latest.payload.cause as UncoveredCause) : null;
}

/**
 * Best-effort cause. A cancelled/declined shift still wins: it is the fresher
 * fact (the day thread's row is the ORIGINAL cause, kept idempotent) and it
 * carries a name and times the server row does not. `events` only fills the
 * hole underneath — pass the day thread where it is already loaded.
 */
export function inferUncoveredCauseDetail(
  window: UncoveredWindow,
  shifts: readonly Shift[],
  events: readonly ShiftEvent[] = []
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
  return {
    cause: serverUncoveredCause(window, events) ?? 'nothingScheduled',
    shift: null,
  };
}

export function inferUncoveredCause(
  window: UncoveredWindow,
  shifts: readonly Shift[],
  events: readonly ShiftEvent[] = []
): UncoveredCause {
  return inferUncoveredCauseDetail(window, shifts, events).cause;
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

// =============================================================================
// Awaiting an answer — display-only split. `computeUncovered` deliberately
// treats `pending` as NOT cover (S1: an unanswered ask must never silence the
// server alarm), but on screen a window the parent has already asked about is
// "Pending", not "Not booked yet". The server push/digest are untouched.
// =============================================================================

/** The slice of a pending `SchedulePatternWithDays` the split reads. */
export interface AwaitingPattern {
  dtstart: string;
  until: string | null;
  timezone: string;
  days: ReadonlyArray<{
    weekday: number;
    start_time: string;
    end_time: string;
    children: ReadonlyArray<{
      child_id: string;
      start_time: string | null;
      end_time: string | null;
    }>;
  }>;
}

/** One pending-pattern block on one date, flattened per child (null = all). */
interface PatternBlock {
  childId: string | null;
  startMs: number;
  endMs: number;
}

function patternBlocksOnDate(
  pattern: AwaitingPattern | null,
  localDate: string
): PatternBlock[] {
  if (!pattern) return [];
  if (localDate < pattern.dtstart) return [];
  if (pattern.until && localDate > pattern.until) return [];
  const weekday = localDateToWeekday(localDate);
  const at = (time: string) =>
    zonedWallTimeToUtcMillis(localDate, time, pattern.timezone);
  // ponytail: honours weekday + dtstart/until only, not INTERVAL/exdates/
  // pause_ranges — an over-match just says Pending a little early on a
  // fortnightly or paused week; mirror materialisation if that matters.
  return pattern.days
    .filter(day => day.weekday === weekday)
    .flatMap((day): PatternBlock[] =>
      day.children.length === 0
        ? [
            {
              childId: null,
              startMs: at(day.start_time),
              endMs: at(day.end_time),
            },
          ]
        : day.children.map(child => ({
            childId: child.child_id,
            startMs: at(child.start_time ?? day.start_time),
            endMs: at(child.end_time ?? day.end_time),
          }))
    );
}

/**
 * Splits one local day's uncovered care at the INTERVAL level:
 * - `unbooked` — `computeUncovered` re-run with every pending shift and
 *   pending-pattern block treated as cover, so only the never-asked-about
 *   residual pieces remain (partial overlaps leave the edges unbooked).
 * - `awaiting` — the S1 `windows` clipped to each pending-pattern block.
 *   A pending SHIFT emits no awaiting piece: its own row/cell already says
 *   Pending.
 * `windows` are the day's S1 windows (pending is not cover); the server alarm
 * never sees this split.
 */
export function splitAwaiting(args: {
  windows: readonly UncoveredWindow[];
  localDate: string;
  timezone: string;
  commitments: readonly ChildCommitment[];
  /** That day's shifts (same `local_date` filter `computeUncoveredWeek` uses). */
  shifts: readonly Shift[];
  closures: readonly HouseholdClosure[];
  pendingPattern: AwaitingPattern | null;
}): { unbooked: UncoveredWindow[]; awaiting: UncoveredWindow[] } {
  const blocks = patternBlocksOnDate(args.pendingPattern, args.localDate);
  const pendingShifts = args.shifts.filter(s => s.status === 'pending');
  if (blocks.length === 0 && pendingShifts.length === 0) {
    return { unbooked: [...args.windows], awaiting: [] };
  }

  // Display-side copy only: pending counts as cover for THIS run.
  const displayCover: CoveredShiftInput[] = [
    ...args.shifts.map(shift =>
      toCoveredShift(
        shift.status === 'pending' ? { ...shift, status: 'confirmed' } : shift
      )
    ),
    ...blocks.map((block, i) => ({
      id: `pending-pattern-block-${i}`,
      startsAt: new Date(block.startMs).toISOString(),
      endsAt: new Date(block.endMs).toISOString(),
      status: 'confirmed',
      children: block.childId
        ? [{ childId: block.childId, startsAt: null, endsAt: null }]
        : [],
    })),
  ];
  const unbooked = computeUncovered({
    localDate: args.localDate,
    timezone: args.timezone,
    needWindows: args.commitments.map(toNeedWindow),
    shifts: displayCover,
    closures: closuresForLocalDate(
      args.closures,
      args.localDate,
      args.timezone
    ),
  });

  const awaiting: UncoveredWindow[] = [];
  for (const window of args.windows) {
    const winStart = Date.parse(window.startsAt);
    const winEnd = Date.parse(window.endsAt);
    for (const block of blocks) {
      if (block.childId !== null && block.childId !== window.childId) continue;
      const start = Math.max(winStart, block.startMs);
      const end = Math.min(winEnd, block.endMs);
      if (start < end) {
        awaiting.push({
          ...window,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
        });
      }
    }
  }
  return { unbooked, awaiting };
}

export function withCauses(
  windows: readonly UncoveredWindow[],
  shifts: readonly Shift[],
  events: readonly ShiftEvent[] = []
): UncoveredWindowDisplay[] {
  return windows.map(window => ({
    ...window,
    cause: inferUncoveredCause(window, shifts, events),
  }));
}
