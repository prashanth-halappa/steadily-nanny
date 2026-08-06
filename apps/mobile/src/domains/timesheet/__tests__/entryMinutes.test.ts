/**
 * @module domains/timesheet/__tests__/entryMinutes.test
 * Pure worked-minutes derivation from a time entry.
 */
import { describe, expect, it } from 'bun:test';
import type { TimeEntry } from '../types';
import {
  computeEntryMinutes,
  computeWorkedMinutesFromInstants,
  sumEntryMinutes,
} from '../utils/entryMinutes';

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    carer_display_name: 'Nia Rowe',
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

describe('computeEntryMinutes — cancellation pay banks its stored minutes', () => {
  // The server rounds a cancelled window ONCE and writes the residual onto a
  // fragment's `scheduled_minutes`, which is then what it pays and what
  // `total_minutes` carries. Re-rounding the fragment's own span here puts a
  // different number on the same screen as the API's.
  it('uses scheduled_minutes over the span for a cancellation fragment', () => {
    const fragment = makeEntry({
      kind: 'cancellation_paid',
      clock_in_at: '2026-08-01T12:00:40.000Z',
      clock_out_at: '2026-08-01T19:00:20.000Z', // 419m40s -> spans to 420
      scheduled_minutes: 419,
      break_minutes: 0,
    });
    expect(computeEntryMinutes(fragment, Date.now())).toBe(419);
  });

  it('falls back to the span for a legacy fragment with no stored minutes', () => {
    const legacy = makeEntry({
      kind: 'cancellation_paid',
      clock_in_at: '2026-08-01T08:00:00.000Z',
      clock_out_at: '2026-08-01T15:00:00.000Z',
      scheduled_minutes: null,
    });
    expect(computeEntryMinutes(legacy, Date.now())).toBe(420);
  });

  it('ignores scheduled_minutes on a worked entry — that is the roster, not the clock', () => {
    const worked = makeEntry({
      clock_in_at: '2026-08-01T08:00:00.000Z',
      clock_out_at: '2026-08-01T12:00:00.000Z',
      scheduled_minutes: 480,
    });
    expect(computeEntryMinutes(worked, Date.now())).toBe(240);
  });
});

describe('computeWorkedMinutesFromInstants', () => {
  // Mirrors the server's `computeWorkedMinutes`
  // (apps/api/src/domains/timesheet/services/timesheetCommandService.ts) —
  // this is the rule the clock-out sheet's live preview total must match.
  it('computes elapsed minutes minus a break', () => {
    const clockInAt = '2026-08-02T08:15:00.000Z';
    const nowMs = new Date('2026-08-02T17:29:00.000Z').getTime();
    // 08:15 -> 17:29 is 9h14m = 554 minutes, minus a 30 minute break.
    expect(computeWorkedMinutesFromInstants(clockInAt, nowMs, 30)).toBe(524);
  });

  it('matches computeEntryMinutes for the same inputs (same underlying rule)', () => {
    const clockInAt = '2026-08-01T07:58:00.000Z';
    const entry = makeEntry({ clock_in_at: clockInAt, break_minutes: 30 });
    const nowMs = new Date('2026-08-01T20:00:00.000Z').getTime();
    expect(computeWorkedMinutesFromInstants(clockInAt, nowMs, 30)).toBe(
      computeEntryMinutes({ ...entry, clock_out_at: null }, nowMs)
    );
  });

  it('clamps to 0 when the break is longer than the elapsed time — never negative', () => {
    const clockInAt = '2026-08-02T08:15:00.000Z';
    const nowMs = new Date('2026-08-02T08:20:00.000Z').getTime(); // 5 minutes elapsed
    expect(computeWorkedMinutesFromInstants(clockInAt, nowMs, 60)).toBe(0);
  });

  it('returns 0 for a break exactly equal to the elapsed time', () => {
    const clockInAt = '2026-08-02T08:15:00.000Z';
    const nowMs = new Date('2026-08-02T09:15:00.000Z').getTime(); // 60 minutes
    expect(computeWorkedMinutesFromInstants(clockInAt, nowMs, 60)).toBe(0);
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
