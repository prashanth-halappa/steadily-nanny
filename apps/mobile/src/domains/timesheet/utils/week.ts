/**
 * @module domains/timesheet/utils/week
 * Monday-first week math (en-GB weeks start Monday), matching the DB's
 * `timesheets.week_start` convention (`supabase/migrations/017_time_tracking.sql`).
 *
 * TIMEZONE: which week "today" belongs to is a HOUSEHOLD-timezone question,
 * not a device-timezone one — two people opening the app in different
 * zones must agree on the current week for the same household (a nanny
 * works across households; the household is the source of truth for its
 * own clock, exactly like `local_date`/`week_start` on the server are
 * trigger/service-derived in the household's zone, never the caller's).
 * `getWeekStartISO` therefore takes the household's IANA zone explicitly —
 * always pass `household.timezone` from `useHouseholds()`, never assume
 * the device's zone matches it. Same day-math bug class as GOLDEN-FIXES #21.
 *
 * Once a Monday is resolved, everything else here (`getWeekDates`,
 * `formatWeekRangeLabel`) is pure calendar-date arithmetic with no further
 * timezone involvement — a Monday is a Monday everywhere.
 */

const DAYS_IN_WEEK = 7;
// JS Date#getUTCDay(): 0=Sunday..6=Saturday. Days to subtract to reach Monday.
const DAYS_SINCE_MONDAY = [6, 0, 1, 2, 3, 4, 5] as const;

function toISODateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today's calendar date (`yyyy-mm-dd`) as seen in `timeZone` — NOT the
 * device's local date, NOT a UTC truncation. `en-CA` is used only because
 * that locale happens to format dates as `yyyy-mm-dd` directly.
 */
function calendarDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * The Monday (`yyyy-mm-dd`) of the week containing a bare calendar date.
 * UTC-anchored so the arithmetic can't be perturbed by whatever timezone
 * the CODE happens to run in — `dateISO` already IS the answer to "what
 * date"; this step is pure day-of-week math, not another timezone
 * conversion.
 */
function mondayOf(dateISO: string): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const anchor = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const daysSinceMonday = DAYS_SINCE_MONDAY[anchor.getUTCDay()] ?? 0;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceMonday);
  return toISODateUTC(anchor);
}

/**
 * The Monday (`yyyy-mm-dd`) of the week containing `now`, resolved in
 * `timeZone` (an IANA zone, e.g. `household.timezone`). The SAME instant
 * can resolve to a different week in different zones near a day boundary —
 * that's the whole point of taking the zone explicitly rather than reading
 * the device's.
 */
export function getWeekStartISO(now: Date, timeZone: string): string {
  return mondayOf(calendarDateInZone(now, timeZone));
}

/**
 * Shifts a Monday-anchored ISO date by `delta` whole weeks (positive =
 * forward, negative = back). UTC-anchored, same as `mondayOf` — pure
 * calendar-date arithmetic, no timezone re-resolution once a Monday is
 * already in hand. Lets a caller track "which week" as a small integer
 * offset from the current week rather than an absolute date that has to be
 * reconciled against a moving "now".
 */
export function addWeeks(weekStartISO: string, delta: number): string {
  const [year, month, day] = weekStartISO.split('-').map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + delta * DAYS_IN_WEEK)
  );
  return toISODateUTC(shifted);
}

/** The 7 consecutive ISO dates (Monday..Sunday) making up the week starting `weekStartISO`. */
export function getWeekDates(weekStartISO: string): string[] {
  const [year, month, day] = weekStartISO.split('-').map(Number);
  const dates: string[] = [];
  for (let offset = 0; offset < DAYS_IN_WEEK; offset++) {
    const d = new Date(
      Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offset)
    );
    dates.push(toISODateUTC(d));
  }
  return dates;
}

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatDayMonth(dateISO: string): string {
  const [, month, day] = dateISO.split('-').map(Number);
  return `${day} ${MONTH_ABBREVIATIONS[(month ?? 1) - 1] ?? ''}`;
}

/** "27 Jul – 2 Aug" from a 7-date week array (see `getWeekDates`). */
export function formatWeekRangeLabel(weekDates: string[]): string {
  const start = weekDates[0];
  const end = weekDates[weekDates.length - 1];
  if (!start || !end) return '';
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}
