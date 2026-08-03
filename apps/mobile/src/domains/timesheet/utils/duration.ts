/**
 * @module domains/timesheet/utils/duration
 * Pure duration formatting for clock in/out and the hours screen. en-GB
 * style ("6h 12m"), 24-hour elsewhere in the domain. No Date math that
 * assumes a specific timezone — callers pass already-resolved minutes or ISO
 * instants, which the browser/Hermes parse in UTC (both ISO strings here
 * carry an explicit offset).
 */
import { utcIsoToWallClockHHMM } from '@/src/lib/wallClock';

/** Minutes in one hour, for readability at call sites. */
const MINUTES_PER_HOUR = 60;

/**
 * "6h 14m" / "2h" (no trailing "0m") / "45m" / "0m". Negative input is
 * clamped to 0 — it should never happen with real data, but a display
 * helper must not print a negative duration.
 */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;

  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

/**
 * Elapsed time between a clock-in instant and "now", formatted the same way
 * as `formatDuration`. Clamped so a clock skew that puts `nowMs` slightly
 * before `startIso` never shows a negative timer.
 */
export function formatElapsedSince(startIso: string, nowMs: number): string {
  const startMs = new Date(startIso).getTime();
  const elapsedMinutes = (nowMs - startMs) / (MINUTES_PER_HOUR * 1000);
  return formatDuration(elapsedMinutes);
}

/**
 * "+14 min" / "-40 min" against a scheduled figure, or `null` when there is
 * nothing to compare against (no scheduled shift) or the two match exactly
 * (nothing worth stating). Deliberately minutes-only, unlike
 * `formatDuration` — an overtime delta reads better as a single unit than a
 * mixed "0h 14m".
 */
export function formatOvertimeDelta(
  actualMinutes: number,
  scheduledMinutes: number | null
): string | null {
  if (scheduledMinutes === null) return null;
  const delta = Math.round(actualMinutes - scheduledMinutes);
  if (delta === 0) return null;
  const sign = delta > 0 ? '+' : '-';
  return `${sign}${Math.abs(delta)} min`;
}

/**
 * 24-hour "07:58" in `timeZone` — en-GB convention throughout this domain.
 * `timeZone` MUST be the HOUSEHOLD's IANA zone, never the device's — two
 * people opening the app in different zones must read the same clock-in
 * time for the same entry (GOLDEN-FIXES #21 bug class; see
 * `domains/timesheet/utils/week.ts`'s header for the long version). Backed
 * by `utcIsoToWallClockHHMM` (`src/lib/wallClock.ts`), the app's one
 * DST-safe instant->wall-clock converter — delegating rather than
 * re-deriving keeps there being exactly one way to answer "what time is
 * it" in this codebase.
 */
export function formatClockTime(iso: string, timeZone: string): string {
  return utcIsoToWallClockHHMM(iso, timeZone);
}
