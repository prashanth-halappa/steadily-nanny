/**
 * @module domains/timesheet/utils/week
 * Week math anchored on the HOUSEHOLD's own first day of the week —
 * `households.week_starts_on` (0=Sunday..6=Saturday, migration 075), matching
 * the DB's `timesheets.week_start` convention
 * (`supabase/migrations/017_time_tracking.sql`). There is no universal
 * Monday here: a US household starts Sunday by onboarding default, a UK one
 * Monday, and Saturday is legal too.
 *
 * Two household facts decide which week "today" belongs to, and BOTH are
 * taken explicitly rather than inferred from the device:
 *
 * WEEK START: `week_starts_on` is per-household and fixed at setup — a
 * business-week fact about the employment, NOT the same question as
 * `user_profiles.week_starts_on`, which is a per-USER calendar display
 * preference (see `src/lib/weekdayOrder.ts`). Never substitute one for the
 * other.
 *
 * TIMEZONE: two people opening the app in different zones must agree on the
 * current week for the same household (a nanny works across households; the
 * household is the source of truth for its own clock, exactly like
 * `local_date`/`week_start` on the server are trigger/service-derived in the
 * household's zone, never the caller's). Always pass `household.timezone`
 * from `useHouseholds()`, never assume the device's zone matches it. Same
 * day-math bug class as GOLDEN-FIXES #21.
 *
 * Once a week start is resolved, everything else here (`addWeeks`,
 * `weeksBetween`, `getWeekDates`, `formatWeekRangeLabel`) is pure
 * calendar-date arithmetic on an already-resolved anchor — no week-start and
 * no timezone involvement, which is why none of them take either.
 */

const DAYS_IN_WEEK = 7;

/**
 * Migration 075's `households.week_starts_on` COLUMN default (Monday) — not
 * the ONBOARDING default, which is chosen per region and gives new US
 * households Sunday explicitly (playbook §5 D-8). The ONLY legitimate use is
 * a code path with genuinely no household row in hand; naming it forces that
 * fallback to say so out loud instead of hiding a bare `1` that reads like a
 * deliberate business rule. Mirrors the API's `weekStart.ts` export.
 */
export const DEFAULT_WEEK_STARTS_ON = 1;

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
 * The week start (`yyyy-mm-dd`) of the week containing a bare calendar date,
 * for a household whose week begins on `weekStartsOn` (0=Sunday..6=Saturday).
 * UTC-anchored so the arithmetic can't be perturbed by whatever timezone
 * the CODE happens to run in — `dateISO` already IS the answer to "what
 * date"; this step is pure day-of-week math, not another timezone
 * conversion.
 */
function weekStartOf(dateISO: string, weekStartsOn: number): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const anchor = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const daysSinceWeekStart =
    (anchor.getUTCDay() - weekStartsOn + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceWeekStart);
  return toISODateUTC(anchor);
}

/**
 * The first day (`yyyy-mm-dd`) of the week containing `now`, resolved in
 * `timeZone` (an IANA zone, e.g. `household.timezone`) for a household whose
 * week begins on `weekStartsOn` (`household.week_starts_on`). The SAME
 * instant can resolve to a different week in different zones near a day
 * boundary, and to a different week for two households with different first
 * days — that's the whole point of taking both explicitly rather than
 * reading the device's zone and assuming Monday. `weekStartsOn` is required
 * on purpose: the compiler is what stops a call site silently defaulting to
 * Monday for a Sunday-start household.
 */
export function getWeekStartISO(
  now: Date,
  timeZone: string,
  weekStartsOn: number
): string {
  return weekStartOf(calendarDateInZone(now, timeZone), weekStartsOn);
}

/**
 * Shifts a week-start-anchored ISO date by `delta` whole weeks (positive =
 * forward, negative = back). UTC-anchored, same as `weekStartOf` — pure
 * calendar-date arithmetic, no timezone and no week-start re-resolution once
 * an anchor is already in hand, which is why it takes neither. Lets a caller
 * track "which week" as a small integer offset from the current week rather
 * than an absolute date that has to be reconciled against a moving "now".
 */
export function addWeeks(weekStartISO: string, delta: number): string {
  const [year, month, day] = weekStartISO.split('-').map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + delta * DAYS_IN_WEEK)
  );
  return toISODateUTC(shifted);
}

/**
 * Whole weeks from `fromWeekStartISO` to `toWeekStartISO` (both week-start
 * anchors). Negative means `to` is earlier. Inverse of `addWeeks` — used
 * when a deep link hands us an absolute `weekStart` and Hours needs the
 * matching `weekOffset` from "now".
 */
export function weeksBetween(
  fromWeekStartISO: string,
  toWeekStartISO: string
): number {
  const [fromYear, fromMonth, fromDay] = fromWeekStartISO
    .split('-')
    .map(Number);
  const [toYear, toMonth, toDay] = toWeekStartISO.split('-').map(Number);
  const fromMs = Date.UTC(fromYear ?? 0, (fromMonth ?? 1) - 1, fromDay ?? 1);
  const toMs = Date.UTC(toYear ?? 0, (toMonth ?? 1) - 1, toDay ?? 1);
  const weeks = (toMs - fromMs) / (DAYS_IN_WEEK * 24 * 60 * 60 * 1000);
  // Both arguments are supposed to be week-start anchors. A mid-week date
  // rounds to a plausible-looking offset and says nothing — which is exactly
  // how a deep link lands on the wrong week and looks like a data bug. Warn
  // in dev only; never throw and never change the number, because a caller
  // shipping today with a sloppy anchor must keep behaving identically.
  if (__DEV__ && Number.isFinite(weeks) && !Number.isInteger(weeks)) {
    console.warn(
      `weeksBetween: ${fromWeekStartISO} → ${toWeekStartISO} is ${weeks} weeks apart — not whole weeks. One of these is not a week start; rounding to ${Math.round(weeks)}.`
    );
  }
  return Math.round(weeks);
}

/** The 7 consecutive ISO dates making up the week starting `weekStartISO` — whichever weekday that anchor falls on. */
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

/**
 * Humane calendar date for parent-facing surfaces — "30 Jul" from YYYY-MM-DD.
 * Never leave a raw ISO date in the UI (Daylight UX #32).
 */
export function formatDisplayDate(dateISO: string): string {
  return formatDayMonth(dateISO);
}

/** "27 Jul – 2 Aug" from a 7-date week array (see `getWeekDates`). */
export function formatWeekRangeLabel(weekDates: string[]): string {
  const start = weekDates[0];
  const end = weekDates[weekDates.length - 1];
  if (!start || !end) return '';
  return `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`;
}
