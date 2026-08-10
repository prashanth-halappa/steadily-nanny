/**
 * @module domains/schedule/utils/__tests__/shiftGrouping.test
 * A9 — one clock format for schedule display; parsing helpers stay on 24h.
 */
import { describe, expect, it } from 'bun:test';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { formatShiftTime, hourInZone, minutesInZone } from '../shiftGrouping';

describe('formatShiftTime', () => {
  const iso = '2026-08-03T14:00:00.000Z';
  const timeZone = 'UTC';

  it('matches device-locale display (12-hour) via formatClockTime', () => {
    expect(formatShiftTime(iso, timeZone, 'en-US')).toBe(
      formatClockTime(iso, timeZone, 'en-US')
    );
    const formatted = formatShiftTime(iso, timeZone, 'en-US');
    expect(formatted.toLowerCase()).toMatch(/2:00/);
    expect(formatted.toLowerCase()).toMatch(/pm/);
  });

  it('matches device-locale display (24-hour) via formatClockTime', () => {
    expect(formatShiftTime(iso, timeZone, 'en-GB')).toBe(
      formatClockTime(iso, timeZone, 'en-GB')
    );
    expect(formatShiftTime(iso, timeZone, 'en-GB')).toBe('14:00');
  });
});

describe('minutesInZone', () => {
  it('still parses 24h wall-clock from formatInstantInZone under a 12-hour locale', () => {
    expect(minutesInZone('2026-08-03T09:00:00.000Z', 'UTC')).toBe(9 * 60);
    expect(minutesInZone('2026-08-03T14:30:00.000Z', 'UTC')).toBe(14 * 60 + 30);
    expect(minutesInZone('2026-08-03T23:45:00.000Z', 'UTC')).toBe(23 * 60 + 45);
  });
});

describe('hourInZone', () => {
  it('still parses hour 0–23 from formatInstantInZone under a 12-hour locale', () => {
    expect(hourInZone('2026-08-03T09:00:00.000Z', 'UTC')).toBe(9);
    expect(hourInZone('2026-08-03T14:30:00.000Z', 'UTC')).toBe(14);
    expect(hourInZone('2026-08-03T00:00:00.000Z', 'America/New_York')).toBe(20);
  });
});
