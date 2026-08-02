/**
 * @module lib/__tests__/displayTime.test
 * D29 — display-lens formatting in the user's preferred IANA zone.
 * Compares times numerically (D31) when parsing HH:MM / HH:MM:SS.
 */
import { describe, expect, it } from 'bun:test';
import { formatInstantInZone, timeToMinutes } from '../displayTime';

describe('timeToMinutes', () => {
  it('parses HH:MM and HH:MM:SS to the same minute value', () => {
    expect(timeToMinutes('09:00')).toBe(9 * 60);
    expect(timeToMinutes('09:00:00')).toBe(9 * 60);
    expect(timeToMinutes('17:30:00')).toBe(17 * 60 + 30);
  });
});

describe('formatInstantInZone', () => {
  const instant = '2026-08-10T15:00:00.000Z';

  it('formats the same absolute instant differently across zones', () => {
    const london = formatInstantInZone(instant, 'Europe/London');
    const tokyo = formatInstantInZone(instant, 'Asia/Tokyo');
    expect(london).not.toBe(tokyo);
    expect(london.length).toBeGreaterThan(0);
    expect(tokyo.length).toBeGreaterThan(0);
  });
});
