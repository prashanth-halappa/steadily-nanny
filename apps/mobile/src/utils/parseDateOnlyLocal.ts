import { parse } from 'date-fns';

/**
 * Parses a date-only string ('yyyy-MM-dd') into a Date at LOCAL midnight.
 *
 * `new Date('2026-07-02')` interprets the string as UTC midnight, which is the
 * previous calendar day in any negative-UTC-offset timezone. Use this whenever
 * a date-only value must be rendered or compared as the user's calendar day.
 */
export function parseDateOnlyLocal(dateStr: string): Date {
  return parse(dateStr, 'yyyy-MM-dd', new Date());
}
