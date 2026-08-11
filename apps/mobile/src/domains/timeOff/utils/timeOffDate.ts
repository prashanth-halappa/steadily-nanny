/**
 * @module domains/timeOff/utils/timeOffDate
 *
 * Pure date helpers for the time-off request flow. `carer_time_off` has no
 * household column, but the API stores the client's `starts_at`/`ends_at`
 * instants verbatim and uses them for same-day-shift overlap scans — so
 * "today" and all-day brackets must resolve in the HOUSEHOLD's IANA zone
 * (the active household from `useActiveHousehold`), not the device's.
 * Same bug class as GOLDEN-FIXES #21 and `ClockInCard`'s `localDateInZone` +
 * `wallClockToUtcIso` day window: a carer in Asia/Kolkata calling in sick
 * while the family is on Europe/London must book the London calendar date.
 *
 * Pass `timeZone` from the active household wherever one exists; omit it
 * only when no household context is available (falls back to the device's
 * local calendar via numeric `Date` getters — never a UTC truncation).
 *
 * ALL-DAY CONVENTION (a judgement call, not dictated by the API — the DB
 * only enforces `ends_at > starts_at`): `starts_at` is local midnight of the
 * selected start date; `ends_at` is local midnight of the day AFTER the
 * selected end date — an EXCLUSIVE end, same convention as
 * `weekEndExclusive` on the API side (`apps/api/src/domains/timesheet/utils/weekStart.ts`)
 * and `getWeekDates`'s seven-day span on the mobile side. A single-day
 * request (start === end) therefore still produces `ends_at > starts_at`,
 * satisfying `CreateCarerTimeOffSchema`'s refinement by construction.
 */
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

/** True when the exclusive `ends_at` instant is already at or before now. */
export function isPastTimeOff(endsAt: string, nowMs = Date.now()): boolean {
  return Date.parse(endsAt) <= nowMs;
}

/**
 * Today's calendar date, "yyyy-mm-dd", in `timeZone` when provided, else the
 * DEVICE's local zone. `injectedNow` lets tests pin a specific instant.
 */
export function todayISO(
  injectedNow: Date = new Date(),
  timeZone?: string
): string {
  if (timeZone) {
    return localDateInZone(timeZone, injectedNow);
  }
  const y = injectedNow.getFullYear();
  const m = String(injectedNow.getMonth() + 1).padStart(2, '0');
  const d = String(injectedNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Nominal "yyyy-mm-dd" calendar dates -> the wire `{ starts_at, ends_at }` pair. */
export function toAllDayRange(
  startDateISO: string,
  endDateISO: string,
  timeZone?: string
): { starts_at: string; ends_at: string } {
  if (timeZone) {
    return {
      starts_at: wallClockToUtcIso(startDateISO, '00:00', timeZone),
      ends_at: wallClockToUtcIso(
        addLocalDays(endDateISO, 1),
        '00:00',
        timeZone
      ),
    };
  }
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

/** Inverse of `toAllDayRange` — wire pair back to calendar pickers in `timeZone`. */
export function fromAllDayRange(
  startsAt: string,
  endsAt: string,
  timeZone?: string
): { startDate: string; endDate: string } {
  if (timeZone) {
    const exclusiveEndLocal = localDateInZone(timeZone, new Date(endsAt));
    return {
      startDate: localDateInZone(timeZone, new Date(startsAt)),
      endDate: addLocalDays(exclusiveEndLocal, -1),
    };
  }
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

/** "Mon 4 Aug" from a YYYY-MM-DD civil date (weekday is zone-agnostic). */
function formatDayLabelFromCalendarDate(localDateISO: string): string {
  const [y, m, d] = localDateISO.split('-').map(Number);
  // Noon UTC keeps weekday/month stable across DST when deriving from parts.
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0));
  const weekday = WEEKDAY_ABBREVIATIONS[date.getUTCDay()] ?? '';
  const month = MONTH_ABBREVIATIONS[date.getUTCMonth()] ?? '';
  return `${weekday} ${d} ${month}`;
}

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
 *
 * Pass `timeZone` (household IANA) to resolve calendar dates in that zone;
 * omit for device-local fallback.
 */
export function formatTimeOffRangeLabel(
  startsAt: string,
  endsAt: string,
  timeZone?: string
): string {
  if (timeZone) {
    const { startDate, endDate } = fromAllDayRange(startsAt, endsAt, timeZone);
    const startLabel = formatDayLabelFromCalendarDate(startDate);
    if (startDate === endDate) {
      return startLabel;
    }
    return `${startLabel} – ${formatDayLabelFromCalendarDate(endDate)}`;
  }

  const start = new Date(startsAt);
  const inclusiveEnd = new Date(endsAt);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);

  const startLabel = formatDayLabel(start);
  if (start.toDateString() === inclusiveEnd.toDateString()) {
    return startLabel;
  }
  return `${startLabel} – ${formatDayLabel(inclusiveEnd)}`;
}
