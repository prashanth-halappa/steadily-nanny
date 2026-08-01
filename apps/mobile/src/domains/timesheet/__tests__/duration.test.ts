/**
 * @module domains/timesheet/__tests__/duration.test
 *
 * Pure formatting logic — the highest-value tests in this domain (see
 * team-lead's brief: "unit-test the duration formatting and the timer
 * cleanup directly, those are pure and worth real tests").
 */
import { describe, expect, it } from 'bun:test';
import {
  formatClockTime,
  formatDuration,
  formatElapsedSince,
  formatOvertimeDelta,
} from '../utils/duration';

describe('formatDuration', () => {
  it('formats hours and minutes together', () => {
    expect(formatDuration(374)).toBe('6h 14m');
  });

  it('formats an exact number of hours without a minutes remainder', () => {
    expect(formatDuration(120)).toBe('2h');
  });

  it('formats sub-hour durations as minutes only', () => {
    expect(formatDuration(45)).toBe('45m');
  });

  it('formats zero as 0m', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('floors fractional minutes rather than rounding', () => {
    expect(formatDuration(90.9)).toBe('1h 30m');
  });

  it('treats a negative duration as 0m (defensive — never shown in real data)', () => {
    expect(formatDuration(-5)).toBe('0m');
  });
});

describe('formatElapsedSince', () => {
  it('formats the elapsed time between a start instant and now', () => {
    const start = '2026-08-01T07:58:00.000Z';
    const now = new Date('2026-08-01T14:10:00.000Z').getTime();
    expect(formatElapsedSince(start, now)).toBe('6h 12m');
  });

  it('formats a just-started clock-in as 0m, not negative', () => {
    const start = '2026-08-01T07:58:00.000Z';
    const now = new Date('2026-08-01T07:58:30.000Z').getTime();
    expect(formatElapsedSince(start, now)).toBe('0m');
  });
});

describe('formatOvertimeDelta', () => {
  it('formats a positive delta against the scheduled minutes', () => {
    expect(formatOvertimeDelta(554, 540)).toBe('+14 min');
  });

  it('formats a negative delta (finished early)', () => {
    expect(formatOvertimeDelta(500, 540)).toBe('-40 min');
  });

  it('returns null when actual matches scheduled exactly', () => {
    expect(formatOvertimeDelta(540, 540)).toBeNull();
  });

  it('returns null when there is nothing scheduled to compare against', () => {
    expect(formatOvertimeDelta(540, null)).toBeNull();
  });
});

describe('formatClockTime', () => {
  it('formats as zero-padded 24-hour HH:MM, round-tripped through the local timezone', () => {
    // Round-trip through toISOString so the test is timezone-independent —
    // whatever local offset the runner has, parsing back must recover it.
    const date = new Date();
    date.setHours(7, 5, 0, 0);
    expect(formatClockTime(date.toISOString())).toBe('07:05');
  });

  it('pads a single-digit hour and minute', () => {
    const date = new Date();
    date.setHours(9, 3, 0, 0);
    expect(formatClockTime(date.toISOString())).toBe('09:03');
  });
});
