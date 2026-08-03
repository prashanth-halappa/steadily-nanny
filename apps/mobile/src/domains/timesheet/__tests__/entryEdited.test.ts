/**
 * Daylight UX P0-2 — a corrected pay figure must not be shown silently, and
 * the row must not offer an edit the server would refuse.
 */
import { describe, expect, it } from 'bun:test';
import type { TimeEntry } from '../types';
import { isEntryEditable, wasEntryEdited } from '../utils/entryEdited';

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 't1',
    household_id: 'h1',
    carer_id: 'c1',
    carer_display_name: 'Nia Rowe',
    shift_id: null,
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-03',
    timezone: 'Europe/London',
    created_at: '2026-08-03T08:00:00.000Z',
    updated_at: '2026-08-03T16:00:00.000Z',
    ...overrides,
  } as TimeEntry;
}

describe('wasEntryEdited', () => {
  it('is false for the clock-out write itself, which stamps both columns together', () => {
    expect(wasEntryEdited(makeEntry())).toBe(false);
    expect(
      wasEntryEdited(makeEntry({ updated_at: '2026-08-03T16:00:00.400Z' }))
    ).toBe(false);
  });

  it('is true once the record moved well after the clock-out', () => {
    expect(
      wasEntryEdited(makeEntry({ updated_at: '2026-08-04T09:12:00.000Z' }))
    ).toBe(true);
  });

  it('is false for a still-running entry — there is no clock-out to compare against', () => {
    expect(
      wasEntryEdited(makeEntry({ clock_out_at: null, status: 'running' }))
    ).toBe(false);
  });
});

describe('isEntryEditable', () => {
  it('allows a submitted entry in an unapproved week', () => {
    expect(isEntryEditable(makeEntry(), 'submitted')).toBe(true);
    expect(isEntryEditable(makeEntry(), 'queried')).toBe(true);
    expect(isEntryEditable(makeEntry(), null)).toBe(true);
  });

  it('refuses an approved week — that is a signed agreement, re-opened by the parent query flow', () => {
    expect(isEntryEditable(makeEntry(), 'approved')).toBe(false);
  });

  it('refuses a running entry — clocking out is its edit', () => {
    expect(isEntryEditable(makeEntry({ status: 'running' }), 'submitted')).toBe(
      false
    );
  });
});
