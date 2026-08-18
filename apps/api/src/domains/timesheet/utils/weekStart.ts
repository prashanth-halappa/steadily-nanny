/**
 * Week-start helpers. `week_start` on `timesheets`
 * (supabase/migrations/017_time_tracking.sql) means "the first day of the
 * household's own workweek, in the household's timezone". BOTH halves of that
 * sentence are per-household, and getting either wrong misfiles every weekly
 * total:
 *
 * - **Which day the week starts on** is `households.week_starts_on`
 *   (migration 075, `smallint not null default 1 check between 0 and 6` —
 *   0=Sunday..6=Saturday, matching Postgres `extract(dow)` and JS
 *   `getUTCDay()`). FLSA requires an employer-designated FIXED recurring
 *   7-day workweek, so it is chosen at household setup and immutable once any
 *   timesheet exists (§5 D-8; the 409 lock lives in
 *   `householdCommandService.update`). New US households are onboarded to
 *   Sunday. Do NOT confuse it with `user_profiles.week_starts_on`, which is a
 *   per-user CALENDAR DISPLAY preference and answers a different question.
 * - **Which timezone** resolves an instant to a calendar date is
 *   `households.timezone`: a clock-out at 23:30 UTC on a Sunday can already be
 *   Monday morning in a household east of UTC, and one at 01:30 UTC on a
 *   Monday can still be Sunday night in a household west of UTC.
 *
 * `weekStartsOn` is a REQUIRED parameter on every function that needs it,
 * deliberately: the compiler is what stops a call site quietly assuming
 * Monday. The one legitimate fallback — a code path with genuinely no
 * household row in hand — should say so out loud with
 * `DEFAULT_WEEK_STARTS_ON` rather than a bare literal.
 *
 * Dependency-free — uses only `Intl.DateTimeFormat`, matching the convention
 * in `utils/dateUtils.ts` and `domains/schedule/services/recurrenceExpander.ts`
 * (no date library in this codebase).
 *
 * @module domains/timesheet/utils/weekStart
 */

import { weekStartOfLocalDate } from '@steadily-nanny/shared-types/payPeriod';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

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
 * Migration 075's column default for `households.week_starts_on` (1 = Monday).
 *
 * ONLY for a code path that genuinely has no household row in hand — a
 * missing/deleted household, or a helper with no household context. A call
 * site that HAS a household must read `household.week_starts_on`; reaching
 * for this constant there would silently file a Sunday-start household's
 * hours into the wrong week. Note this is the COLUMN default, not the
 * onboarding one: new US households are set to Sunday explicitly (§5 D-8).
 */
export const DEFAULT_WEEK_STARTS_ON = 1;

/**
 * The first day of the household's workweek, in `timeZone`, for the week
 * containing `instant` — the value that belongs in `timesheets.week_start`.
 *
 * @param weekStartsOn `households.week_starts_on`, 0=Sunday..6=Saturday.
 */
export function weekStartOf(
  instant: Date,
  timeZone: string,
  weekStartsOn: number
): string {
  return weekStartOfLocalDate(localDateOf(instant, timeZone), weekStartsOn);
}

/**
 * The sibling of `weekStartOf` for the (common) case where the caller holds a
 * household-local date rather than an instant — `expenses.local_date`,
 * `time_entries.local_date`, `pto_ledger.effective_date`.
 *
 * Re-exported, not reimplemented: the canonical copy lives in
 * `@steadily-nanny/shared-types/payPeriod`, because the app needs the same
 * week-rounding rule to derive a pay period's due date. Every caller here
 * keeps importing it from this module.
 */
export { weekStartOfLocalDate } from '@steadily-nanny/shared-types/payPeriod';

/**
 * The exclusive end ('YYYY-MM-DD') of the week starting `weekStart` — i.e.
 * `weekStart + 7 days`.
 *
 * Takes NO `weekStartsOn`, deliberately: "seven days after the start" is the
 * same question whatever day the week starts on, so a parameter here would
 * change nothing while implying the answer depends on it. Pinned by
 * `weekEndExclusive > is week-start agnostic` in the sibling test.
 */
export function weekEndExclusive(weekStart: string): string {
  const epoch = toEpochDay(parseDateOnly(weekStart));
  return formatDateOnly(epoch + DAYS_PER_WEEK * MS_PER_DAY);
}

/**
 * The INCLUSIVE last day ('YYYY-MM-DD') of the week starting `weekStart` —
 * i.e. `weekStart + 6 days`. Added for 082/D-29's pay-period grouping
 * (`domains/pay/utils/payPeriod.ts`), which needs the week's own last day as
 * a plain date, not the exclusive boundary `weekEndExclusive` answers for
 * range queries. Same "week-start agnostic" property: seven days after the
 * start is the same question whatever day the week starts on.
 */
export function weekEndInclusive(weekStart: string): string {
  const epoch = toEpochDay(parseDateOnly(weekStart));
  return formatDateOnly(epoch + (DAYS_PER_WEEK - 1) * MS_PER_DAY);
}
