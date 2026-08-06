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
 * The minutes ONE entry banks — the single formula `total_minutes` and the
 * paycheck both read (`sumWorkedMinutes` below, and
 * `weekEarningsService.buildWeekEarningsInput`). Null for an entry with no
 * finish yet: a running session has no minutes, and that is different from
 * having zero.
 *
 * `cancellation_paid` is the one kind whose stored `scheduled_minutes` is
 * AUTHORITATIVE (C7). A cancelled window is rounded once, against the window,
 * and the residual is written onto the last fragment
 * (`timesheetCommandService.recordCancellationPaidEntry`) — so re-rounding
 * that fragment's own span here would hand back the ±1 drift the residual
 * exists to remove. Legacy rows with no stored value fall back to the span.
 * Every other kind ignores `scheduled_minutes` completely: on a `worked` row
 * it is the SHIFT's booking frozen at clock-out, i.e. what she was rostered
 * for, and paying that instead of the clock would bill the roster.
 *
 * SQL TWIN: `public.run_integrity_checks()` re-expresses this exact formula
 * to find timesheets whose total has drifted. The operative copy is the
 * `create or replace` in
 * `supabase/migrations/061_integrity_checks_departed_carers.sql`, including
 * the `greatest(0, …)` that matches the clamp below; 056 introduced the
 * function and is superseded. The two must move together — 061's contract
 * test greps both branches of it.
 *
 * MOBILE TWIN: `apps/mobile/src/domains/timesheet/utils/entryMinutes.ts`
 * mirrors the cancellation rule (including this clamp) so the week the carer
 * sees sums to the week the server banks. Twins on the cancellation branch
 * ONLY — mobile deliberately shows elapsed time for a running entry where
 * this returns null.
 */
export function entryMinutes(entry: TimeEntry): number | null {
  if (!entry.clock_in_at || !entry.clock_out_at) {
    return null;
  }
  if (entry.kind === 'cancellation_paid' && entry.scheduled_minutes !== null) {
    // Floored like `computeWorkedMinutes`, so "no entry ever banks negative
    // minutes" stays a guarantee rather than a convention that happened to
    // hold on every other path. Nothing writes a negative today; the column
    // has no check constraint saying so.
    return Math.max(0, entry.scheduled_minutes);
  }
  return computeWorkedMinutes(
    entry.clock_in_at,
    entry.clock_out_at,
    entry.break_minutes
  );
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
  return entries.reduce(
    (total, entry) => total + (entryMinutes(entry) ?? 0),
    0
  );
}
