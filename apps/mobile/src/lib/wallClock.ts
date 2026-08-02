/**
 * @module lib/wallClock
 * Convert a nominal local wall-clock date+time in an IANA zone to a UTC ISO
 * instant — same double-conversion technique as recurrenceExpander (D23).
 */

function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = (type: string): number =>
    Number(parts.find(p => p.type === type)?.value ?? '0');

  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return (localAsUtc - utcMillis) / 60_000;
}

/**
 * `localDate` = YYYY-MM-DD, `timeHHMM` = HH:MM or HH:MM:SS, `timeZone` = IANA.
 */
export function wallClockToUtcIso(
  localDate: string,
  timeHHMM: string,
  timeZone: string
): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh = 0, mi = 0, ss = 0] = timeHHMM.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh, mi, ss);
  const offset1 = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;
  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return new Date(utc).toISOString();
}

/** HH:MM in `timeZone` for an absolute ISO instant. */
export function utcIsoToWallClockHHMM(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(new Date(iso));
}
