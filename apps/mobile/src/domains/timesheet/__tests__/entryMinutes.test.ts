/**
 * @module domains/timesheet/__tests__/entryMinutes.test
 * Pure worked-minutes derivation from a time entry.
 */
import { describe, expect, it } from 'bun:test';
import type { TimeEntry } from '../types';
import { computeEntryMinutes, sumEntryMinutes } from '../utils/entryMinutes';

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    shift_id: null,
    clock_in_at: '2026-08-01T07:58:00.000Z',
    clock_out_at: '2026-08-01T14:12:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-01',
    timezone: 'Europe/London',
    created_at: '2026-08-01T07:58:00.000Z',
    updated_at: '2026-08-01T14:12:00.000Z',
    ...overrides,
  };
}

describe('computeEntryMinutes', () => {
  it('computes minutes between clock-in and clock-out, minus breaks', () => {
    const entry = makeEntry({ break_minutes: 30 });
    // 07:58 -> 14:12 is 6h14m = 374 minutes, minus a 30 minute break.
    expect(computeEntryMinutes(entry, Date.now())).toBe(344);
  });

  it('uses nowMs for a still-running entry (no clock_out_at yet)', () => {
    const entry = makeEntry({ clock_out_at: null, break_minutes: 0 });
    const now = new Date('2026-08-01T09:58:00.000Z').getTime();
    expect(computeEntryMinutes(entry, now)).toBe(120);
  });

  it('returns 0 for an entry with no clock-in yet', () => {
    const entry = makeEntry({ clock_in_at: null, clock_out_at: null });
    expect(computeEntryMinutes(entry, Date.now())).toBe(0);
  });

  it('never returns a negative number, even if breaks exceed worked time', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T08:08:00.000Z', // 10 minutes worked
      break_minutes: 999,
    });
    expect(computeEntryMinutes(entry, Date.now())).toBe(0);
  });
});

describe('sumEntryMinutes', () => {
  it('sums minutes across multiple entries', () => {
    const entries = [
      makeEntry({ id: 'a' }),
      makeEntry({
        id: 'b',
        clock_in_at: '2026-08-02T07:58:00.000Z',
        clock_out_at: '2026-08-02T09:58:00.000Z',
        break_minutes: 0,
      }),
    ];
    // 374 (entry a) + 120 (entry b) = 494
    expect(sumEntryMinutes(entries, Date.now())).toBe(494);
  });

  it('returns 0 for an empty list', () => {
    expect(sumEntryMinutes([], Date.now())).toBe(0);
  });
});
