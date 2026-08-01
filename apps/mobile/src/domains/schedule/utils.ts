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

interface AvailabilityRow {
  weekday: number;
  is_available: boolean;
  earliest_start: string;
  latest_finish: string;
}

/**
 * True when a proposed pattern day falls outside the carer's marked
 * availability for that weekday — including when there's no availability
 * row at all, or the whole day is marked unavailable. Per the product spec
 * this is a WARNING, never a block: `StatusPill variant="outside-hours"`,
 * and accepting must remain possible.
 */
export function isOutsideAvailability(
  day: ProposedDay,
  availability: AvailabilityRow[]
): boolean {
  const row = availability.find(a => a.weekday === day.weekday);
  if (!row?.is_available) return true;
  return (
    day.start_time < row.earliest_start || day.end_time > row.latest_finish
  );
}

/** Formats a Date as a "YYYY-MM-DD" calendar date (local components, no TZ math). */
export function todayIsoDate(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
