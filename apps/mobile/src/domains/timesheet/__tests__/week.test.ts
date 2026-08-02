/**
 * @module domains/timesheet/__tests__/week.test
 * Pure Monday-first week math (en-GB weeks start Monday). `getWeekStartISO`
 * takes an explicit IANA timezone (always the HOUSEHOLD's, never the
 * device's) — see the "timezone-dependent week boundaries" block below,
 * which pins the exact bug class this guards against (GOLDEN-FIXES #21).
 */
import { describe, expect, it } from 'bun:test';
import {
  addWeeks,
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
} from '../utils/week';

describe('getWeekStartISO', () => {
  it('returns the same date when given a Monday', () => {
    // 2026-08-03 is a Monday.
    expect(getWeekStartISO(new Date('2026-08-03T09:00:00.000Z'), 'UTC')).toBe(
      '2026-08-03'
    );
  });

  it('rolls a mid-week date back to that week’s Monday', () => {
    // 2026-08-01 is a Saturday -> Monday of that week is 2026-07-27.
    expect(getWeekStartISO(new Date('2026-08-01T09:00:00.000Z'), 'UTC')).toBe(
      '2026-07-27'
    );
  });

  it('rolls a Sunday back to the Monday that started its week (not forward)', () => {
    // 2026-08-02 is a Sunday -> still the week starting 2026-07-27.
    expect(getWeekStartISO(new Date('2026-08-02T09:00:00.000Z'), 'UTC')).toBe(
      '2026-07-27'
    );
  });
});

describe('getWeekStartISO — timezone-dependent week boundaries', () => {
  it('resolves a different week for the SAME instant in two different household timezones', () => {
    // 2026-08-02T23:30:00Z is Sunday 23:30 in UTC — still the week starting
    // 2026-07-27. In Pacific/Auckland (UTC+12 in NZ winter, no DST in
    // August), the same instant is already ~11:30 Monday 2026-08-03 local —
    // a NEW week, whose Monday is 2026-08-03 itself. A device-local
    // implementation would give both households the same answer; the
    // household's own timezone must not agree here, because it isn't the
    // same civil day for each of them.
    const instant = new Date('2026-08-02T23:30:00.000Z');

    const utcWeekStart = getWeekStartISO(instant, 'UTC');
    const aucklandWeekStart = getWeekStartISO(instant, 'Pacific/Auckland');

    expect(utcWeekStart).toBe('2026-07-27');
    expect(aucklandWeekStart).toBe('2026-08-03');
    expect(aucklandWeekStart).not.toBe(utcWeekStart);
  });

  it('agrees across timezones when the instant is safely mid-day everywhere', () => {
    // Nothing timezone-exotic about a Wednesday noon UTC — every
    // reasonable household timezone still reads it as the same week.
    const instant = new Date('2026-07-29T12:00:00.000Z'); // Wednesday
    expect(getWeekStartISO(instant, 'UTC')).toBe('2026-07-27');
    expect(getWeekStartISO(instant, 'Pacific/Auckland')).toBe('2026-07-27');
    expect(getWeekStartISO(instant, 'America/Los_Angeles')).toBe('2026-07-27');
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

// D15: week-navigation date math. `addWeeks` shifts a Monday-anchored ISO
// date by whole weeks, so `HoursScreen` can track "which week" as a small
// integer offset from the current week (0 = current, -1 = previous, ...)
// rather than juggling absolute dates against a moving "now".
describe('addWeeks', () => {
  it('adds one week forward', () => {
    expect(addWeeks('2026-08-03', 1)).toBe('2026-08-10');
  });

  it('subtracts one week (goes to the previous Monday)', () => {
    expect(addWeeks('2026-08-03', -1)).toBe('2026-07-27');
  });

  it('a zero delta returns the same date unchanged', () => {
    expect(addWeeks('2026-08-03', 0)).toBe('2026-08-03');
  });

  it('crosses a month boundary', () => {
    expect(addWeeks('2026-07-27', 1)).toBe('2026-08-03');
  });

  it('crosses a year boundary', () => {
    expect(addWeeks('2025-12-29', 1)).toBe('2026-01-05');
  });

  it('supports multi-week deltas, not just +/-1', () => {
    expect(addWeeks('2026-08-03', 4)).toBe('2026-08-31');
    expect(addWeeks('2026-08-03', -4)).toBe('2026-07-06');
  });
});
