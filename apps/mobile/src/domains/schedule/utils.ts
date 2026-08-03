/**
 * @module domains/schedule/utils
 *
 * Pure, dependency-free helpers for the schedule domain: RRULE construction
 * from selected days, hours-total math, and the availability-clash check
 * used by the nanny's respond screen. Kept dependency-free (no
 * react-native/react-query) so they're directly unit-testable.
 *
 * WEEKDAY CONVENTION: every `weekday` here is the Postgres `extract(dow)`
 * index (0=Sunday..6=Saturday) — the same convention `WeekStrip.onToggle`
 * reports and the API expects. Never re-derive it from display order.
 */

import { formatNominalWallClockDisplay } from '@/src/lib/wallClock';

/**
 * Adds/removes a Postgres-dow weekday from a selection, keeping it sorted
 * numerically (0=Sunday first). Used by WeekStrip's `onToggle` handler —
 * WeekStrip already reports the raw dow index, so this never re-derives one
 * from display position.
 */
export function toggleWeekday(selected: number[], day: number): number[] {
  const next = selected.includes(day)
    ? selected.filter(d => d !== day)
    : [...selected, day];
  return next.sort((a, b) => a - b);
}

/** Postgres `extract(dow)` index -> iCalendar RRULE BYDAY code, in week order. */
const DOW_TO_BYDAY: Record<number, string> = {
  0: 'SU',
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
};

/**
 * Builds a weekly RRULE string from selected Postgres-dow weekdays.
 * `intervalWeeks` is 1 for "every week", 2 for "every other week". BYDAY is
 * always emitted in week order (Sun..Sat), independent of selection order.
 */
export function buildWeeklyRrule(
  weekdays: number[],
  intervalWeeks: 1 | 2
): string {
  const byDay = [...weekdays]
    .sort((a, b) => a - b)
    .map(day => DOW_TO_BYDAY[day])
    .join(',');
  return `FREQ=WEEKLY;INTERVAL=${intervalWeeks};BYDAY=${byDay}`;
}

/** Parses a nominal "HH:MM" string into total minutes since midnight. */
function toMinutes(time: string): number {
  const [hoursPart, minutesPart] = time.split(':');
  return Number(hoursPart ?? 0) * 60 + Number(minutesPart ?? 0);
}

/**
 * Formats a nominal wall-clock time from the wire (`09:00:00` or `09:00`)
 * using the device locale's 12h/24h preference. Pass `locale` in tests.
 */
export function formatWallClockTime(time: string, locale?: string): string {
  return formatNominalWallClockDisplay(time, locale);
}

/** Hours between two nominal "HH:MM" wall-clock times (end must be after start). */
export function calculateDayHours(start: string, end: string): number {
  return (toMinutes(end) - toMinutes(start)) / 60;
}

interface DayHoursRange {
  start_time: string;
  end_time: string;
}

/** Sums `calculateDayHours` across every day in a proposed week. */
export function calculateWeekTotalHours(days: DayHoursRange[]): number {
  return days.reduce(
    (total, day) => total + calculateDayHours(day.start_time, day.end_time),
    0
  );
}

interface ProposedDay {
  weekday: number;
  start_time: string;
  end_time: string;
}

/**
 * Matches the shared `CarerAvailability` wire type
 * (`@steadily-nanny/shared-types/schemas/availability.schema`): a carer can
 * be marked available for a weekday with no hours set yet, so both bounds
 * are nullable — never narrowed to `string` at the call site.
 */
export interface AvailabilityRow {
  weekday: number;
  is_available: boolean;
  earliest_start: string | null;
  latest_finish: string | null;
}

/**
 * True when a proposed pattern day falls outside the carer's marked
 * availability for that weekday — including when there's no availability
 * row at all, or the whole day is marked unavailable. Per the product spec
 * this is a WARNING, never a block: `StatusPill variant="outside-hours"`,
 * and accepting must remain possible.
 *
 * A `null` bound means "no constraint on that side" (available, but no
 * specific hours set) — it must NOT be treated as a clash by itself, only a
 * REAL bound the proposed time falls outside of counts.
 */
export function isOutsideAvailability(
  day: ProposedDay,
  availability: AvailabilityRow[]
): boolean {
  const row = availability.find(a => a.weekday === day.weekday);
  if (!row?.is_available) return true;

  const start = timeToMinutes(day.start_time);
  const end = timeToMinutes(day.end_time);
  const earliest =
    row.earliest_start === null ? null : timeToMinutes(row.earliest_start);
  const latest =
    row.latest_finish === null ? null : timeToMinutes(row.latest_finish);

  const beforeEarliestStart =
    earliest !== null && start !== null && start < earliest;
  const afterLatestFinish = latest !== null && end !== null && end > latest;
  return beforeEarliestStart || afterLatestFinish;
}

/**
 * "HH:MM" or "HH:MM:SS" -> minutes since midnight. Null for anything
 * unparseable, so a malformed value can never silently read as 00:00.
 *
 * These times MUST be compared numerically, never as strings. Postgres `time`
 * columns come back as "09:00:00" while the picker emits "09:00", and
 * `'09:00' < '09:00:00'` is TRUE in string comparison — the shorter string
 * sorts first. That made a shift proposed at exactly the carer's stated start
 * time read as "before" it, so "your usual 9-5" — the most ordinary proposal
 * there is — was wrongly flagged as outside their availability. Only the start
 * misfired, because at the other end `'17:00' > '17:00:00'` is false, which is
 * what made it look like an inclusive/exclusive boundary bug rather than a
 * format mismatch.
 */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Parses the `INTERVAL=` component of a weekly RRULE built by `buildWeeklyRrule` — the inverse of that function's `intervalWeeks` argument. Defaults to 1 (every week) for anything else, so a malformed or missing INTERVAL never reads as fortnightly. */
