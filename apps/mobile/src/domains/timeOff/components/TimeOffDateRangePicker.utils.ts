/**
 * @module domains/timeOff/components/TimeOffDateRangePicker.utils
 *
 * Pure "yyyy-mm-dd" calendar-date helpers for TimeOffDateRangePicker. Kept
 * in a separate, dependency-free module (no react-native, no
 * @react-native-community/datetimepicker import) so this logic can be unit
 * tested directly under bun:test — see TimeOffDateRangePicker.tsx's doc
 * comment for why the component file itself cannot be render-tested (same
 * native-package parse issue as `time-range-picker.tsx`).
 *
 * The wire format everywhere outside this file is a nominal "yyyy-mm-dd"
 * calendar date, never a Date — Date only exists transiently here, at the
 * native picker's value/onChange boundary.
 */

/** Parses a "yyyy-mm-dd" string into a Date at local midnight. */
export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

/** Formats a Date's local calendar-date components back to "yyyy-mm-dd". */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** A single-day request is valid — the end date must not be BEFORE the start. */
export function isEndOnOrAfterStart(start: string, end: string): boolean {
  return end >= start;
}
