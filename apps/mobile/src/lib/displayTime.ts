/**
 * @module lib/displayTime
 *
 * Display-lens helpers for the user's preferred IANA timezone (D29).
 * `timeToMinutes` compares wall-clock strings numerically so HH:MM and
 * HH:MM:SS never diverge the way D31's string compare did.
 */

/** Minutes since midnight from `HH:MM` or `HH:MM:SS`. */
export function timeToMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Fixed 24-hour `HH:MM` wall clock in `timeZone` for parsing and interval
 * maths (`minutesInZone`, `hourInZone`, form wire values via
 * `utcIsoToWallClockHHMM`). Not for on-screen display — use
 * `formatInstantDisplay` / `formatClockTime` for locale-aware labels.
 * Falls back to the raw instant if the zone is unrecognized.
 */
export function formatInstantInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
