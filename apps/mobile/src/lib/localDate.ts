/**
 * @module lib/localDate
 * Calendar-date helpers — never parse YYYY-MM-DD via `new Date(isoString)`.
 */

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

/** Monday-first week range [from, to) as ISO datetimes for shift API. */
export function currentWeekRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const dow = now.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + diffToMonday
  );
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { from: monday.toISOString(), to: nextMonday.toISOString() };
}

/** Two-week range [from, to) as ISO datetimes. */
export function twoWeekRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const dow = now.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + diffToMonday
  );
  const end = new Date(monday);
  end.setDate(monday.getDate() + 14);
  return { from: monday.toISOString(), to: end.toISOString() };
}
