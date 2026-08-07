/**
 * @module domains/timeOff/utils/timeOffDate
 *
 * Pure date helpers for the time-off request flow. `carer_time_off` has no
 * household — it's scoped to the carer alone (`GET /time-off` filters by
 * `user_id`, not any household id) — so unlike `domains/timesheet/utils/week.ts`
 * there is no household timezone to resolve against. These functions use the
 * DEVICE's local calendar date throughout (construction via the `Date`
 * constructor's numeric-argument form, and reading back via the local
 * getters), never a UTC truncation or a raw string-parsed instant, so a
 * request always means "the days the carer selected on their own calendar",
 * consistently in both directions.
 *
 * ALL-DAY CONVENTION (a judgement call, not dictated by the API — the DB
 * only enforces `ends_at > starts_at`): `starts_at` is local midnight of the
 * selected start date; `ends_at` is local midnight of the day AFTER the
 * selected end date — an EXCLUSIVE end, same convention as
 * `weekEndExclusive` on the API side (`apps/api/src/domains/timesheet/utils/weekStart.ts`)
 * and `getWeekDates`'s Monday..Sunday span on the mobile side. A single-day
 * request (start === end) therefore still produces `ends_at > starts_at`,
 * satisfying `CreateCarerTimeOffSchema`'s refinement by construction.
 */

/** True when the exclusive `ends_at` instant is already at or before now. */
export function isPastTimeOff(endsAt: string, nowMs = Date.now()): boolean {
  return Date.parse(endsAt) <= nowMs;
}

/**
 * Today's calendar date, "yyyy-mm-dd", in the DEVICE's local zone —
 * `injectedNow` lets tests pin a specific instant instead of mocking `Date`.
 * Used by the sick-day quick action (068) to build a same-day
 * `toAllDayRange(today, today)` request; same local-getter discipline as
 * every other function in this module (never a UTC truncation).
 */
export function todayISO(injectedNow: Date = new Date()): string {
  const y = injectedNow.getFullYear();
  const m = String(injectedNow.getMonth() + 1).padStart(2, '0');
  const d = String(injectedNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Nominal "yyyy-mm-dd" calendar dates -> the wire `{ starts_at, ends_at }` pair. */
export function toAllDayRange(
  startDateISO: string,
  endDateISO: string
): { starts_at: string; ends_at: string } {
  const [sy, sm, sd] = startDateISO.split('-').map(Number);
  const [ey, em, ed] = endDateISO.split('-').map(Number);
  const start = new Date(sy ?? 0, (sm ?? 1) - 1, sd ?? 1, 0, 0, 0, 0);
  // Exclusive end: local midnight one calendar day after the selected end
  // date. `Date` normalizes the day-of-month overflow (e.g. day 32 rolls
  // into the next month) so this works across month/year boundaries too.
  const end = new Date(ey ?? 0, (em ?? 1) - 1, (ed ?? 1) + 1, 0, 0, 0, 0);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

function toLocalDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Inverse of `toAllDayRange` — wire pair back to local calendar pickers. */
export function fromAllDayRange(
  startsAt: string,
  endsAt: string
): { startDate: string; endDate: string } {
  const start = new Date(startsAt);
  const inclusiveEnd = new Date(endsAt);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return {
    startDate: toLocalDateISO(start),
    endDate: toLocalDateISO(inclusiveEnd),
  };
}

const WEEKDAY_ABBREVIATIONS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

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

/** "Mon 4 Aug" — en-GB abbreviated weekday, day, month, in the DEVICE's local zone. */
function formatDayLabel(date: Date): string {
  const weekday = WEEKDAY_ABBREVIATIONS[date.getDay()] ?? '';
  const month = MONTH_ABBREVIATIONS[date.getMonth()] ?? '';
  return `${weekday} ${date.getDate()} ${month}`;
}

/**
 * "Mon 4 Aug – Wed 6 Aug" from the wire `starts_at`/`ends_at` pair, or just
 * "Mon 4 Aug" for a single-day request. `ends_at` is EXCLUSIVE (see the
 * module header) so the last actual day off is one calendar day before it —
 * this function undoes that offset before formatting, so the label always
 * shows the days the carer actually asked for, never the exclusive boundary.
 */
export function formatTimeOffRangeLabel(
  startsAt: string,
  endsAt: string
): string {
  const start = new Date(startsAt);
  const inclusiveEnd = new Date(endsAt);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);

  const startLabel = formatDayLabel(start);
  if (start.toDateString() === inclusiveEnd.toDateString()) {
    return startLabel;
  }
  return `${startLabel} – ${formatDayLabel(inclusiveEnd)}`;
}
