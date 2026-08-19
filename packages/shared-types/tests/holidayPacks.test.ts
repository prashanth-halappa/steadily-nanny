/**
 * @module packages/shared-types/tests/holidayPacks.test
 *
 * Country holiday packs plus the single observed-date resolver the pricing
 * engine will call. 2026 and 2027 are the years the Canada dated entries
 * cover; the tripwire below is what goes red the day they do not.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_HOLIDAY_KEYS,
  CA_HOLIDAYS,
  holidayDatesInYear,
  holidayKeysForCountry,
  holidayPack,
  isHolidayKeyForCountry,
  observedHolidayDates,
} from '../src/holidayPacks';

function dateFor(
  country: string,
  year: number,
  key: string
): string | null | undefined {
  return holidayDatesInYear(country, year).find(entry => entry.key === key)
    ?.date;
}

describe('holidayPack', () => {
  it('returns an empty pack for an unknown country — never throws', () => {
    expect(holidayPack('GB')).toEqual([]);
    expect(holidayPack('')).toEqual([]);
    expect(holidayKeysForCountry('XX')).toEqual([]);
  });

  it('does not treat a US key as Canadian', () => {
    expect(isHolidayKeyForCountry('CA', 'independence_day')).toBe(false);
  });

  it('every pack key is snake_case — a colon would break i18next namespaces', () => {
    for (const country of ['US', 'CA']) {
      for (const holiday of holidayPack(country)) {
        expect(holiday.key).toMatch(/^[a-z0-9_]+$/);
      }
    }
    for (const key of ALL_HOLIDAY_KEYS) {
      expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('CA_HOLIDAYS dates', () => {
  const caKeys = CA_HOLIDAYS.map(holiday => holiday.key);

  it('is the ten Canadian federal statutory days', () => {
    expect(caKeys).toHaveLength(10);
    expect(new Set(caKeys).size).toBe(10);
  });

  for (const year of [2026, 2027] as const) {
    it(`every CA key resolves a date in ${year}`, () => {
      for (const key of caKeys) {
        const date = dateFor('CA', year, key);
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(date?.startsWith(`${year}-`)).toBe(true);
      }
    });
  }

  it('pins Good Friday, Victoria Day, and Thanksgiving 2026', () => {
    expect(dateFor('CA', 2026, 'good_friday')).toBe('2026-04-03');
    expect(dateFor('CA', 2026, 'victoria_day')).toBe('2026-05-18');
    expect(dateFor('CA', 2026, 'thanksgiving_day')).toBe('2026-10-12');
  });

  it('pins Good Friday and Victoria Day 2027', () => {
    expect(dateFor('CA', 2027, 'good_friday')).toBe('2027-03-26');
    expect(dateFor('CA', 2027, 'victoria_day')).toBe('2027-05-24');
  });

  it('null-dated entries sort last when a year has no explicit date', () => {
    const dates = holidayDatesInYear('CA', 2028);
    const dated = dates.filter(entry => entry.date !== null);
    const undated = dates.filter(entry => entry.date === null);
    expect(undated.map(entry => entry.key).sort()).toEqual(
      ['good_friday', 'victoria_day'].sort()
    );
    expect(
      dates
        .slice(dated.length)
        .map(entry => entry.key)
        .sort()
    ).toEqual(['good_friday', 'victoria_day'].sort());
    const datedIso = dated.map(entry => entry.date);
    expect(datedIso).toEqual([...datedIso].sort());
  });
});

describe('observedHolidayDates', () => {
  it('merges pack dates with in-range custom dates', () => {
    expect(
      observedHolidayDates(
        'CA',
        ['canada_day'],
        ['2026-07-02'],
        '2026-06-30',
        '2026-07-05'
      )
    ).toEqual(['2026-07-01', '2026-07-02']);
  });

  it('dedupes a custom date that equals a pack date', () => {
    expect(
      observedHolidayDates(
        'CA',
        ['canada_day'],
        ['2026-07-01'],
        '2026-06-30',
        '2026-07-05'
      )
    ).toEqual(['2026-07-01']);
  });

  it('filters pack and custom dates to the range', () => {
    expect(
      observedHolidayDates(
        'CA',
        ['canada_day', 'christmas_day'],
        ['2026-07-02', '2026-12-26'],
        '2026-07-01',
        '2026-07-03'
      )
    ).toEqual(['2026-07-01', '2026-07-02']);
  });

  it('spans a New-Year week — both calendar years must resolve', () => {
    // Mon 28 Dec 2026 .. Sun 3 Jan 2027. Christmas is in 2026; New Year is
    // in 2027. Resolving only the start year would drop Jan 1.
    expect(
      observedHolidayDates(
        'US',
        ['christmas_day', 'new_years_day'],
        [],
        '2026-12-20',
        '2027-01-04'
      )
    ).toEqual(['2026-12-25', '2027-01-01']);
  });

  it('ignores unknown keys rather than throwing', () => {
    expect(
      observedHolidayDates(
        'US',
        ['independence_day', 'st_swithins_day'],
        [],
        '2026-07-01',
        '2026-07-10'
      )
    ).toEqual(['2026-07-04']);
  });
});

describe('the Canada dated-entry ceiling', () => {
  it('every CA key resolves a date for next year', () => {
    // Deliberately goes red on 2027-01-01, when next year is 2028 and
    // good_friday / victoria_day have no dated entries. Upgrade path is
    // add 2028 dates, or implement Easter computus plus a weekday_before
    // rule kind — see holidayPacks.ts.
    const year = new Date().getFullYear() + 1;
    for (const holiday of CA_HOLIDAYS) {
      const date = dateFor('CA', year, holiday.key);
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(date?.startsWith(`${year}-`)).toBe(true);
    }
  });
});
