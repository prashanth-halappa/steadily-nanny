/**
 * @module lib/wallClock
 * Convert a nominal local wall-clock date+time in an IANA zone to a UTC ISO
 * instant — same double-conversion technique as recurrenceExpander (D23).
 */
import { addWeeks, getWeekStartISO } from '@/src/domains/timesheet/utils/week';
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

/**
 * Monday-first week range [from, to) as UTC instants for the shift API,
 * resolved in `timeZone` — the HOUSEHOLD's zone, never the device's. This
 * used to resolve Monday off `now.getDay()` (the device's zone), the same
 * bug class as GOLDEN-FIXES #21: two people in different zones would see
 * DIFFERENT shifts for "this week" at the same instant. Reuses
 * `domains/timesheet/utils/week.ts`'s Monday resolution
 * (`getWeekStartISO`/`addWeeks`) and `wallClockToUtcIso`'s DST-safe
 * local->UTC conversion rather than re-deriving either, so there's exactly
 * one mechanism for "what week is it" in this codebase.
 *
 * Lives here, not in `lib/localDate`, because importing `wallClockToUtcIso`
 * from there made `wallClock <-> localDate` a require cycle.
 */
export function currentWeekRange(
  timeZone: string,
  now: Date = new Date()
): {
  from: string;
  to: string;
} {
  const weekStartISO = getWeekStartISO(now, timeZone);
  const weekEndISO = addWeeks(weekStartISO, 1);
  return {
    from: wallClockToUtcIso(weekStartISO, '00:00', timeZone),
    to: wallClockToUtcIso(weekEndISO, '00:00', timeZone),
  };
}

/** HH:MM in `timeZone` for an absolute ISO instant (always 24h — wire/forms). */
export function utcIsoToWallClockHHMM(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(new Date(iso));
}

/**
 * Display clock for an absolute ISO instant in `timeZone`, using the device
 * locale's 12h/24h preference. 24h locales get zero-padded `HH:MM`; 12h
 * locales get the locale's AM/PM form. Pass an explicit `locale` in tests.
 */
export function formatInstantDisplay(
  iso: string,
  timeZone: string,
  locale: string = Intl.DateTimeFormat().resolvedOptions().locale
): string {
  const hour12 = localePrefersHour12(locale);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(hour12 ? {} : { hourCycle: 'h23' as const }),
  }).format(new Date(iso));
}

/**
 * Display a nominal wire wall-clock (`09:00` / `09:00:00`) using the locale's
 * hour cycle. No timezone — the string is already local to the household day.
 */
export function formatNominalWallClockDisplay(
  time: string,
  locale: string = Intl.DateTimeFormat().resolvedOptions().locale
): string {
  const [hoursPart, minutesPart] = time.split(':');
  const hours = Number(hoursPart ?? 0);
  const minutes = Number(minutesPart ?? 0);
  const date = new Date(Date.UTC(2000, 0, 1, hours, minutes, 0));
  const hour12 = localePrefersHour12(locale);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(hour12 ? {} : { hourCycle: 'h23' as const }),
  }).format(date);
}

function localePrefersHour12(locale: string): boolean {
  const resolved = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
  }).resolvedOptions();
  if (typeof resolved.hour12 === 'boolean') return resolved.hour12;
  return resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12';
}