export function parseWeeklyRruleInterval(rrule: string): 1 | 2 {
  return /(?:^|;)INTERVAL=2(?:;|$)/.test(rrule) ? 2 : 1;
}

export interface DraftPatternDayForHydration {
  weekday: number;
  start_time: string;
  end_time: string;
  children: { child_id: string }[];
}

/** The subset of `SchedulePatternWithDays` (`api/endpoints/schedulePatterns.ts`) resuming a draft needs — kept minimal and dependency-free rather than importing the full wire type into this pure-utils module. */
export interface DraftPatternForHydration {
  carer_id: string | null;
  rrule: string;
  days: DraftPatternDayForHydration[];
}

export interface HydratedDraftState {
  carerId: string | null;
  selectedDays: number[];
  dayTimes: Record<number, { start: string; end: string }>;
  dayChildren: Record<number, string[]>;
  intervalWeeks: 1 | 2;
}

/**
 * Derives ScheduleBuildScreen's local wizard state (carer, selected days,
 * per-day times/children, repeat interval) from an existing DRAFT pattern's
 * already-saved days. Used to resume a draft — see SchedulePendingScreen's
 * "Continue building" CTA, which now passes `?patternId=` — rather than
 * starting the wizard from scratch, which used to both discard the parent's
 * prior progress AND (via `sendScheduleWeek`'s `!patternId` branch) create
 * a SECOND, orphaned draft pattern on send.
 */
export function hydrateDraftPattern(
  pattern: DraftPatternForHydration
): HydratedDraftState {
  const selectedDays = pattern.days
    .map(day => day.weekday)
    .sort((a, b) => a - b);
  const dayTimes: Record<number, { start: string; end: string }> = {};
  const dayChildren: Record<number, string[]> = {};
  for (const day of pattern.days) {
    dayTimes[day.weekday] = { start: day.start_time, end: day.end_time };
    dayChildren[day.weekday] = day.children.map(child => child.child_id);
  }
  return {
    carerId: pattern.carer_id,
    selectedDays,
    dayTimes,
    dayChildren,
    intervalWeeks: parseWeeklyRruleInterval(pattern.rrule),
  };
}

/** Formats a Date as a "YYYY-MM-DD" calendar date (local components, no TZ math). */
export function todayIsoDate(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface SendDayInput {
  weekday: number;
  start_time: string;
  end_time: string;
  children: { child_id: string }[];
}

interface SendScheduleWeekArgs {
  /** Existing draft pattern id, if the build screen already created one on
   * an earlier pass (e.g. retrying after a failed send). */
  patternId: string | undefined;
  carerId: string;
  rrule: string;
  dtstart: string;
  days: SendDayInput[];
  createPattern: (input: {
    carer_id: string;
    rrule: string;
    dtstart: string;
  }) => Promise<{ id: string }>;
  replaceDays: (args: {
    patternId: string;
    days: SendDayInput[];
  }) => Promise<unknown>;
  sendPattern: (args: { patternId: string }) => Promise<unknown>;
  /**
   * D11: invoked the INSTANT a new pattern's id is known — before
   * `replaceDays`/`sendPattern` run — so the caller can persist it
   * immediately, even if a later step then fails. Without this, a partial
   * failure (creation succeeds, `replaceDays` or `sendPattern` doesn't)
   * left the created id trapped inside this function: the caller's own
   * `patternId` state never learned it, so a retry called `createPattern`
   * again and littered the household with orphaned drafts. Never called
   * when an existing `patternId` was passed in (nothing new was created).
   */
  onPatternCreated?: (patternId: string) => void;
}

/**
 * Orchestrates the build screen's "Send" action: create the draft pattern
 * (if one doesn't already exist), replace its days, then send it — in that
 * order, always passing the SAME locally-resolved id to every step.
 *
 * This is deliberately a plain async function, not a React hook, so the
 * pattern id can never go stale: `setPatternId(created.id)` inside a
 * component is an ASYNC state update that does not rebind a
 * `useMutation(patternId)` hook parameter within the same handler pass — a
 * mutation hook bound to `patternId` as a render-time parameter would still
 * be closed over the value from BEFORE this function ran, sending
 * `undefined` to `PUT /schedule-patterns/undefined/days`. Here, `patternId`
 * is a local variable resolved synchronously in one call stack and threaded
 * explicitly into every dependent call — see `../__tests__/utils.test.ts`'s
 * regression test.
 *
 * `onPatternCreated` (see its own doc comment) is the D11 half of this: it
 * fires the moment creation succeeds, BEFORE the two calls that can still
 * fail, specifically so a caller storing the id in React state (via a
 * stable `setState` dispatch — never itself subject to the staleness this
 * function exists to avoid) doesn't lose track of a pattern it already paid
 * to create if the rest of this function subsequently throws.
 */
export async function sendScheduleWeek(
  args: SendScheduleWeekArgs
): Promise<string> {
  let patternId = args.patternId;
  if (!patternId) {
    const created = await args.createPattern({
      carer_id: args.carerId,
      rrule: args.rrule,
      dtstart: args.dtstart,
    });
    patternId = created.id;
    args.onPatternCreated?.(patternId);
  }

  await args.replaceDays({ patternId, days: args.days });
  await args.sendPattern({ patternId });

  return patternId;
}
