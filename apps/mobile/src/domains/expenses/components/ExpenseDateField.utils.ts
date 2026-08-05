/**
 * @module domains/expenses/components/ExpenseDateField.utils
 *
 * Pure "yyyy-mm-dd" calendar-date helpers for `ExpenseDateField`, kept in a
 * separate, dependency-free module (no react-native, no
 * `@react-native-community/datetimepicker` import) so this logic can be
 * unit-tested directly under bun:test — same split as
 * `domains/timeOff/components/TimeOffDateRangePicker.utils.ts`, which this
 * is deliberately modelled on (see that component's doc comment for why the
 * native picker itself is never render-tested: the package ships raw
 * Flow-typed `.js` source `bun:test`'s parser cannot handle).
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

/** A future-dated expense/mileage claim reads as a typo, not a real claim —
 * refuse rather than silently accept it. */
export function isOnOrBeforeToday(value: string, todayISO: string): boolean {
  return value <= todayISO;
}
