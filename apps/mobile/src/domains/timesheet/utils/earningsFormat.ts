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
 *
 * i18n (review finding 5b): the weekday/month names below used to be
 * hardcoded English arrays, so a Spanish-language user read English month
 * abbreviations inside `formatEarningsLongDate`'s "Approved 10 August"
 * breakdown-sheet subheader. This is a pure module with no `t` in scope, so
 * it reads `i18n.language` off the shared instance directly (same house
 * pattern as `domains/schedule/utils/calendarSyncNative.ts`) and asks
 * `Intl.DateTimeFormat` for the localised weekday/month names, then
 * reassembles them in this domain's own fixed "day month" word order (never
 * the locale's own field order — that would break the pinned "10 August" /
 * "Wed 3 Sep" shapes this module's other tests and `EarningsBreakdownSheet`
 * both depend on).
 */
import i18n from '@/src/i18n';

/** UTC-anchored `yyyy-mm-dd` -> `Date`, same house convention as
 * `domains/timesheet/utils/week.ts` (never `new Date(isoString)` parsing,
 * which is fine for a pure UTC date string but kept explicit for clarity and
 * to match the rest of this domain). */
function toUTCDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
}

/** Localised weekday/day/month parts for `date`, in the app's CURRENT
 * language (`i18n.language`) — not the device locale, so switching the
 * in-app language switcher actually changes this copy. */
function localizedDateParts(
  date: Date,
  options: Intl.DateTimeFormatOptions
): { weekday: string; day: string; month: string } {
  const parts = new Intl.DateTimeFormat(i18n.language, {
    ...options,
    timeZone: 'UTC',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    day: get('day'),
    month: get('month'),
  };
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
  const { weekday, day, month } = localizedDateParts(toUTCDate(dateISO), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${weekday} ${day} ${month}`;
}

/** "10 August" — day + full month name, no year. Used for the breakdown
 * sheet's "Approved 10 August" header and the approve dialog's date. */
export function formatEarningsLongDate(dateISO: string): string {
  const { day, month } = localizedDateParts(toUTCDate(dateISO), {
    day: 'numeric',
    month: 'long',
  });
  return `${day} ${month}`;
}

/**
 * "1.5" (en) / "1,5" (es) — locale-correct decimal separator for the
 * overtime subline's multiplier (review finding 9a: the raw JS number was
 * being interpolated straight into `earningsLineOvertimeSubline`, so a
 * Spanish reader saw "1.5×" — the period-decimal English form — even though
 * the rest of the row was translated).
 */
export function formatEarningsMultiplier(multiplier: number): string {
  return new Intl.NumberFormat(i18n.language).format(multiplier);
}
