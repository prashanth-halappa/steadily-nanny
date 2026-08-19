/**
 * Country holiday packs plus the one resolver the pricing engine calls
 * (3-E4, §5 D-12 generalised past the US federal set).
 * @module packages/shared-types/src/holidayPacks
 *
 * WHY PACKS AND NOT ONE LIST. Thanksgiving is the fourth Thursday in
 * November in the US and the second Monday in October in Canada — same
 * `thanksgiving_day` key, different rule, and a household's country is
 * what picks which. An unknown stored country degrades to an empty pack
 * rather than throwing, so a code this build has not heard of prices
 * nothing instead of crashing a week.
 *
 * TWO CANADA DAYS ARE A DATE LIST, NOT A RULE. Good Friday needs Easter
 * computus; Victoria Day is "the Monday before 25 May", which is not
 * `fixed` and not `nth_weekday`. This module does not add a third rule
 * kind. Those two carry explicit `YYYY-MM-DD`s for 2026 and 2027, and in
 * 2028 they resolve to nothing. Upgrade path is add 2028 dates, or
 * implement computus plus a `weekday_before` rule kind.
 *
 * CUSTOM DAYS UNION THROUGH A SET. `observedHolidayDates` is the single
 * seam: pack dates for the toggled keys, plus in-range custom dates,
 * deduped so a custom date that equals a pack date is one date. A week
 * that spans a year boundary (Mon 29 Dec .. Sun 4 Jan) needs BOTH years
 * resolved — the same trap `usFederalHolidays.ts` used to document on
 * `observedHolidayDatesInRange`, which this function subsumes.
 *
 * This module is dependency-free and side-effect free on purpose: the
 * engine imports it, and the engine has no I/O, no clock, and no
 * randomness. No date library.
 */

import {
  holidayDateFromRule,
  US_FEDERAL_HOLIDAYS,
  type UsFederalHolidayRule,
} from './usFederalHolidays';

export const HOLIDAY_COUNTRIES = { US: 'US', CA: 'CA' } as const;
export type HolidayCountry =
  (typeof HOLIDAY_COUNTRIES)[keyof typeof HOLIDAY_COUNTRIES];

/**
 * A holiday defined by the existing `fixed` / `nth_weekday` arithmetic.
 * Shared by the US pack (all eleven) and eight of the ten Canadian days.
 */
export interface RuleHoliday {
  readonly key: string;
  readonly name: string;
  readonly rule: UsFederalHolidayRule;
}

/**
 * A holiday this pack cannot express as a rule — Good Friday (Easter) and
 * Victoria Day (Monday before 25 May). `dates` are `YYYY-MM-DD`; a year
 * with no entry resolves to `null`.
 */
export interface DatedHoliday {
  readonly key: string;
  readonly name: string;
  readonly dates: readonly string[];
}

export type HolidayPackEntry = RuleHoliday | DatedHoliday;

export interface HolidayDate {
  readonly key: string;
  readonly date: string | null;
}

const MONDAY = 1;

/** The ten Canadian federal statutory holidays, calendar-ascending. */
export const CA_HOLIDAYS: readonly HolidayPackEntry[] = [
  {
    key: 'new_years_day',
    name: "New Year's Day",
    rule: { kind: 'fixed', month: 1, day: 1 },
  },
  {
    key: 'good_friday',
    name: 'Good Friday',
    dates: ['2026-04-03', '2027-03-26'],
  },
  {
    key: 'victoria_day',
    name: 'Victoria Day',
    dates: ['2026-05-18', '2027-05-24'],
  },
  {
    key: 'canada_day',
    name: 'Canada Day',
    rule: { kind: 'fixed', month: 7, day: 1 },
  },
  {
    key: 'labour_day',
    name: 'Labour Day',
    rule: { kind: 'nth_weekday', month: 9, weekday: MONDAY, nth: 1 },
  },
  {
    key: 'truth_and_reconciliation_day',
    name: 'National Day for Truth and Reconciliation',
    rule: { kind: 'fixed', month: 9, day: 30 },
  },
  {
    key: 'thanksgiving_day',
    name: 'Thanksgiving Day',
    rule: { kind: 'nth_weekday', month: 10, weekday: MONDAY, nth: 2 },
  },
  {
    key: 'remembrance_day',
    name: 'Remembrance Day',
    rule: { kind: 'fixed', month: 11, day: 11 },
  },
  {
    key: 'christmas_day',
    name: 'Christmas Day',
    rule: { kind: 'fixed', month: 12, day: 25 },
  },
  {
    key: 'boxing_day',
    name: 'Boxing Day',
    rule: { kind: 'fixed', month: 12, day: 26 },
  },
];

