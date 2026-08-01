/**
 * @module domains/timesheet/__tests__/week.test
 * Pure Monday-first week math (en-GB weeks start Monday).
 */
import { describe, expect, it } from 'bun:test';
import {
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
} from '../utils/week';

describe('getWeekStartISO', () => {
  it('returns the same date when given a Monday', () => {
    // 2026-08-03 is a Monday.
    expect(getWeekStartISO(new Date('2026-08-03T09:00:00.000Z'))).toBe(
      '2026-08-03'
    );
  });

  it('rolls a mid-week date back to that week’s Monday', () => {
    // 2026-08-01 is a Saturday -> Monday of that week is 2026-07-27.
    expect(getWeekStartISO(new Date('2026-08-01T09:00:00.000Z'))).toBe(
      '2026-07-27'
    );
  });

  it('rolls a Sunday back to the Monday that started its week (not forward)', () => {
    // 2026-08-02 is a Sunday -> still the week starting 2026-07-27.
    expect(getWeekStartISO(new Date('2026-08-02T09:00:00.000Z'))).toBe(
      '2026-07-27'
    );
  });
});

describe('getWeekDates', () => {
  it('returns 7 consecutive ISO dates starting Monday', () => {
    expect(getWeekDates('2026-07-27')).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });
});

describe('formatWeekRangeLabel', () => {
  it('formats a week that spans two months as "D MMM – D MMM"', () => {
    expect(formatWeekRangeLabel(getWeekDates('2026-07-27'))).toBe(
      '27 Jul – 2 Aug'
    );
  });

  it('formats a week within one month', () => {
    expect(formatWeekRangeLabel(getWeekDates('2026-08-03'))).toBe(
      '3 Aug – 9 Aug'
    );
  });
});
