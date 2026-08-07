/**
 * @module domains/schedule/components/AdjustSchedulePatternSheet.utils
 *
 * Pure "yyyy-mm-dd" calendar-date helpers for `AdjustSchedulePatternSheet`'s
 * end-date field. Kept in a separate, dependency-free module (no
 * react-native, no `@react-native-community/datetimepicker` import) so this
 * logic can be unit-tested directly — same split as
 * `domains/timeOff/components/TimeOffDateRangePicker.utils.ts` and
 * `domains/expenses/components/ExpenseDateField.utils.ts`, which this is
 * deliberately modelled on.
 *
 * The wire format everywhere outside this file is a nominal "yyyy-mm-dd"
 * calendar date, never a Date — Date only exists transiently at the native
 * picker's value/onChange boundary.
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

/**
 * Mirrors the command service's own check
 * (`input.until < pattern.dtstart` throws `INVALID_UNTIL`) so a client-side
 * violation fails locally with a clear message instead of a generic 400.
 */
export function isOnOrAfter(candidate: string, minimum: string): boolean {
  return candidate >= minimum;
}
