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

describe('wasEntryEdited — a session the server split at midnight (C6)', () => {
  // The API splits a Sunday->Monday session into two rows. The FIRST keeps
  // its id and has `clock_out_at` rewritten back to local midnight, while
  // `updated_at` records the real clock-out hours later. Nobody edited it.
  it('is false for the first fragment of a BST split session', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          clock_in_at: '2026-08-09T22:00:00.000Z', // Sun 23:00 London
          clock_out_at: '2026-08-09T23:00:00.000Z', // Mon 00:00 London
          updated_at: '2026-08-10T01:00:00.000Z', // she really stopped at 02:00
        })
      )
    ).toBe(false);
  });

  it('is false for the first fragment of a GMT split session', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          clock_in_at: '2026-01-11T23:00:00.000Z', // Sun 23:00 London
          clock_out_at: '2026-01-12T00:00:00.000Z', // Mon 00:00 London
          updated_at: '2026-01-12T02:00:00.000Z',
        })
      )
    ).toBe(false);
  });

  it("reads midnight in the ENTRY's own zone, not UTC", () => {
    // Midnight UTC is 20:00 the previous evening in New York — an ordinary
    // finish, so a record that moved hours later really was edited.
    expect(
      wasEntryEdited(
        makeEntry({
          timezone: 'America/New_York',
          clock_in_at: '2026-08-09T20:00:00.000Z',
          clock_out_at: '2026-08-10T00:00:00.000Z', // Sun 20:00 New York
          updated_at: '2026-08-10T03:00:00.000Z',
        })
      )
    ).toBe(true);
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

describe('wasEntryEdited — a retroactive entry is not an edited one', () => {
  // Forgotten-clock-in recovery lands complete in ONE insert, so its
  // clock-out is already in the past when the row is born. Comparing
  // `updated_at` to it says "edited" from birth, on a row nobody touched.
  const retro = {
    clock_in_at: '2026-08-01T08:00:00.000Z',
    clock_out_at: '2026-08-01T16:00:00.000Z',
    created_at: '2026-08-03T19:30:00.000Z',
    updated_at: '2026-08-03T19:30:00.000Z',
  };

  it('is false for a retro entry filed days after the hours', () => {
    expect(wasEntryEdited(makeEntry(retro))).toBe(false);
  });

  it('is true once that retro entry is genuinely corrected', () => {
    expect(
      wasEntryEdited(
        makeEntry({ ...retro, updated_at: '2026-08-03T19:35:00.000Z' })
      )
    ).toBe(true);
  });

  it('stays false for an ordinary session, whose row is born at clock-IN', () => {
    // The pin against "compare to created_at instead": an ordinary entry is
    // inserted when she clocks in and updated when she clocks out, so its
    // two timestamps are a whole shift apart with nothing edited at all.
    expect(
      wasEntryEdited(
        makeEntry({
          created_at: '2026-08-01T08:00:00.000Z',
          updated_at: '2026-08-01T16:00:00.000Z',
        })
      )
    ).toBe(false);
  });
});
