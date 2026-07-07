/**
 * Small, dependency-free date helpers.
 *
 * @module utils/dateUtils
 */

/** Format a Date as a `YYYY-MM-DD` string (UTC). */
export function toDateOnlyString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Usage-quota period granularity. */
export type PeriodType = 'daily' | 'weekly' | 'monthly';

/**
 * Compute the `YYYY-MM-DD` period-start for a usage counter of the given period
 * type, based on `date` (UTC).
 * - daily   → that day
 * - weekly  → Monday of that ISO week
 * - monthly → first day of that month
 */
export function getPeriodStart(
  periodType: PeriodType,
  date: Date = new Date()
): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

  if (periodType === 'monthly') {
    d.setUTCDate(1);
  } else if (periodType === 'weekly') {
    // ISO week: Monday = 1 ... Sunday = 7. Shift back to Monday.
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
  }

  return toDateOnlyString(d);
}
