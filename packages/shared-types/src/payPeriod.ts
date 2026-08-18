/**
 * Pay-period grouping and due dates — PRESENTATION ONLY (D-17, T7 reversal).
 *
 * `docs/design/screens-pay-terms.md` §4.3: "This is how weeks are grouped
 * for you to look at. Overtime is always figured week by week, whatever the
 * pay schedule." This module derives the calendar END of the pay period a
 * given workweek falls inside, and the date that period is DUE, from the
 * arrangement's `pay_frequency` + pay-day fields (082). It never touches a
 * minute or an amount — it exists purely to answer "what period-end goes on
 * this week's export row", "which weeks belong in one combined export", and
 * "when should this week have been paid".
 *
 * It lives in `shared-types` rather than in the API's pay domain because
 * BOTH apps need the same answer: the server stamps `period_end` on an
 * export row, and the app prints "Due 14 Aug" under the Unpaid badge. Two
 * implementations of one calendar rule is two answers a family can be shown.
 * `apps/api/src/domains/pay/utils/payPeriod.ts` re-exports this module so its
 * existing domain-internal import paths are unchanged.
 *
 * PURE, same discipline as `earningsService.ts`: no I/O, no clock, plain data
 * in, a nullable date string out. `null` means "cannot be derived, honestly"
 * — no pay schedule stated, or (semimonthly/monthly) no anchor day stated —
 * and every caller must OMIT the field rather than invent one
 * (`docs/2.9`'s never-fabricate rule applied to a date instead of an amount).
 *
 * @module packages/shared-types/src/payPeriod
 */
import type { PayFrequency } from './schemas/payArrangement.schema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

