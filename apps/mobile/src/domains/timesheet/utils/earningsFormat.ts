/**
 * @module domains/timesheet/utils/earningsFormat
 *
 * Pure formatting helpers for `WeekEarningsLine`/`EarningsBreakdownSheet`
 * (`docs/TIER0-CX-SPEC.md` §4.2). Kept separate from `utils/duration.ts`
 * because the breakdown sheet's duration format is deliberately DIFFERENT
 * from the rest of the app: `formatDuration` collapses "40h 00m" to "40h"
 * (right for a headline total), but the spec's own worked-examples for a
 * breakdown row ("38h 00m at £18.50", "3h 00m at £27.75 (1.5×)") always show
 * the zero-padded minutes — a sub-line is read like a ledger entry, not a
 * headline, and every row should look the same shape at a glance.
 */

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

const WEEKDAY_ABBREVIATIONS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

/** UTC-anchored `yyyy-mm-dd` -> `Date`, same house convention as
 * `domains/timesheet/utils/week.ts` (never `new Date(isoString)` parsing,
 * which is fine for a pure UTC date string but kept explicit for clarity and
 * to match the rest of this domain). */
function toUTCDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
}

/**
 * "38h 00m" / "3h 00m" / "0h 00m" — always both units, minutes zero-padded.
 * The breakdown sheet's row-level duration format (see module header);
 * `formatDuration` (the headline format) is the wrong tool here because it
 * silently drops the minutes on an exact-hour figure.
 */
export function formatEarningsDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

/**
 * "Wed 3 Sep" — weekday + day + month abbreviation, no year. The mid-week
 * split sub-line's date-span format ("12h 00m at £18.50 (to Wed 3 Sep)"),
 * distinct from `formatShortDate`'s "4 Aug" (no weekday, used on the pay
 * arrangement screens where the week isn't the point).
 */
export function formatEarningsSpanDate(dateISO: string): string {
  const [, month, day] = dateISO.split('-').map(Number);
  const date = toUTCDate(dateISO);
  const weekday = WEEKDAY_ABBREVIATIONS[date.getUTCDay()] ?? '';
  const monthAbbr = MONTH_ABBREVIATIONS[(month ?? 1) - 1] ?? '';
  return `${weekday} ${day} ${monthAbbr}`;
}

/** "10 August" — day + full month name, no year. Used for the breakdown
 * sheet's "Approved 10 August" header and the approve dialog's date. */
export function formatEarningsLongDate(dateISO: string): string {
  const MONTHS_LONG = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ] as const;
  const [, month, day] = dateISO.split('-').map(Number);
  return `${day} ${MONTHS_LONG[(month ?? 1) - 1] ?? ''}`;
}
