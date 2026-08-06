/**
 * @module domains/timesheet/__tests__/duration.test
 *
 * Pure formatting logic — the highest-value tests in this domain (see
 * team-lead's brief: "unit-test the duration formatting and the timer
 * cleanup directly, those are pure and worth real tests").
 */
import { afterEach, describe, expect, it } from 'bun:test';
import i18n from '@/src/i18n';
import {
  formatClockTime,
  formatDuration,
  formatElapsedClock,
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

describe('formatElapsedClock', () => {
  it('formats elapsed time as zero-padded HH:MM, never seconds', () => {
    const start = '2026-08-01T07:58:00.000Z';
    const now = new Date('2026-08-01T11:40:17.000Z').getTime();
    expect(formatElapsedClock(start, now)).toBe('03:42');
  });

  it('floors down to the minute within the first minute (no seconds shown)', () => {
    const start = '2026-08-01T07:58:00.000Z';
    const now = new Date('2026-08-01T07:58:30.000Z').getTime();
    expect(formatElapsedClock(start, now)).toBe('00:00');
  });

  it('clamps negative skew to 00:00', () => {
    const start = '2026-08-01T07:58:00.000Z';
    const now = new Date('2026-08-01T07:57:00.000Z').getTime();
    expect(formatElapsedClock(start, now)).toBe('00:00');
  });
});

describe('formatOvertimeDelta', () => {
  // TIER0-CX-SPEC.md §4.2 amendment: once paid overtime exists on the same
  // card (`WeekEarningsLine`'s "Overtime pay" row), this delta must stop
  // using the word "overtime" anywhere a reader could construe it as a SECOND
  // overtime figure. It never said the word to begin with ("+14 min" carried
  // no label at all) — the fix is the missing "vs scheduled" framing, e.g.
  // "2h over scheduled" (spec's own example), not a swapped-out word.
  it('formats a positive delta against the scheduled minutes as "vs scheduled"', () => {
    expect(formatOvertimeDelta(554, 540)).toBe('14m over scheduled');
  });

  it('formats a negative delta (finished early) as "vs scheduled"', () => {
    expect(formatOvertimeDelta(500, 540)).toBe('40m under scheduled');
  });

  it('formats a delta of an hour or more using formatDuration, not raw minutes', () => {
    expect(formatOvertimeDelta(660, 540)).toBe('2h over scheduled');
  });

  it('returns null when actual matches scheduled exactly', () => {
    expect(formatOvertimeDelta(540, 540)).toBeNull();
  });

  it('returns null when there is nothing scheduled to compare against', () => {
    expect(formatOvertimeDelta(540, null)).toBeNull();
  });

  // review finding 5a: this copy was hardcoded English ("over scheduled" /
  // "under scheduled"), so a Spanish-language user read English words in the
  // middle of an otherwise-translated screen. Routed through the app's real
  // i18n instance (the house pattern for pure, non-component modules — see
  // `domains/schedule/utils/calendarSyncNative.ts`), asserted against the
  // REAL Spanish resource bundle, not the component-level key-echo mock.
  describe('i18n (review finding 5a)', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('renders in Spanish when the app language is es', async () => {
      await i18n.changeLanguage('es');
      expect(formatOvertimeDelta(554, 540)).toBe(
        '14m por encima de lo previsto'
      );
      expect(formatOvertimeDelta(500, 540)).toBe(
        '40m por debajo de lo previsto'
      );
    });
  });
});

describe('formatClockTime', () => {
  // Zone-aware (GOLDEN-FIXES #21) + locale hour cycle (#22). Pass en-GB for
  // stable 24h assertions; en-US for 12h.
  it('formats in the household zone with a 24-hour locale', () => {
    expect(formatClockTime('2026-08-03T07:05:00.000Z', 'UTC', 'en-GB')).toBe(
      '07:05'
    );
  });

  it('pads a single-digit hour and minute in a 24-hour locale', () => {
    expect(formatClockTime('2026-08-03T09:03:00.000Z', 'UTC', 'en-GB')).toBe(
      '09:03'
    );
  });

  it('uses 12-hour clock when the locale prefers it', () => {
    const formatted = formatClockTime(
      '2026-08-03T17:28:00.000Z',
      'UTC',
      'en-US'
    );
    expect(formatted.toLowerCase()).toMatch(/5:28/);
    expect(formatted.toLowerCase()).toMatch(/pm/);
  });

  it('resolves the SAME instant to a different wall-clock time in a household AHEAD of UTC', () => {
    expect(
      formatClockTime('2026-08-03T23:30:00.000Z', 'Pacific/Auckland', 'en-GB')
    ).toBe('11:30');
  });

  it('resolves the SAME instant to a different wall-clock time in a household BEHIND UTC', () => {
    expect(
      formatClockTime(
        '2026-08-03T07:05:00.000Z',
        'America/Los_Angeles',
        'en-GB'
      )
    ).toBe('00:05');
  });

  it('is DST-aware across a household timezone transition (Europe/London)', () => {
    expect(
      formatClockTime('2026-01-07T09:00:00.000Z', 'Europe/London', 'en-GB')
    ).toBe('09:00');
    expect(
      formatClockTime('2026-08-03T08:00:00.000Z', 'Europe/London', 'en-GB')
    ).toBe('09:00');
  });
});
