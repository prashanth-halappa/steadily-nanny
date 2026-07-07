/**
 * parseDateOnlyLocal Tests
 *
 * A 'yyyy-MM-dd' date-only string must parse to LOCAL midnight, not UTC
 * midnight. `new Date('2026-07-02')` yields UTC midnight, which is the previous
 * calendar day in every negative-UTC-offset timezone.
 */

// Force a negative-UTC-offset timezone so the UTC-vs-local difference is
// deterministic regardless of the machine/CI timezone. Must run before any
// Date usage.
process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'bun:test';
import { parseDateOnlyLocal } from '../parseDateOnlyLocal';

describe('parseDateOnlyLocal', () => {
  it('parses a date-only string to LOCAL midnight', () => {
    const d = parseDateOnlyLocal('2026-07-02');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July (0-indexed)
    expect(d.getDate()).toBe(2);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('does NOT shift the calendar day backward the way new Date(str) does', () => {
    // Characterization: the naive UTC parse lands on the previous local day.
    const naiveLocalDay = new Date('2026-07-02').getDate();
    expect(naiveLocalDay).toBe(1); // proves the bug being avoided

    expect(parseDateOnlyLocal('2026-07-02').getDate()).toBe(2);
  });
});
