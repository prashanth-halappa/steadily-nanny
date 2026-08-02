/**
 * Monday-start week helpers. en-GB weeks start Monday, and `week_start` on
 * `timesheets` (supabase/migrations/017_time_tracking.sql) means "Monday, in
 * the household's timezone" — NOT Monday in UTC. Get this wrong and every
 * weekly total is misfiled: a clock-out at 23:30 UTC on a Sunday can already
 * be Monday morning in a household east of UTC, or a clock-out at 01:30 UTC
 * on a Monday can still be Sunday night in a household west of UTC.
 *
 * Dependency-free — uses only `Intl.DateTimeFormat`, matching the convention
 * in `utils/dateUtils.ts` and `domains/schedule/services/recurrenceExpander.ts`
 * (no date library in this codebase).
 *
 * @module domains/timesheet/utils/weekStart
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseDateOnly(dateStr: string): CalendarDate {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

/** Pure calendar-date arithmetic — always UTC-anchored midnight, never a real instant. */
function toEpochDay(date: CalendarDate): number {
  return Date.UTC(date.y, date.m - 1, date.d);
}

/** 0 = Sunday .. 6 = Saturday. */
function weekdayOf(epochMillis: number): number {
  return new Date(epochMillis).getUTCDay();
}

function formatDateOnly(epochMillis: number): string {
  const dt = new Date(epochMillis);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The `YYYY-MM-DD` calendar date `instant` falls on, in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, so no field-reassembly is needed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Monday, in `timeZone`, of the week containing `instant` — the value that
 * belongs in `timesheets.week_start`.
 */
export function weekStartOf(instant: Date, timeZone: string): string {
  const epoch = toEpochDay(parseDateOnly(localDateOf(instant, timeZone)));
  const dow = weekdayOf(epoch); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0,...,Sun=6
  return formatDateOnly(epoch - daysSinceMonday * MS_PER_DAY);
}

const DAYS_PER_WEEK = 7;

/** The exclusive end ('YYYY-MM-DD') of the week starting `weekStart` — i.e. `weekStart + 7 days`. Pure date arithmetic; `weekStart` need not actually be a Monday. */
export function weekEndExclusive(weekStart: string): string {
  const epoch = toEpochDay(parseDateOnly(weekStart));
  return formatDateOnly(epoch + DAYS_PER_WEEK * MS_PER_DAY);
}
