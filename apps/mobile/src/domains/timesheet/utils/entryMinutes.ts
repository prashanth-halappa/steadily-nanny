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
 * the exact same arithmetic without a real entry object.
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
 */
export function computeEntryMinutes(entry: TimeEntry, nowMs: number): number {
  if (!entry.clock_in_at) return 0;
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
