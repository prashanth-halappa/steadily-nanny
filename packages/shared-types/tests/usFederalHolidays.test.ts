/**
 * @module packages/shared-types/tests/usFederalHolidays.test
 *
 * The federal holiday set is DATA plus one pure function (3-E4, §5 D-12). It
 * has to be a function because six of the eleven holidays have no fixed date —
 * "the third Monday in January" is a rule, and storing eleven dates a year for
 * every household would be eleven rows a year to get wrong.
 *
 * Every expected date below was worked out by hand from the day-of-week of the
 * first of the month, not from the implementation. 2026 is the canonical year;
 * 2027 is here for Memorial Day's five-Monday May (the case a naive
 * "fourth Monday" would pass in 2026 and fail in 2027), and 2028 for a leap
 * year and a Saturday New Year.
 */
import { describe, expect, it } from 'bun:test';
import {
  US_FEDERAL_HOLIDAY_KEYS,
  US_FEDERAL_HOLIDAYS,
  usFederalHolidayDates,
} from '../src/usFederalHolidays';

function dateFor(year: number, key: string): string | undefined {
  return usFederalHolidayDates(year).find(entry => entry.key === key)?.date;
}

describe('usFederalHolidayDates', () => {
  describe('2026 — the canonical year', () => {
    // Jan 1 2026 is a Thursday; Feb 1 a Sunday; May 1 a Friday; Sep 1 a
    // Tuesday; Oct 1 a Thursday; Nov 1 a Sunday.
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['new_years_day', '2026-01-01'],
      ['martin_luther_king_jr_day', '2026-01-19'], // 3rd Mon: 5, 12, 19
      ['presidents_day', '2026-02-16'], // 3rd Mon: 2, 9, 16
      ['memorial_day', '2026-05-25'], // last Mon: 4, 11, 18, 25
      ['juneteenth', '2026-06-19'],
      ['independence_day', '2026-07-04'],
      ['labor_day', '2026-09-07'], // 1st Mon
      ['columbus_day', '2026-10-12'], // 2nd Mon: 5, 12
      ['veterans_day', '2026-11-11'],
      ['thanksgiving_day', '2026-11-26'], // 4th Thu: 5, 12, 19, 26
      ['christmas_day', '2026-12-25'],
    ];

    for (const [key, date] of expected) {
      it(`${key} is ${date}`, () => {
        expect(dateFor(2026, key)).toBe(date);
      });
    }

    it('returns every holiday exactly once, date-ascending', () => {
      const dates = usFederalHolidayDates(2026);
      expect(dates).toHaveLength(US_FEDERAL_HOLIDAYS.length);
      expect(dates.map(entry => entry.date)).toEqual(
        [...dates.map(entry => entry.date)].sort()
      );
      expect(new Set(dates.map(entry => entry.key)).size).toBe(dates.length);
    });
  });

  describe('the cases a naive implementation gets wrong', () => {
    it('Memorial Day 2027 is the LAST Monday (May 31), not the fourth (May 24)', () => {
      // May 1 2027 is a Saturday, so May has five Mondays: 3, 10, 17, 24, 31.
      // "Last Monday" and "fourth Monday" agree in most years and disagree
      // here — which is why the rule is stored as -1 and not as 4.
      expect(dateFor(2027, 'memorial_day')).toBe('2027-05-31');
    });

    it('Thanksgiving 2028 is Nov 23 — a leap year does not shift a November rule', () => {
      // Nov 1 2028 is a Wednesday: Thursdays 2, 9, 16, 23.
      expect(dateFor(2028, 'thanksgiving_day')).toBe('2028-11-23');
    });

    it('New Year 2028 stays on Saturday Jan 1 — no observed-day shift', () => {
      // The federal "observed" rule (Saturday → the Friday before, Sunday →
      // the Monday after) is a rule about when federal EMPLOYEES get the day
      // off. It is not a fact about the household's week, and applying it
      // would silently move which day pays a premium. The date IS the
      // holiday; see the module doc.
      expect(dateFor(2028, 'new_years_day')).toBe('2028-01-01');
    });

    it('every key resolves in every year 2024..2035', () => {
      for (let year = 2024; year <= 2035; year += 1) {
        const dates = usFederalHolidayDates(year);
        expect(dates).toHaveLength(US_FEDERAL_HOLIDAY_KEYS.length);
        for (const entry of dates) {
          expect(entry.date.startsWith(`${year}-`)).toBe(true);
          expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    });
  });

  describe('the data itself', () => {
    it('is the eleven federal holidays, keys unique and snake_case', () => {
      expect(US_FEDERAL_HOLIDAY_KEYS).toHaveLength(11);
      expect(new Set(US_FEDERAL_HOLIDAY_KEYS).size).toBe(11);
      for (const key of US_FEDERAL_HOLIDAY_KEYS) {
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it('carries a fixed English name for every key', () => {
      for (const holiday of US_FEDERAL_HOLIDAYS) {
        expect(holiday.name.length).toBeGreaterThan(0);
      }
    });

    it('KEYS is exactly the keys of the holiday list, in order', () => {
      expect([...US_FEDERAL_HOLIDAY_KEYS]).toEqual(
        US_FEDERAL_HOLIDAYS.map(holiday => holiday.key)
      );
    });
  });
});