const EMPTY_PACK: readonly HolidayPackEntry[] = [];

/** Deduped union of both packs' keys — US first, then CA-only. */
export const ALL_HOLIDAY_KEYS: readonly string[] = [
  ...new Set([
    ...US_FEDERAL_HOLIDAYS.map(holiday => holiday.key),
    ...CA_HOLIDAYS.map(holiday => holiday.key),
  ]),
];

/**
 * The pack for `country`, or `[]` for a code this build does not know.
 * Never throws: an unknown stored value must degrade to "no pack".
 */
export function holidayPack(country: string): readonly HolidayPackEntry[] {
  if (country === HOLIDAY_COUNTRIES.US) {
    return US_FEDERAL_HOLIDAYS;
  }
  if (country === HOLIDAY_COUNTRIES.CA) {
    return CA_HOLIDAYS;
  }
  return EMPTY_PACK;
}

export function holidayKeysForCountry(country: string): readonly string[] {
  return holidayPack(country).map(holiday => holiday.key);
}

export function isHolidayKeyForCountry(country: string, key: string): boolean {
  return holidayPack(country).some(holiday => holiday.key === key);
}

function dateForEntry(entry: HolidayPackEntry, year: number): string | null {
  if ('dates' in entry) {
    const prefix = `${year}-`;
    return entry.dates.find(date => date.startsWith(prefix)) ?? null;
  }
  return holidayDateFromRule(entry.rule, year);
}

function compareHolidayDates(a: HolidayDate, b: HolidayDate): number {
  if (a.date === null && b.date === null) {
    return 0;
  }
  if (a.date === null) {
    return 1;
  }
  if (b.date === null) {
    return -1;
  }
  return a.date.localeCompare(b.date);
}

/**
 * Every pack holiday's date in `year`, date-ascending, nulls last.
 *
 * Dated entries (Good Friday, Victoria Day) are `null` when that year is
 * not in their list; rule entries always resolve.
 */
export function holidayDatesInYear(
  country: string,
  year: number
): readonly HolidayDate[] {
  return holidayPack(country)
    .map(entry => ({
      key: entry.key,
      date: dateForEntry(entry, year),
    }))
    .sort(compareHolidayDates);
}

/**
 * The observed-holiday DATES in `[startDate, endDate]` — pack dates for
 * the toggled keys, unioned with in-range custom dates.
 *
 * Spans both calendar years so a New-Year week works. Unknown keys are
 * ignored. A custom date equal to a pack date yields one date.
 */
export function observedHolidayDates(
  country: string,
  observedKeys: Iterable<string>,
  customDates: Iterable<string>,
  startDate: string,
  endDate: string
): string[] {
  const keys = new Set(observedKeys);
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const dates = new Set<string>();
  for (let year = startYear; year <= endYear; year += 1) {
    for (const entry of holidayDatesInYear(country, year)) {
      if (
        entry.date !== null &&
        keys.has(entry.key) &&
        entry.date >= startDate &&
        entry.date <= endDate
      ) {
        dates.add(entry.date);
      }
    }
  }
  for (const custom of customDates) {
    if (custom >= startDate && custom <= endDate) {
      dates.add(custom);
    }
  }
  return [...dates].sort();
}
