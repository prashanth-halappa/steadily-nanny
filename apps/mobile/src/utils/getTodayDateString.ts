import { format } from 'date-fns';

/**
 * Returns today's date as the DEVICE-LOCAL calendar date ('yyyy-MM-dd').
 *
 * GOLDEN: must not use `toISOString()` (UTC). During evening hours in
 * negative-UTC-offset timezones that rolls to the next calendar day, so "today"
 * would disagree with the user's actual local day (APIs commonly treat this
 * value as the local day boundary for daily content).
 */
export function getTodayDateString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
