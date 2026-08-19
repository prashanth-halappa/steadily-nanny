/**
 * @module domains/household/__tests__/customHolidayForm.test
 *
 * Pure custom-day draft helpers — add/remove/dedupe/sort dates, bound the
 * name, and validate. No React; the sheet is source-inspected because the
 * native date picker cannot be parsed under bun:test.
 */
import { describe, expect, it } from 'bun:test';
import {
  addCustomHolidayDate,
  CUSTOM_HOLIDAY_DATES_MAX,
  CUSTOM_HOLIDAY_NAME_MAX,
  normalizeCustomHolidayName,
  removeCustomHolidayDate,
  sortAndDedupeDates,
  validateCustomHoliday,
} from '../utils/customHolidayForm';

describe('sortAndDedupeDates', () => {
  it('sorts dates ascending and drops duplicates', () => {
    expect(
      sortAndDedupeDates([
        '2026-12-25',
        '2026-01-01',
        '2026-12-25',
        '2026-07-04',
      ])
    ).toEqual(['2026-01-01', '2026-07-04', '2026-12-25']);
  });

  it('returns a new array even when already sorted', () => {
    const input = ['2026-01-01', '2026-02-01'];
    const result = sortAndDedupeDates(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});

describe('addCustomHolidayDate', () => {
  it('appends, then dedupes and sorts', () => {
    expect(addCustomHolidayDate(['2026-12-25'], '2026-01-01')).toEqual([
      '2026-01-01',
      '2026-12-25',
    ]);
  });

  it('is a no-op when the date is already in the list', () => {
    expect(
      addCustomHolidayDate(['2026-01-01', '2026-12-25'], '2026-01-01')
    ).toEqual(['2026-01-01', '2026-12-25']);
  });

  it(`refuses a ${CUSTOM_HOLIDAY_DATES_MAX + 1}th date`, () => {
    const full = Array.from(
      { length: CUSTOM_HOLIDAY_DATES_MAX },
      (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`
    );
    expect(addCustomHolidayDate(full, '2026-06-01')).toEqual(full);
  });
});

describe('removeCustomHolidayDate', () => {
  it('removes the matching date and leaves the rest sorted', () => {
    expect(
      removeCustomHolidayDate(
        ['2026-01-01', '2026-07-04', '2026-12-25'],
        '2026-07-04'
      )
    ).toEqual(['2026-01-01', '2026-12-25']);
  });

  it('is a no-op when the date is absent', () => {
    expect(removeCustomHolidayDate(['2026-01-01'], '2026-12-25')).toEqual([
      '2026-01-01',
    ]);
  });
});

describe('normalizeCustomHolidayName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeCustomHolidayName('  Diwali  ')).toBe('Diwali');
  });

  it(`clips to ${CUSTOM_HOLIDAY_NAME_MAX} characters after trim`, () => {
    const tooLong = `  ${'a'.repeat(CUSTOM_HOLIDAY_NAME_MAX + 8)}  `;
    const result = normalizeCustomHolidayName(tooLong);
    expect(result).toHaveLength(CUSTOM_HOLIDAY_NAME_MAX);
    expect(result).toBe('a'.repeat(CUSTOM_HOLIDAY_NAME_MAX));
  });

  it('returns empty for whitespace-only input', () => {
    expect(normalizeCustomHolidayName('   ')).toBe('');
  });
});

describe('validateCustomHoliday', () => {
  const siblings = [{ name: 'Diwali', dates: ['2026-11-08'] }];

  it('accepts a named day with at least one date and a unique name', () => {
    expect(
      validateCustomHoliday(
        { name: '  Juneteenth observed  ', dates: ['2026-06-19'] },
        siblings
      )
    ).toBeNull();
  });

  it('refuses a blank name', () => {
    expect(
      validateCustomHoliday({ name: '   ', dates: ['2026-01-01'] }, [])
    ).toBe('nameRequired');
  });

  it('refuses a day with no dates', () => {
    expect(validateCustomHoliday({ name: 'School inset', dates: [] }, [])).toBe(
      'datesRequired'
    );
  });

  it('refuses a name that collides case-insensitively with another in the set', () => {
    expect(
      validateCustomHoliday({ name: 'diwali', dates: ['2027-11-01'] }, siblings)
    ).toBe('nameDuplicate');
  });

  it('allows the same name when it is the row being edited (excluded from siblings)', () => {
    expect(
      validateCustomHoliday(
        { name: 'Diwali', dates: ['2026-11-08', '2026-11-09'] },
        []
      )
    ).toBeNull();
  });
});