/** Same dependency-free calendar arithmetic as `earningsService.ts`'s
 * `addDays` — this codebase has no date library, and UTC-anchored `Date.UTC`
 * math on Y/M/D triples never drifts across a DST boundary the way parsing
 * an ISO string with a local-timezone `Date` constructor would. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const epoch = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) + days * MS_PER_DAY;
  const dt = new Date(epoch);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  const fromEpoch = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
  const toEpoch = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1);
  return Math.round((toEpoch - fromEpoch) / MS_PER_DAY);
}

/** 0 = Sunday .. 6 = Saturday, matching Postgres `extract(dow)`. */
function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** The last calendar day of the month containing `dateISO`. */
function lastDayOfMonth(dateISO: string): string {
  const [y, m] = dateISO.split('-').map(Number);
  // Day 0 of next month is the last day of this one.
  const dt = new Date(Date.UTC(y ?? 0, m ?? 1, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Floor division — `daysBetween` can be negative for a week before the
 * arrangement's anchor, and JS's `%`/`Math.floor(a/b)` combination for
 * negative `a` is exactly floor division, so this is just named for clarity. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * The first day of the household's workweek for the week containing an
 * ALREADY-LOCAL `YYYY-MM-DD` calendar date. THE canonical implementation —
 * `apps/api/src/domains/timesheet/utils/weekStart.ts` re-exports it so its
 * many callers' import path is unchanged, and nothing keeps a second copy of
 * the `+7`-then-modulo trick that could silently drift from this one.
 *
 * Pure calendar arithmetic, no timezone at all: the columns it is applied to
 * (`expenses.local_date`, `time_entries.local_date`, `pto_ledger`
 * `.effective_date`) were already resolved in the household's timezone when
 * they were written, so converting them back through an instant + a zone
 * would mean inventing a time-of-day and re-applying an offset to a value
 * that has already had one applied — the classic way a date slips a day.
 *
 * @param weekStartsOn `households.week_starts_on`, 0=Sunday..6=Saturday.
 */
export function weekStartOfLocalDate(
  localDate: string,
  weekStartsOn: number
): string {
  const dow = weekdayOf(localDate); // 0=Sun..6=Sat
  // `+ 7` before the modulo because `dow - weekStartsOn` is negative for any
  // day earlier in the calendar week than the household's start day, and JS
  // `%` keeps the sign of the dividend — `-2 % 7` is `-2`, which would step
  // the week start FORWARD two days instead of back five.
  const daysSinceWeekStart =
    (dow - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(localDate, -daysSinceWeekStart);
}

export interface PayPeriodInput {
  /** This workweek's own last day, household-local `YYYY-MM-DD`. */
  weekEnd: string;
  payFrequency: PayFrequency | null;
  /** Read only for weekly/biweekly's biweekly anchor — a weekly schedule's
   * period IS the week, so no anchor is needed for it at all. */
  weekStart: string;
  /**
   * The biweekly cycle's anchor. `pay_arrangements.valid_from` — a fixed,
   * already-agreed date every household has, so no NEW field is needed to
   * pick which of two adjacent weeks is "week one" of a pair. Read only for
   * `biweekly`.
   */
  arrangementValidFrom: string;
  /** Household `week_starts_on` (0=Sun..6=Sat) — aligns the anchor to a week
   * boundary. Read only for `biweekly`. */
  weekStartsOn: number;
  /** The FIRST semimonthly/monthly cutoff day-of-month (082's
   * `pay_day_of_month`). Read only for `semimonthly`/`monthly`. */
  payDayOfMonth: number | null;
}

/**
 * The household-local last day of the pay period this week falls inside, or
 * `null` when it cannot be honestly derived (no schedule stated, or a
 * semimonthly/monthly schedule with no day-of-month stated).
 *
 * - `weekly` — the period IS the week: `weekEnd`, always.
 * - `biweekly` — two-week cycles anchored at the WEEK CONTAINING
 *   `arrangementValidFrom` (rounded down to that household's own week start,
 *   the same rule `weekStartOfLocalDate` applies everywhere else this repo
 *   resolves "which week does this date belong to"). The cycle a given week
 *   falls in is `floor(weeksSinceAnchor / 2)`; its END is the SECOND week's
 *   own last day.
 * - `semimonthly` — two fixed cutoffs per month: `pay_day_of_month` and the
 *   calendar's own last day. `weekEnd`'s day decides which one applies.
 * - `monthly` — one cutoff: the calendar's own last day of the month
 *   containing `weekEnd`. `pay_day_of_month` is NOT read here — a monthly
 *   schedule's payday can fall days after the period it covers (paid on the
 *   1st for the prior month), and the period boundary is the calendar month
 *   regardless of which day money actually moves.
 *
 * A week that SPANS a calendar-month boundary (household weeks are never
 * aligned to the 1st) resolves against `weekEnd`'s own month, consistently
 * with `weekly`'s "the period IS the week" rule — the week's own last day is
 * always what decides which period it belongs to.
 */
export function computePayPeriodEnd(input: PayPeriodInput): string | null {
  const { payFrequency } = input;
  if (payFrequency === null) return null;

  if (payFrequency === 'weekly') {
    return input.weekEnd;
  }

  if (payFrequency === 'biweekly') {
    const anchorWeekStart = weekStartOfLocalDate(
      input.arrangementValidFrom,
      input.weekStartsOn
    );
    const weeksSinceAnchor = floorDiv(
      daysBetween(anchorWeekStart, input.weekStart),
      7
    );
    const cycleIndex = floorDiv(weeksSinceAnchor, 2);
    const periodStart = addDays(anchorWeekStart, cycleIndex * 14);
    return addDays(periodStart, 13);
  }

  if (payFrequency === 'semimonthly') {
    if (input.payDayOfMonth === null) return null;
    const monthEnd = lastDayOfMonth(input.weekEnd);
    const [y, m] = input.weekEnd.split('-').map(Number);
    const cutoffDay = Math.min(
      input.payDayOfMonth,
      Number(monthEnd.split('-')[2])
    );
    const cutoff = `${y}-${String(m).padStart(2, '0')}-${String(cutoffDay).padStart(2, '0')}`;
    return input.weekEnd <= cutoff ? cutoff : monthEnd;
  }

  // monthly
  return lastDayOfMonth(input.weekEnd);
}

export interface PayDueDateInput extends PayPeriodInput {
  /** 082's `pay_day_of_week`, 0=Sun..6=Sat (the same Postgres `dow`
   * convention as `week_starts_on`). Read only for `weekly`/`biweekly` —
   * a semimonthly or monthly schedule's due date IS its cutoff. */
  payDayOfWeek: number | null;
}

/**
 * When the pay period containing this week is DUE, household-local
 * `YYYY-MM-DD`, or `null` when it cannot be honestly derived.
 *
 * The period end, then — for `weekly`/`biweekly` with a `pay_day_of_week`
 * stated — advanced to the first occurrence of that weekday ON OR AFTER it.
 * A pay day earlier in the week than the period end therefore lands in the
 * FOLLOWING week, which is the intent: you are paid on the next Wednesday,
 * not the Wednesday inside the week you just worked.
 *
 * PRESENTATION ONLY, like everything else in this module. Nothing downstream
 * may treat "overdue" as a money fact — it is a statement about a calendar,
 * derived from terms the family stated, and a `null` here must render as
 * nothing or as "no pay day set", never as a date.
 */
export function computePayDueDate(input: PayDueDateInput): string | null {
  const periodEnd = computePayPeriodEnd(input);
  if (periodEnd === null) return null;

  const { payFrequency, payDayOfWeek } = input;
  const isWeekBased = payFrequency === 'weekly' || payFrequency === 'biweekly';
  if (!isWeekBased || payDayOfWeek === null) return periodEnd;

  const daysUntilPayDay =
    (payDayOfWeek - weekdayOf(periodEnd) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(periodEnd, daysUntilPayDay);
}
