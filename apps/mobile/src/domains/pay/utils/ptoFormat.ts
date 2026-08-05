/**
 * @module domains/pay/utils/ptoFormat
 *
 * Signed hour/minute formatting for the PTO balance — the ONE place a
 * balance-in-minutes becomes display text. Deliberately separate from
 * `domains/timesheet/utils/duration.ts`'s `formatDuration`, which clamps
 * negative input to 0 (correct for a worked duration, which can never be
 * negative) — a PTO balance is the opposite case: **a negative balance is
 * legal** (a household may mark more time paid than a carer has accrued;
 * the product warns, never blocks — docs/11-MONEY.md §5,
 * TIER0-CX-SPEC.md §5.1) and must render honestly, with a leading minus,
 * never silently clamped away.
 */

const MINUTES_PER_HOUR = 60;

/**
 * `5760` -> `"96h"`, `-480` -> `"-8h"`, `-510` -> `"-8h 30m"`, `0` -> `"0h"`.
 * The sign is carried once, on the whole figure, never split across the
 * hours/minutes parts.
 */
export function formatSignedHours(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '-' : '';
  const absMinutes = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(absMinutes / MINUTES_PER_HOUR);
  const remainder = absMinutes % MINUTES_PER_HOUR;

  const core = remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  return `${sign}${core}`;
}
