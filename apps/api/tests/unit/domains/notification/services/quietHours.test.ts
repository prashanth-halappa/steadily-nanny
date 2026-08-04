/**
 * @module tests/unit/domains/notification/services/quietHours.test
 */
import { describe, expect, it } from 'bun:test';
import { isWithinQuietHours } from '../../../../../src/domains/notification/services/quietHours';

describe('isWithinQuietHours', () => {
  it('returns true during a same-day quiet window', () => {
    // 14:30 UTC
    const now = new Date('2026-08-03T14:30:00.000Z');
    expect(isWithinQuietHours(now, '09:00', '17:00', 'UTC')).toBe(true);
  });

  it('returns false outside a same-day quiet window', () => {
    const now = new Date('2026-08-03T08:00:00.000Z');
    expect(isWithinQuietHours(now, '09:00', '17:00', 'UTC')).toBe(false);
  });

  it('handles midnight-wrapping quiet hours', () => {
    const late = new Date('2026-08-03T23:00:00.000Z');
    const early = new Date('2026-08-03T06:00:00.000Z');
    const midday = new Date('2026-08-03T12:00:00.000Z');
    expect(isWithinQuietHours(late, '22:00', '07:00', 'UTC')).toBe(true);
    expect(isWithinQuietHours(early, '22:00', '07:00', 'UTC')).toBe(true);
    expect(isWithinQuietHours(midday, '22:00', '07:00', 'UTC')).toBe(false);
  });

  it('evaluates against the given IANA timezone', () => {
    // 18:00 UTC is outside 09:00–17:00 UTC, but 11:00 in America/Los_Angeles (PDT).
    const now = new Date('2026-08-03T18:00:00.000Z');
    expect(
      isWithinQuietHours(now, '09:00', '17:00', 'America/Los_Angeles')
    ).toBe(true);
    expect(isWithinQuietHours(now, '09:00', '17:00', 'UTC')).toBe(false);
  });

  it('fail-opens (returns false) for an invalid IANA timezone', () => {
    const now = new Date('2026-08-03T14:30:00.000Z');
    expect(isWithinQuietHours(now, '09:00', '17:00', 'Not/A_Zone')).toBe(false);
  });
});
