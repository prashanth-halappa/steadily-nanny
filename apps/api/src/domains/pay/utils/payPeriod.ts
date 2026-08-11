/**
 * Pay-period grouping — PRESENTATION ONLY (D-17, T7 reversal).
 *
 * `docs/design/screens-pay-terms.md` §4.3: "This is how weeks are grouped
 * for you to look at. Overtime is always figured week by week, whatever the
 * pay schedule." This module derives the calendar END of the pay period a
 * given workweek falls inside, from the arrangement's `pay_frequency` +
 * pay-day fields (082). It never touches a minute or an amount — it exists
 * purely to answer "what period-end goes on this week's export row" and
 * "which weeks belong in one combined export".
 *
 * PURE, same discipline as `earningsService.ts`: no I/O, no clock, plain data
 * in, a nullable date string out. `null` means "cannot be derived, honestly"
 * — no pay schedule stated, or (semimonthly/monthly) no anchor day stated —
 * and every caller must OMIT the field rather than invent one
 * (`docs/2.9`'s never-fabricate rule applied to a date instead of an amount).
 *
 * @module domains/pay/utils/payPeriod
 */
import type { PayFrequency } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
// Concrete cross-domain import, never a barrel — same rule
// `timesheetQueryService` follows importing the pay domain's repository
// directly. Reusing the ONE place "which week does this date belong to" is
// answered, rather than a second copy of the same +7-mod trick that could
// silently drift from it.
import { weekStartOfLocalDate } from '../../timesheet/utils/weekStart';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
