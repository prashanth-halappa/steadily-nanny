/**
 * @module domains/timesheet/__tests__/earningsFormat.test
 * Pure formatting — the breakdown sheet's row/date copy (docs/TIER0-CX-SPEC.md §4.2).
 */
import { describe, expect, it } from 'bun:test';
import {
  formatEarningsDuration,
  formatEarningsLongDate,
  formatEarningsSpanDate,
} from '../utils/earningsFormat';

describe('formatEarningsDuration', () => {
  it('zero-pads minutes on an exact-hour figure, unlike formatDuration', () => {
    expect(formatEarningsDuration(2280)).toBe('38h 00m'); // 38h exactly
  });

  it('formats a mixed hours+minutes figure', () => {
    expect(formatEarningsDuration(180)).toBe('3h 00m');
    expect(formatEarningsDuration(720)).toBe('12h 00m');
  });

  it('formats zero as 0h 00m', () => {
    expect(formatEarningsDuration(0)).toBe('0h 00m');
  });

  it('clamps a negative duration defensively', () => {
    expect(formatEarningsDuration(-5)).toBe('0h 00m');
  });
});

describe('formatEarningsSpanDate', () => {
  it('formats weekday + day + short month, matching the spec\'s "Wed 3 Sep" example', () => {
    // 2026-09-03 is a Thursday in reality, so pick a date that IS a
    // Wednesday to pin the weekday computation honestly.
    expect(formatEarningsSpanDate('2026-09-02')).toBe('Wed 2 Sep');
  });

  it('formats the spec\'s "Thu 4 Sep" example', () => {
    expect(formatEarningsSpanDate('2026-09-03')).toBe('Thu 3 Sep');
  });
});

describe('formatEarningsLongDate', () => {
  it('formats day + full month, no year', () => {
    expect(formatEarningsLongDate('2026-08-10')).toBe('10 August');
  });
});
