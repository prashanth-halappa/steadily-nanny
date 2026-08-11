/**
 * The US federal holiday set, as DATA plus one pure function (3-E4, §5 D-12:
 * "household list seeded from the federal set, per-family toggles").
 * @module packages/shared-types/src/usFederalHolidays
 *
 * WHY A RULE AND NOT A DATE LIST. Six of the eleven have no fixed date —
 * "the third Monday in January" is a rule, and a stored date list would be
 * eleven rows a year, per household, to keep correct forever. The rule is
 * eleven lines of data and the dates fall out of it for any year, which is
 * also what lets the engine price a week in 2031 without anyone having
 * remembered to seed 2031.
 *
 * WHAT THE HOUSEHOLD STORES IS THE KEY, NOT THE DATE. `household_holidays`
 * (migration 080) holds `(household_id, holiday_key, observed)` — the
 * per-family toggle. Dates are resolved here, at pricing time, for the year
 * the week falls in. A stored date would be a second copy of this rule that
 * could disagree with it.
 *
 * NO OBSERVED-DAY SHIFT, DELIBERATELY. 5 U.S.C. §6103 moves a Saturday
 * holiday to the Friday before and a Sunday holiday to the Monday after — for
 * FEDERAL EMPLOYEES. That is a rule about a federal payroll calendar, not a
 * fact about this household's week, and silently applying it would move which
 * day pays a worked-holiday premium without anyone having agreed to it. The
 * date IS the holiday. Pinned by the 'New Year 2028 stays on Saturday' case.
 *
 * ponytail: eleven federal holidays only — no state holidays, no religious
 * observances, no household-authored custom days. Upgrade path is a
 * `custom_holidays` row set alongside `household_holidays`, at which point
 * `holiday_key` stops being drawn from this closed set (which is why the READ
 * schema already treats it as an open string — see `householdHoliday.schema.ts`).
 *
 * This module is dependency-free and side-effect free on purpose: the engine
 * imports it, and the engine has no I/O, no clock, and no randomness.
 */

const DAYS_PER_WEEK = 7;
/** `nth: LAST` means "the last such weekday in the month" (Memorial Day). */
const LAST_WEEKDAY_OF_MONTH = -1;

/**
 * A holiday that falls on the same calendar date every year.
 * `month` is 1-12; `day` is 1-31.
 */
interface FixedDateRule {
  readonly kind: 'fixed';
  readonly month: number;
  readonly day: number;
}

/**
 * A holiday defined as "the Nth <weekday> of <month>".
 *
 * `weekday` is 0=Sunday..6=Saturday — the same convention as
 * `households.week_starts_on` (075) and Postgres `extract(dow)`, so nothing in
 * this repo has two day-numbering schemes. `nth` is 1..4, or
 * `LAST_WEEKDAY_OF_MONTH` for "the last one".
 *
 * Memorial Day is why `nth` is not simply 1..5: it is the LAST Monday in May,
 * which is the fourth Monday in most years and the fifth in a May that starts
 * on a Saturday or Sunday. Encoding it as `4` passes in 2026 and underpays a
 * worked May 31 2027.
 */
interface NthWeekdayRule {
  readonly kind: 'nth_weekday';
  readonly month: number;
  readonly weekday: number;
  readonly nth: number;
}

export type UsFederalHolidayRule = FixedDateRule | NthWeekdayRule;

export interface UsFederalHoliday {
  /** Stable identifier — what `household_holidays.holiday_key` stores. */
  readonly key: string;
  /**
   * Fixed English, not a localisation key. Same reasoning as
   * `weekExportCsv`'s `LINE_LABELS`: this is the name that reaches a payroll
   * artifact and a seed row, both of which are read outside the app's locale.
   * A localised label for the terms screen is 3-U1's, keyed off `key`.
   */
  readonly name: string;
  readonly rule: UsFederalHolidayRule;
}

const MONDAY = 1;
const THURSDAY = 4;

