/**
 * The two functions that turn recorded clock instants into minutes.
 *
 * WHY THIS IS ITS OWN LEAF MODULE. These live here rather than in
 * `timesheetCommandService` (which still re-exports them, so every existing
 * import keeps working) so that the pay domain's `weekEarningsService` can
 * reuse the EXACT arithmetic the weekly roll-up uses without importing the
 * command service — which would close a cycle
 * (`weekEarningsService → timesheetCommandService → timesheetQueryService →
 * weekEarningsService`). This module imports nothing but a type, so it can be
 * depended on from anywhere.
 *
 * Duplicating the arithmetic instead was the alternative, and it is exactly
 * the mistake `earningsService`'s header warns about: the timesheet's
 * `total_minutes` and the money computed from the same entries must never be
 * able to disagree.
 *
 * @module domains/timesheet/utils/workedMinutes
 */
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';

/** Minutes actually worked: clocked span minus the break, never negative. */
export function computeWorkedMinutes(
  clockInAt: string,
  clockOutAt: string,
  breakMinutes: number
): number {
  const rawMinutes = Math.round(
    (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 60_000
  );
  return Math.max(0, rawMinutes - breakMinutes);
}

/**
 * A week's total worked minutes, DERIVED fresh from its entries rather than
 * accumulated. Summing the same list twice always yields the same total —
 * that's what makes `rollUpIntoTimesheet` idempotent under a retried,
 * duplicated, or replayed clock-out, and lets the total self-heal if an
 * entry is later corrected or deleted. A still-running entry (no
 * `clock_out_at` yet) contributes 0 rather than throwing.
 */
export function sumWorkedMinutes(entries: readonly TimeEntry[]): number {
  return entries.reduce((total, entry) => {
    if (!entry.clock_in_at || !entry.clock_out_at) {
      return total;
    }
    return (
      total +
      computeWorkedMinutes(
        entry.clock_in_at,
        entry.clock_out_at,
        entry.break_minutes
      )
    );
  }, 0);
}
