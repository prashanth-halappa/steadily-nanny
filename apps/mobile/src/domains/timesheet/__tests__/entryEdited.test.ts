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

  it('refuses a voided entry — voiding is final', () => {
    expect(isEntryEditable(makeEntry({ status: 'voided' }), 'submitted')).toBe(
      false
    );
  });
});

describe('wasEntryEdited — voiding bumps updated_at but is not a correction', () => {
  it('is false for a voided entry even when updated_at moved well after clock-out', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          status: 'voided',
          updated_at: '2026-08-04T09:12:00.000Z',
        })
      )
    ).toBe(false);
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

/**
 * Migration 113 — the marker stops guessing from `updated_at` and compares
 * what the app WATCHED against what is EFFECTIVE. The null cases are the
 * whole risk: four shapes carry a null observation and none of them is a
 * correction.
 */
describe('wasEntryEdited — against the observed pair (113)', () => {
  const OBSERVED_IN = '2026-08-03T08:00:00.000Z';
  const OBSERVED_OUT = '2026-08-03T16:00:00.000Z';

  it('is false when both ends still match what was observed', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          observed_clock_in_at: OBSERVED_IN,
          observed_clock_out_at: OBSERVED_OUT,
        })
      )
    ).toBe(false);
  });

  it('still catches a break-or-note-only change, which moves no clock time', () => {
    // Both observations match, so the exact comparison says nothing — and it
    // must not, because she did change the record. This is the one thing the
    // `updated_at` fallback is still here for.
    expect(
      wasEntryEdited(
        makeEntry({
          observed_clock_in_at: OBSERVED_IN,
          observed_clock_out_at: OBSERVED_OUT,
          break_minutes: 30,
          updated_at: '2026-08-05T09:00:00.000Z',
        })
      )
    ).toBe(true);
  });

  it('is true when she corrected the start', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          clock_in_at: '2026-08-03T07:40:00.000Z',
          observed_clock_in_at: OBSERVED_IN,
          observed_clock_out_at: OBSERVED_OUT,
        })
      )
    ).toBe(true);
  });

  it('is true when a forgotten clock-out declared a finish the app never saw', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          clock_out_at: '2026-08-03T17:00:00.000Z',
          observed_clock_in_at: OBSERVED_IN,
          // She tapped the next morning; effective is what she left at.
          observed_clock_out_at: '2026-08-04T07:12:00.000Z',
        })
      )
    ).toBe(true);
  });

  it('is false for a retroactive entry, which the app never watched at all', () => {
    // Born complete and hours after the fact — the exact shape `updated_at`
    // alone would brand as edited from birth.
    expect(
      wasEntryEdited(
        makeEntry({
          observed_clock_in_at: null,
          observed_clock_out_at: null,
          created_at: '2026-08-03T18:00:00.000Z',
          updated_at: '2026-08-03T18:00:00.000Z',
        })
      )
    ).toBe(false);
  });

  it('is false for the boundary half of a split session, whose finish is unobserved by design', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          clock_in_at: '2026-08-09T22:00:00.000Z', // Sun 23:00 London
          clock_out_at: '2026-08-09T23:00:00.000Z', // Mon 00:00 London
          observed_clock_in_at: '2026-08-09T22:00:00.000Z',
          // Closed at a computed boundary, not a tap.
          observed_clock_out_at: null,
          updated_at: '2026-08-10T01:00:00.000Z',
        })
      )
    ).toBe(false);
  });

  it('still says nothing about a voided row', () => {
    expect(
      wasEntryEdited(
        makeEntry({
          status: 'voided',
          clock_in_at: '2026-08-03T07:40:00.000Z',
          observed_clock_in_at: OBSERVED_IN,
        })
      )
    ).toBe(false);
  });
});
