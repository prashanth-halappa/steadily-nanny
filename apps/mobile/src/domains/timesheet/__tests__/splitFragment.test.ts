/**
 * Midnight is whatever instant the zone says it is — the reason this is
 * derived through `Intl` rather than by adding an offset. London's midnight
 * moves by an hour across the DST boundary, and a zone that is behind UTC
 * puts it on the following UTC date entirely.
 */
import { describe, expect, it } from 'bun:test';
import type { TimeEntry } from '../types';
import { endsAtLocalMidnight } from '../utils/splitFragment';

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 't1',
    household_id: 'h1',
    carer_id: 'c1',
    carer_display_name: 'Nia Rowe',
    shift_id: null,
    clock_in_at: '2026-08-09T22:00:00.000Z',
    clock_out_at: '2026-08-09T23:00:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-09',
    timezone: 'Europe/London',
    created_at: '2026-08-09T22:00:00.000Z',
    updated_at: '2026-08-10T01:00:00.000Z',
    ...overrides,
  } as TimeEntry;
}

describe('endsAtLocalMidnight', () => {
  it('finds London midnight at 23:00Z under BST and 00:00Z under GMT', () => {
    expect(endsAtLocalMidnight(makeEntry())).toBe(true);
    expect(
      endsAtLocalMidnight(
        makeEntry({ clock_out_at: '2026-01-12T00:00:00.000Z' })
      )
    ).toBe(true);
  });

  it('is false an hour either side of it', () => {
    expect(
      endsAtLocalMidnight(
        makeEntry({ clock_out_at: '2026-08-09T22:00:00.000Z' })
      )
    ).toBe(false);
    expect(
      endsAtLocalMidnight(
        makeEntry({ clock_out_at: '2026-08-10T00:00:00.000Z' })
      )
    ).toBe(false);
  });

  it('reads the entry zone, so UTC midnight is not New York midnight', () => {
    expect(
      endsAtLocalMidnight(
        makeEntry({
          timezone: 'America/New_York',
          clock_out_at: '2026-08-10T00:00:00.000Z', // 20:00 the evening before
        })
      )
    ).toBe(false);
    expect(
      endsAtLocalMidnight(
        makeEntry({
          timezone: 'America/New_York',
          clock_out_at: '2026-08-10T04:00:00.000Z', // 00:00 New York
        })
      )
    ).toBe(true);
  });

  it('is false for a running entry, which has no finish to place', () => {
    expect(endsAtLocalMidnight(makeEntry({ clock_out_at: null }))).toBe(false);
  });
});
