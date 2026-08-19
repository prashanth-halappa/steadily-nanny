/**
 * @module domains/household/utils/customHolidayForm
 *
 * Pure helpers for a household-authored custom day: add/remove/dedupe/sort
 * dates, trim-and-bound the name, and validate before the settings screen
 * folds the draft into local state. No React — the edit sheet is
 * source-inspected because `@react-native-community/datetimepicker` cannot
 * be parsed under bun:test (same split as ExpenseDateField).
 */

/** Wire `HouseholdCustomHolidaySchema.name` is `.min(1).max(60)`. */
export const CUSTOM_HOLIDAY_NAME_MAX = 60;

/** Wire `dates` is `.min(1).max(12)` — a 13th date is refused, not clamped
 * by dropping an earlier one. */
export const CUSTOM_HOLIDAY_DATES_MAX = 12;

export interface CustomHolidayDraft {
  name: string;
  dates: readonly string[];
}

export type CustomHolidayValidationError =
  | 'nameRequired'
  | 'datesRequired'
  | 'nameDuplicate';

/** Trim, then clip to the wire max. Empty after trim stays empty. */
export function normalizeCustomHolidayName(name: string): string {
  return name.trim().slice(0, CUSTOM_HOLIDAY_NAME_MAX);
}

/** Unique `YYYY-MM-DD`s, calendar-ascending. Never mutates `dates`. */
export function sortAndDedupeDates(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort((a, b) => a.localeCompare(b));
}

/**
 * Append `date`, then dedupe+sort. A duplicate is a no-op. A list that is
 * already at the wire max is left unchanged rather than dropping an older
 * date to make room (refuse, don't clamp).
 */
export function addCustomHolidayDate(
  dates: readonly string[],
  date: string
): string[] {
  if (dates.includes(date)) {
    return sortAndDedupeDates(dates);
  }
  if (dates.length >= CUSTOM_HOLIDAY_DATES_MAX) {
    return sortAndDedupeDates(dates);
  }
  return sortAndDedupeDates([...dates, date]);
}

export function removeCustomHolidayDate(
  dates: readonly string[],
  date: string
): string[] {
  return dates.filter(entry => entry !== date);
}

/**
 * A day needs a non-empty name and at least one date; names must be unique
 * case-insensitively against `siblings` (the rest of the set — the caller
 * omits the row being edited).
 */
export function validateCustomHoliday(
  candidate: CustomHolidayDraft,
  siblings: readonly CustomHolidayDraft[]
): CustomHolidayValidationError | null {
  const name = normalizeCustomHolidayName(candidate.name);
  if (name.length < 1) {
    return 'nameRequired';
  }
  if (sortAndDedupeDates(candidate.dates).length < 1) {
    return 'datesRequired';
  }
  const key = name.toLowerCase();
  const collision = siblings.some(
    sibling => normalizeCustomHolidayName(sibling.name).toLowerCase() === key
  );
  if (collision) {
    return 'nameDuplicate';
  }
  return null;
}
