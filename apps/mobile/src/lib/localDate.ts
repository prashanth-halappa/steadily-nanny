/**
 * @module lib/localDate
 * Calendar-date helpers — never parse YYYY-MM-DD via `new Date(isoString)`.
 */
import { addWeeks, getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

/** Today's YYYY-MM-DD in an IANA timezone. */
export function localDateInZone(
  timeZone: string,
  now: Date = new Date()
): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Add `days` to a YYYY-MM-DD string (local calendar math). */
export function addLocalDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Inclusive list of YYYY-MM-DD strings from `start` for `count` days. */
export function localDateRange(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addLocalDays(start, i));
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
