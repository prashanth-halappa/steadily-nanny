/**
 * @module domains/timeOff/__tests__/timeOffDate.test
 * Pure date-math tests for the time-off request flow's all-day range
 * construction and display formatting. Assertions read back through the
 * SAME local `Date` getters the implementation writes with (never a UTC
 * field), so these pass regardless of the test runner's own timezone.
 */
import { describe, expect, it } from 'bun:test';
import {
  formatTimeOffRangeLabel,
  fromAllDayRange,
  toAllDayRange,
  todayISO,
} from '../utils/timeOffDate';

describe('toAllDayRange', () => {
  it('a single-day request produces local midnight start and local midnight the next day (exclusive end)', () => {
    const { starts_at, ends_at } = toAllDayRange('2026-08-10', '2026-08-10');

    const start = new Date(starts_at);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7); // August, 0-indexed
    expect(start.getDate()).toBe(10);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);

    const end = new Date(ends_at);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(7);
    expect(end.getDate()).toBe(11);
    expect(end.getHours()).toBe(0);
  });

  it('ends_at is always strictly after starts_at, satisfying CreateCarerTimeOffSchema by construction', () => {
    const { starts_at, ends_at } = toAllDayRange('2026-08-10', '2026-08-10');
    expect(new Date(ends_at).getTime()).toBeGreaterThan(
      new Date(starts_at).getTime()
    );
  });

  it('a multi-day request spans start date through end date inclusive, exclusive-end + 1', () => {
    const { starts_at, ends_at } = toAllDayRange('2026-08-10', '2026-08-12');
    expect(new Date(starts_at).getDate()).toBe(10);
    // ends_at is the day AFTER the selected end date (13, not 12).
    expect(new Date(ends_at).getDate()).toBe(13);
  });

  it('crosses a month boundary', () => {
    const { starts_at, ends_at } = toAllDayRange('2026-07-30', '2026-07-31');
    expect(new Date(starts_at).getMonth()).toBe(6); // July
    const end = new Date(ends_at);
    expect(end.getMonth()).toBe(7); // rolls into August
    expect(end.getDate()).toBe(1);
  });

  it('crosses a year boundary', () => {
    const { ends_at } = toAllDayRange('2025-12-30', '2025-12-31');
    const end = new Date(ends_at);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(0); // January
    expect(end.getDate()).toBe(1);
  });
});

describe('todayISO', () => {
  it('returns the DEVICE local calendar date as "yyyy-mm-dd" (067 sick-day quick action)', () => {
    const now = new Date(2026, 7, 4, 23, 30); // 4 Aug 2026, 23:30 local
    expect(todayISO(now)).toBe('2026-08-04');
  });

  it('a same-day sick request built from todayISO() is a valid single-day toAllDayRange', () => {
    const today = todayISO(new Date(2026, 7, 4));
    const { starts_at, ends_at } = toAllDayRange(today, today);
    expect(new Date(ends_at).getTime()).toBeGreaterThan(
      new Date(starts_at).getTime()
    );
  });
});

describe('fromAllDayRange', () => {
  it('round-trips a single-day range through toAllDayRange', () => {
    const wire = toAllDayRange('2026-08-10', '2026-08-10');
    expect(fromAllDayRange(wire.starts_at, wire.ends_at)).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-10',
    });
  });

  it('round-trips a multi-day range through toAllDayRange', () => {
    const wire = toAllDayRange('2026-08-10', '2026-08-12');
    expect(fromAllDayRange(wire.starts_at, wire.ends_at)).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-12',
    });
  });
});

describe('formatTimeOffRangeLabel', () => {
  it('formats a single day off with no dash — 2026-08-10 is a Monday', () => {
    const { starts_at, ends_at } = toAllDayRange('2026-08-10', '2026-08-10');
    expect(formatTimeOffRangeLabel(starts_at, ends_at)).toBe('Mon 10 Aug');
  });

  it('formats a multi-day range as "Mon 10 Aug – Wed 12 Aug"', () => {
    const { starts_at, ends_at } = toAllDayRange('2026-08-10', '2026-08-12');
    expect(formatTimeOffRangeLabel(starts_at, ends_at)).toBe(
      'Mon 10 Aug – Wed 12 Aug'
    );
  });

  it('shows the INCLUSIVE last day, not the exclusive ends_at boundary itself', () => {
    // ends_at for a 2026-08-10..2026-08-12 request is local midnight
    // 2026-08-13 — the label must read "12 Aug", never "13 Aug".
    const { starts_at, ends_at } = toAllDayRange('2026-08-10', '2026-08-12');
    expect(formatTimeOffRangeLabel(starts_at, ends_at)).not.toContain('13 Aug');
  });

  it('formats a range spanning a month boundary', () => {
    const { starts_at, ends_at } = toAllDayRange('2026-07-30', '2026-07-31');
    expect(formatTimeOffRangeLabel(starts_at, ends_at)).toBe(
      'Thu 30 Jul – Fri 31 Jul'
    );
  });
});
