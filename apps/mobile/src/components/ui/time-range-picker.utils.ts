/**
 * @module TimeRangePickerUtils
 *
 * Pure "HH:MM" wall-clock helpers for TimeRangePicker. Deliberately kept in
 * a separate, dependency-free module (no react-native, no
 * @react-native-community/datetimepicker import) so this logic can be unit
 * tested directly under bun:test — see time-range-picker.test.tsx's doc
 * comment for why the component file itself cannot be render-tested.
 *
 * The wire format everywhere outside this file is a nominal "HH:MM" local
 * wall-clock string, never a Date — Date only exists transiently here, at
 * the native picker's value/onChange boundary.
 */

/** Parses a nominal "HH:MM" string into a Date on a fixed reference day —
 * only the hour/minute components are meaningful. */
export function parseTime(value: string): Date {
  const [hoursPart, minutesPart] = value.split(':');
  const hours = Number(hoursPart ?? 0);
  const minutes = Number(minutesPart ?? 0);
  return new Date(2000, 0, 1, hours, minutes, 0, 0);
}

/** Formats a Date's hour/minute components back to a zero-padded "HH:MM". */
export function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Zero-padded "HH:MM" strings compare correctly with plain string comparison. */
export function isEndAfterStart(start: string, end: string): boolean {
  return end > start;
}
