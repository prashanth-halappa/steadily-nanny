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
 * Short local time label for an absolute ISO instant in `timeZone`.
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