/** The eleven US federal holidays (5 U.S.C. §6103), calendar-ascending. */
export const US_FEDERAL_HOLIDAYS: readonly UsFederalHoliday[] = [
  {
    key: 'new_years_day',
    name: "New Year's Day",
    rule: { kind: 'fixed', month: 1, day: 1 },
  },
  {
    key: 'martin_luther_king_jr_day',
    name: 'Martin Luther King, Jr. Day',
    rule: { kind: 'nth_weekday', month: 1, weekday: MONDAY, nth: 3 },
  },
  {
    key: 'presidents_day',
    name: "Washington's Birthday",
    rule: { kind: 'nth_weekday', month: 2, weekday: MONDAY, nth: 3 },
  },
  {
    key: 'memorial_day',
    name: 'Memorial Day',
    rule: {
      kind: 'nth_weekday',
      month: 5,
      weekday: MONDAY,
      nth: LAST_WEEKDAY_OF_MONTH,
    },
  },
  {
    key: 'juneteenth',
    name: 'Juneteenth National Independence Day',
    rule: { kind: 'fixed', month: 6, day: 19 },
  },
  {
    key: 'independence_day',
    name: 'Independence Day',
    rule: { kind: 'fixed', month: 7, day: 4 },
  },
  {
    key: 'labor_day',
    name: 'Labor Day',
    rule: { kind: 'nth_weekday', month: 9, weekday: MONDAY, nth: 1 },
  },
  {
    key: 'columbus_day',
    name: 'Columbus Day',
    rule: { kind: 'nth_weekday', month: 10, weekday: MONDAY, nth: 2 },
  },
  {
    key: 'veterans_day',
    name: 'Veterans Day',
    rule: { kind: 'fixed', month: 11, day: 11 },
  },
  {
    key: 'thanksgiving_day',
    name: 'Thanksgiving Day',
    rule: { kind: 'nth_weekday', month: 11, weekday: THURSDAY, nth: 4 },
  },
  {
    key: 'christmas_day',
    name: 'Christmas Day',
    rule: { kind: 'fixed', month: 12, day: 25 },
  },
];

/** Just the keys, in the same order — the seed list for a new household. */
export const US_FEDERAL_HOLIDAY_KEYS: readonly string[] =
  US_FEDERAL_HOLIDAYS.map(holiday => holiday.key);

/** O(1) lookup for the toggle screen and the seed. */
export const US_FEDERAL_HOLIDAY_BY_KEY: ReadonlyMap<string, UsFederalHoliday> =
  new Map(US_FEDERAL_HOLIDAYS.map(holiday => [holiday.key, holiday]));

/** Is this a key this build knows? The write-side gate; reads stay tolerant. */
export function isUsFederalHolidayKey(key: string): boolean {
  return US_FEDERAL_HOLIDAY_BY_KEY.has(key);
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Calendar arithmetic on UTC components only — never a real instant, and
 * never a local-timezone `new Date(y, m, d)`, which would resolve differently
 * on a machine in Auckland. Same dependency-free convention as
 * `earningsService`'s `addDays` and `timesheet/utils/weekStart.ts`; this
 * codebase has no date library and does not want one for eleven rules.
 */
function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Day 0 of the NEXT month is the last day of this one. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The `YYYY-MM-DD` this rule resolves to in `year`. Pure and total. */
function usFederalHolidayDate(
  rule: UsFederalHolidayRule,
  year: number
): string {
  if (rule.kind === 'fixed') {
    return toIsoDate(year, rule.month, rule.day);
  }
  if (rule.nth === LAST_WEEKDAY_OF_MONTH) {
    const last = lastDayOfMonth(year, rule.month);
    const lastDow = dayOfWeek(year, rule.month, last);
    // Walk BACK from the last day to the most recent matching weekday.
    const back = (lastDow - rule.weekday + DAYS_PER_WEEK) % DAYS_PER_WEEK;
    return toIsoDate(year, rule.month, last - back);
  }
  const firstDow = dayOfWeek(year, rule.month, 1);
  // Forward from the 1st to the first matching weekday, then whole weeks.
  const forward = (rule.weekday - firstDow + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return toIsoDate(
    year,
    rule.month,
    1 + forward + (rule.nth - 1) * DAYS_PER_WEEK
  );
}

export interface UsFederalHolidayDate {
  readonly key: string;
  readonly date: string;
}

/**
 * Every federal holiday's `YYYY-MM-DD` in `year`, date-ascending.
 *
 * The sort is not cosmetic: `US_FEDERAL_HOLIDAYS` is written in calendar order
 * but nothing enforces that a rule stays where it was declared, and a caller
 * that assumes order (the terms screen, the seed) should not have to re-sort.
 */
export function usFederalHolidayDates(
  year: number
): readonly UsFederalHolidayDate[] {
  return US_FEDERAL_HOLIDAYS.map(holiday => ({
    key: holiday.key,
    date: usFederalHolidayDate(holiday.rule, year),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The observed-holiday DATES in `[weekStart, weekEnd]` — the exact shape the
 * earnings engine takes (`ComputeWeekEarningsInput.observed_holidays`).
 *
 * `observedKeys` is what the household actually toggled on. A week that spans
 * a year boundary (Mon 29 Dec .. Sun 4 Jan) needs BOTH years resolved, which
 * is the same trap `weekEarningsService`'s calendar-year PTO fetch documents;
 * doing it here means no caller has to remember.
 */
export function observedHolidayDatesInRange(
  observedKeys: Iterable<string>,
  startDate: string,
  endDate: string
): string[] {
  const keys = new Set(observedKeys);
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const dates = new Set<string>();
  for (let year = startYear; year <= endYear; year += 1) {
    for (const entry of usFederalHolidayDates(year)) {
      if (
        keys.has(entry.key) &&
        entry.date >= startDate &&
        entry.date <= endDate
      ) {
        dates.add(entry.date);
      }
    }
  }
  return [...dates].sort();
}
