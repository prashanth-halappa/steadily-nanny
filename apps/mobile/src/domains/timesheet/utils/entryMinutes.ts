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
 * Minutes worked for one entry. A finished entry (`clock_out_at` set) uses
 * its real clock-out; a still-running entry uses `nowMs` so "today so far"
 * is visible before the shift ends. Break minutes are subtracted either
 * way, and the result is clamped to 0 — a data anomaly (breaks exceeding
 * worked time) must never display as negative hours.
 */
export function computeEntryMinutes(entry: TimeEntry, nowMs: number): number {
  if (!entry.clock_in_at) return 0;
  const endMs = entry.clock_out_at
    ? new Date(entry.clock_out_at).getTime()
    : nowMs;
  const startMs = new Date(entry.clock_in_at).getTime();
  const rawMinutes = (endMs - startMs) / MS_PER_MINUTE - entry.break_minutes;
  return Math.max(0, Math.round(rawMinutes));
}

/** Sum of `computeEntryMinutes` across a list — e.g. one day or a whole week. */
export function sumEntryMinutes(entries: TimeEntry[], nowMs: number): number {
  return entries.reduce(
    (total, entry) => total + computeEntryMinutes(entry, nowMs),
    0
  );
}
