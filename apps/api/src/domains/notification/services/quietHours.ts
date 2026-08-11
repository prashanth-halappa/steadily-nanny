/**
 * Pure quiet-hours clock check. Suppresses delivery when the recipient's
 * local wall-clock falls inside [start, end). Windows that wrap midnight
 * (start > end) are supported.
 *
 * Invalid IANA zones fail-open (`false`) so a bad prefs row cannot throw
 * mid-delivery — callers still log when they want observability.
 *
 * @module domains/notification/services/quietHours
 */

function minutesSinceMidnight(hhmm: string): number {
  const [hoursPart, minutesPart] = hhmm.split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  return hours * 60 + minutes;
}

/** Strip trailing seconds from a Postgres `time` / `HH:mm:ss` value. */
export function toHhMm(value: string): string {
  return value.slice(0, 5);
}

/**
 * @param now - Instant to evaluate (usually `new Date()`).
 * @param startHm - Quiet window start as `HH:mm`.
 * @param endHm - Quiet window end as `HH:mm` (exclusive).
 * @param timeZone - IANA zone for the recipient.
 * @returns `true` when inside the quiet window; `false` outside or on
 *   timezone / formatting failure (fail-open deliver).
 */
export function isWithinQuietHours(
  now: Date,
  startHm: string,
  endHm: string,
  timeZone: string
): boolean {
  try {
    // `hourCycle: 'h23'` forces 24h regardless of locale — internal gating
    // only, never rendered, so the en-US tag (§2.6 sweep, was `en-GB`) is a
    // no-op on the extracted hour/minute.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0');
    const minute = Number(
      parts.find(part => part.type === 'minute')?.value ?? '0'
    );
    const current = hour * 60 + minute;
    const start = minutesSinceMidnight(toHhMm(startHm));
    const end = minutesSinceMidnight(toHhMm(endHm));

    if (start === end) {
      // Degenerate window — treat as not quiet so a bad row cannot mute forever.
      return false;
    }

    if (start < end) {
      return current >= start && current < end;
    }

    // Wraps midnight (e.g. 22:00 → 07:00).
    return current >= start || current < end;
  } catch {
    return false;
  }
}
