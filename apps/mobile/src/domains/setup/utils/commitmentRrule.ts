/**
 * @module domains/setup/utils/commitmentRrule
 *
 * Build/parse weekly RRULE strings for child commitments. Only FREQ=WEEKLY
 * with BYDAY is supported — matches the API's coverageGapService.
 */

/** Postgres `extract(dow)` index → iCalendar BYDAY token. */
const DOW_TO_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const BYDAY_TO_DOW: Record<string, number> = Object.fromEntries(
  DOW_TO_BYDAY.map((code, index) => [code, index])
);

/** Build `FREQ=WEEKLY;BYDAY=MO,TU,...` from Postgres dow indices. */
export function buildWeeklyRrule(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const byday = sorted.map(d => DOW_TO_BYDAY[d] ?? 'MO').join(',');
  return `FREQ=WEEKLY;BYDAY=${byday}`;
}

/** Parse BYDAY list from a weekly RRULE into Postgres dow indices. */
export function parseWeeklyDays(rrule: string): number[] {
  const match = rrule.match(/BYDAY=([A-Z,]+)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map(code => BYDAY_TO_DOW[code.toUpperCase()])
    .filter((d): d is number => typeof d === 'number');
}

/** Trim seconds from an ISO time for display (`09:00:00` → `09:00`). */
export function formatCommitmentTime(isoTime: string): string {
  const [h, m] = isoTime.split(':');
  return `${h}:${m}`;
}
