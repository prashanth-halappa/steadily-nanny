/**
 * @module domains/timesheet/utils/entryMinutes
 * Derives worked minutes from a single time entry. Pure — no network, no
 * React. `nowMs` is passed in explicitly (not read from `Date.now()`
 * internally) so a still-running entry's contribution is deterministic and
 * testable without faking timers.
 */
import type { TimeEntry } from '../types';

const MS_PER_MINUTE = 60 * 1000;

/**
 * Minutes worked between a clock-in instant and an end instant, minus a
 * break, clamped to 0. Mirrors the server's `computeWorkedMinutes`
 * (`apps/api/src/domains/timesheet/services/timesheetCommandService.ts`)
 * bit for bit: `round(elapsed) - breakMinutes` and
 * `round(elapsed - breakMinutes)` are the same value whenever
 * `breakMinutes` is an integer, which it always is here. apps/api and
 * apps/mobile don't share a runtime package for this rule (mobile can't
 * import server code), so if either side's formula ever changes, the other
 * must change with it by hand. A break longer than the elapsed time clamps
 * to 0, same as the server — never a negative total.
 *
 * Split out from `computeEntryMinutes` below so a PREVIEW (no `TimeEntry`
 * yet — e.g. the clock-out sheet's live total before confirming) can use
 * the exact same arithmetic without a real entry object. It is the SPAN rule
 * only: a real entry can also bank stored minutes instead — see the
 * `cancellation_paid` branch in `computeEntryMinutes`.
 */
export function computeWorkedMinutesFromInstants(
  clockInAt: string,
  endMs: number,
  breakMinutes: number
): number {
  const startMs = new Date(clockInAt).getTime();
  const rawMinutes = (endMs - startMs) / MS_PER_MINUTE - breakMinutes;
  return Math.max(0, Math.round(rawMinutes));
}

/**
 * Minutes worked for one entry. A finished entry (`clock_out_at` set) uses
 * its real clock-out; a still-running entry uses `nowMs` so "today so far"
 * is visible before the shift ends.
 *
 * `cancellation_paid` is the one kind whose stored `scheduled_minutes` wins:
 * the server rounds a cancelled window ONCE and writes the residual onto the
 * last fragment, so re-rounding that fragment's own span here would show a
 * total a minute off the API's on the same screen. Twin of `entryMinutes` in
 * apps/api/src/domains/timesheet/utils/workedMinutes.ts — if either side's
 * rule changes, the other must change with it by hand. Every other kind
 * ignores `scheduled_minutes`: on a worked row it is the SHIFT's booking, i.e.
 * what she was rostered for, not what she did.
 */
export function computeEntryMinutes(entry: TimeEntry, nowMs: number): number {
  if (!entry.clock_in_at) return 0;
  if (entry.kind === 'cancellation_paid' && entry.scheduled_minutes !== null) {
    // Clamped like every other path here and on the server — no entry ever
    // banks negative minutes. Nothing writes one today; the column has no
    // check constraint saying so.
    return Math.max(0, entry.scheduled_minutes);
  }
  const endMs = entry.clock_out_at
    ? new Date(entry.clock_out_at).getTime()
    : nowMs;
  return computeWorkedMinutesFromInstants(
    entry.clock_in_at,
    endMs,
    entry.break_minutes
  );
}

/** Sum of `computeEntryMinutes` across a list — e.g. one day or a whole week. */
export function sumEntryMinutes(entries: TimeEntry[], nowMs: number): number {
  return entries.reduce(
    (total, entry) => total + computeEntryMinutes(entry, nowMs),
    0
  );
}

/**
 * What these entries were ROSTERED for — the shift booking snapshotted onto
 * each entry at clock-in — or `null` when not one of them carries a schedule
 * (an ad-hoc week, or manually-added entries, which write
 * `scheduled_minutes: null`). Null means "say nothing", never "0 scheduled".
 *
 * ponytail: a rostered day she never clocked into contributes NOTHING here, so
 * the figure only becomes roster-true in arrears. That undercount is
 * deliberate — this is the denominator `NannyWeekView`/`ParentWeekView` have
 * always shown, and a widget quoting a different number than the Hours screen
 * beside it would be worse than quoting a conservative one. Upgrade path: sum
 * the week's shifts from `useShiftsRange`, and change all three call sites
 * together.
 */
export function scheduledMinutesFor(entries: TimeEntry[]): number | null {
  const withSchedule = entries.filter(e => e.scheduled_minutes !== null);
  if (withSchedule.length === 0) return null;
  return withSchedule.reduce((sum, e) => sum + (e.scheduled_minutes ?? 0), 0);
}
