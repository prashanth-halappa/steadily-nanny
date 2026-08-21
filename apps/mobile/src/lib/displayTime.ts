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

/**
 * Short zone label for the household's timezone — "BST", "GMT+1", "PDT".
 *
 * P15: every time in the app is rendered in the HOUSEHOLD's zone, which is
 * correct and deliberate (`GOLDEN-FIXES.md` #29, decision D-10), but nothing
 * on screen said so. A nanny reading "8:00 AM – 5:00 PM" on a phone showing
 * 12:26 had no way to learn the shift is quoted in someone else's clock — and
 * that number is what her pay is computed from. This labels it; it never
 * changes the conversion.
 *
 * Returns null when the zone is unrecognized, so a caller renders nothing
 * rather than a broken suffix.
 */
export function shortZoneLabel(
  timeZone: string,
  at: Date = new Date()
): string | null {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' })
        .formatToParts(at)
        .find(part => part.type === 'timeZoneName')?.value ?? null
    );
  } catch {
    return null;
  }
}
