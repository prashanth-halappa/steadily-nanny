/**
 * @module lib/wallClock
 * Convert a nominal local wall-clock date+time in an IANA zone to a UTC ISO
 * instant — same double-conversion technique as recurrenceExpander (D23).
 */
import { addLocalDays } from '@/src/lib/localDate';

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

/**
 * One shift day's wall-clock start/end -> UTC instants.
 *
 * OVERNIGHT: an end time at or before the start time belongs to the NEXT
 * calendar day (a 19:00–00:30 shift ends on the following date). Both the
 * parent's "Save" edit and the nanny's counter-offer go through this one
 * function — the counter-offer used to build both instants off the same
 * `local_date`, which produced a proposal ending ~18.5 hours BEFORE it
 * started, so an overnight shift simply could not be countered.
 */
export function shiftInstantsFromWallClock(
  localDate: string,
  startTime: string,
  endTime: string,
  timeZone: string
): { starts_at: string; ends_at: string } {
  const endDate = endTime <= startTime ? addLocalDays(localDate, 1) : localDate;
  return {
    starts_at: wallClockToUtcIso(localDate, startTime, timeZone),
    ends_at: wallClockToUtcIso(endDate, endTime, timeZone),
  };
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
