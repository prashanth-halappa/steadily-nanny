/**
 * The household-local calendar dates an instant span covers.
 *
 * Extracted from `weekEarningsService.closureDatesInWeek`, which already had
 * to answer this for household closures, because `ptoCommandService` needs
 * the SAME answer for a time off (Phase 3/4 review, finding 15b — a marking
 * is now one ledger row per covered day). Two copies of a subtle date rule
 * drift; this is the one copy.
 *
 * THE RULE — the app's all-day convention (`toAllDayRange` in
 * `apps/mobile/src/domains/timeOff/utils/timeOffDate.ts`, used by both
 * `household_closures` and `carer_time_off`): `ends_at` is EXCLUSIVE, local
 * midnight of the day AFTER the last selected day. So the covered span is
 * `[localDate(starts_at), localDate(ends_at))`.
 *
 * One deliberate softening, inherited verbatim from the closure version: a
 * SUB-DAY span (both instants on the same local date, so the half-open range
 * is empty) still counts as ONE date. Returning nothing would silently drop a
 * real time off — and for PTO that means dropping the parent's whole marking
 * rather than mis-dating it.
 *
 * Resolved in the HOUSEHOLD's timezone, never UTC: 23:30 UTC is already
 * tomorrow east of UTC, and a day filed on the wrong date moves money into
 * the wrong week.
 *
 * @module domains/pay/utils/localDateSpan
 */
import { localDateOf } from '../../timesheet/utils/weekStart';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Pure `YYYY-MM-DD` arithmetic, UTC-anchored — the house convention (`utils/weekStart.ts`). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) + days * MS_PER_DAY
  );
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Every household-local date the span `[startsAt, endsAt)` covers, ascending.
 * Never empty: a sub-day or inverted span yields the start date alone.
 */
export function localDatesCovered(
  startsAt: string,
  endsAt: string,
  timeZone: string
): string[] {
  const first = localDateOf(new Date(startsAt), timeZone);
  const endExclusive = localDateOf(new Date(endsAt), timeZone);
  const last = endExclusive > first ? endExclusive : addDays(first, 1);

  const dates: string[] = [];
  for (let date = first; date < last; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}
