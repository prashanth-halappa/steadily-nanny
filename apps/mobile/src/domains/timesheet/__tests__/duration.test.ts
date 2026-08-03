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
  // Zone-aware (GOLDEN-FIXES #21 bug class) — `timeZone` is always the
  // HOUSEHOLD's, never the device's. See week.test.ts for the sibling
  // "two households, one instant" coverage this mirrors.
  it('formats as zero-padded 24-hour HH:MM in the given IANA zone', () => {
    expect(formatClockTime('2026-08-03T07:05:00.000Z', 'UTC')).toBe('07:05');
  });

  it('pads a single-digit hour and minute', () => {
    expect(formatClockTime('2026-08-03T09:03:00.000Z', 'UTC')).toBe('09:03');
  });

  it('resolves the SAME instant to a different wall-clock time in a household AHEAD of UTC', () => {
    // Pacific/Auckland is UTC+12 in NZ winter (no DST in August).
    expect(
      formatClockTime('2026-08-03T23:30:00.000Z', 'Pacific/Auckland')
    ).toBe('11:30');
  });

  it('resolves the SAME instant to a different wall-clock time in a household BEHIND UTC', () => {
    // America/Los_Angeles is UTC-7 in August (PDT).
    expect(
      formatClockTime('2026-08-03T07:05:00.000Z', 'America/Los_Angeles')
    ).toBe('00:05');
  });

  it('is DST-aware across a household timezone transition (Europe/London)', () => {
    // Winter (GMT, UTC+0): 09:00Z reads as 09:00 local.
    expect(formatClockTime('2026-01-07T09:00:00.000Z', 'Europe/London')).toBe(
      '09:00'
    );
    // Summer (BST, UTC+1): the SAME wall-clock hour is a different instant —
    // 08:00Z reads as 09:00 local, not 08:00.
    expect(formatClockTime('2026-08-03T08:00:00.000Z', 'Europe/London')).toBe(
      '09:00'
    );
  });
});
