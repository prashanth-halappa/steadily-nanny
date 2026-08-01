/**
 * @module domains/timesheet/utils/week
 * Monday-first week math (en-GB weeks start Monday), matching the DB's
 * `timesheets.week_start` convention (`supabase/migrations/017_time_tracking.sql`).
 * All date math here is LOCAL-calendar-day, not UTC-day — see
 * GOLDEN-FIXES.md #21's day-math warning, which applies equally to week math.
 */

const DAYS_IN_WEEK = 7;
// JS Date#getDay(): 0=Sunday..6=Saturday. Days to subtract to reach Monday.
const DAYS_SINCE_MONDAY = [6, 0, 1, 2, 3, 4, 5] as const;

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The Monday (as an ISO `yyyy-mm-dd` string, local calendar day) of the week containing `date`. */
export function getWeekStartISO(date: Date): string {
  const daysSinceMonday = DAYS_SINCE_MONDAY[date.getDay()] ?? 0;
  const monday = new Date(date);
  monday.setDate(date.getDate() - daysSinceMonday);
  return toISODate(monday);
}

/** The 7 consecutive ISO dates (Monday..Sunday) making up the week starting `weekStartISO`. */
export function getWeekDates(weekStartISO: string): string[] {
  const [year, month, day] = weekStartISO.split('-').map(Number);
  const dates: string[] = [];
  for (let offset = 0; offset < DAYS_IN_WEEK; offset++) {
    const d = new Date(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offset);
    dates.push(toISODate(d));
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
