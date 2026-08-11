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
import type { WeekEarningsOk } from '../types';
import {
  EARNINGS_LINE_KINDS,
  humanizeEarningsLineKind,
  isKnownEarningsLineKind,
} from '../types';

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
 * distinct from `formatShortDate`'s "Aug 4" (no weekday, used on the pay
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

/** Short kind label i18n key — `hours.json`'s `earningsStructureKind*`. */
const SHORT_KIND_KEYS: Partial<Record<string, string>> = {
  [EARNINGS_LINE_KINDS.REGULAR]: 'earningsStructureKindRegular',
  [EARNINGS_LINE_KINDS.OVERTIME]: 'earningsStructureKindOvertime',
  [EARNINGS_LINE_KINDS.DOUBLETIME]: 'earningsStructureKindDoubletime',
  [EARNINGS_LINE_KINDS.HOLIDAY_PREMIUM]: 'earningsStructureKindHolidayPremium',
  [EARNINGS_LINE_KINDS.CANCELLATION_PAID]:
    'earningsStructureKindCancellationPaid',
  [EARNINGS_LINE_KINDS.PTO]: 'earningsStructureKindPto',
  [EARNINGS_LINE_KINDS.GUARANTEED_TOPUP]:
    'earningsStructureKindGuaranteedTopup',
};

/**
 * "53h = 40 reg + 12 OT + 1 DT" — `docs/design/screens-pay-terms.md` §11.1,
 * D-4's collapsed one-liner. Derived from the SAME `earnings.lines` the
 * breakdown sheet renders (never a second computation) — walks the lines in
 * their given wire order (already `EARNINGS_LINE_ORDER`-then-chronological),
 * summing minutes per kind, first-seen order.
 *
 * `reimbursements` is excluded — the same denylist `EarningsBreakdownSheet`
 * applies, since it never rendered as a priced kind either. A kind this app
 * has no short label for still gets one (`humanizeEarningsLineKind`), so a
 * new kind never blanks this line — same tolerance §2.5 requires everywhere
 * else on this screen.
 *
 * Each part is rounded to the nearest whole hour BEFORE summing, and the
 * headline total is the SUM of those rounded parts (never rounded
 * independently) — so "53h" always equals "40 + 12 + 1", never a total that
 * disagrees with its own breakdown by a minute of rounding.
 *
 * `null` only when the week has no priced minutes at all (nothing to show).
 */
export function earningsStructureLine(earnings: WeekEarningsOk): string | null {
  const minutesByKind = new Map<string, number>();
  const order: string[] = [];
  for (const l of earnings.lines) {
    if (l.kind === EARNINGS_LINE_KINDS.REIMBURSEMENTS) continue;
    if (l.minutes <= 0) continue;
    if (!minutesByKind.has(l.kind)) order.push(l.kind);
    minutesByKind.set(l.kind, (minutesByKind.get(l.kind) ?? 0) + l.minutes);
  }
  if (order.length === 0) return null;

  const parts = order.map(kind => {
    const hours = Math.round((minutesByKind.get(kind) ?? 0) / 60);
    const label = isKnownEarningsLineKind(kind)
      ? i18n.t(`hours:${SHORT_KIND_KEYS[kind]}`)
      : humanizeEarningsLineKind(kind);
    return { hours, label };
  });
  const totalHours = parts.reduce((sum, part) => sum + part.hours, 0);

  return i18n.t('hours:earningsStructureLine', {
    hours: totalHours,
    parts: parts.map(part => `${part.hours} ${part.label}`).join(' + '),
  });
}
