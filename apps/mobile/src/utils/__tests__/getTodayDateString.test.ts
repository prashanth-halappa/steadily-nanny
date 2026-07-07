/**
 * getTodayDateString Tests
 *
 * Must return the DEVICE-LOCAL calendar date as 'yyyy-MM-dd'. A UTC-based
 * implementation (`toISOString().split('T')[0]`) rolls to the next calendar day
 * for any negative-UTC-offset timezone during evening hours.
 */

// Force a negative-UTC-offset timezone so local vs UTC differ deterministically
// regardless of the machine/CI timezone. Must run before any Date usage.
process.env.TZ = 'America/New_York';

import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { getTodayDateString } from '../getTodayDateString';

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('getTodayDateString', () => {
  afterEach(() => {
    setSystemTime();
  });

  it('matches the device-local calendar date', () => {
    expect(getTodayDateString()).toBe(localDateString(new Date()));
  });

  it('returns the LOCAL day (not the UTC day) when they differ', () => {
    // 02:00 UTC on Jul 2 is still 22:00 EDT on Jul 1 in America/New_York.
    setSystemTime(new Date('2026-07-02T02:00:00Z'));

    // Sanity: local and UTC calendar days genuinely differ at this instant.
    expect(new Date().toISOString().split('T')[0]).toBe('2026-07-02');
    expect(localDateString(new Date())).toBe('2026-07-01');

    expect(getTodayDateString()).toBe('2026-07-01');
  });
});
