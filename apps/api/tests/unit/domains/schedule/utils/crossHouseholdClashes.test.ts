/**
 * `findCrossHouseholdClashes` — the pure sweep-line the S4b nightly job
 * (`scheduleHorizonJob.sweepCrossHouseholdClashes`) runs over every live,
 * carer-assigned shift in the scan window. Advisory only (never a 409, see
 * `domains/me/services/clashWarning.ts`'s module header) — this function's
 * only job is deciding WHICH pairs clash and building the two anonymised
 * `cross_family_clash` events each pair raises, one per household.
 */
import { describe, expect, it } from 'bun:test';
import type { ClashScanShift } from '../../../../../src/domains/schedule/utils/crossHouseholdClashes';
import { findCrossHouseholdClashes } from '../../../../../src/domains/schedule/utils/crossHouseholdClashes';

function shift(
  overrides: Partial<ClashScanShift> & { id: string }
): ClashScanShift {
  return {
    household_id: 'hh-a',
    carer_id: 'carer-1',
    starts_at: '2026-08-10T13:00:00.000Z',
    ends_at: '2026-08-10T17:00:00.000Z',
    local_date: '2026-08-10',
    ical_uid: `uid-${overrides.id}`,
    ...overrides,
  };
}

describe('findCrossHouseholdClashes', () => {
  it('emits no clash for two touching windows ([) adjacency)', () => {
    const a = shift({
      id: 's1',
      household_id: 'hh-a',
      starts_at: '2026-08-10T09:00:00.000Z',
      ends_at: '2026-08-10T13:00:00.000Z',
    });
    const b = shift({
      id: 's2',
      household_id: 'hh-b',
      starts_at: '2026-08-10T13:00:00.000Z',
      ends_at: '2026-08-10T17:00:00.000Z',
    });

    expect(findCrossHouseholdClashes([a, b])).toEqual([]);
  });

  it('ignores an overlap between two shifts in the SAME household', () => {
    const a = shift({
      id: 's1',
      household_id: 'hh-a',
      starts_at: '2026-08-10T09:00:00.000Z',
      ends_at: '2026-08-10T14:00:00.000Z',
    });
    const b = shift({
      id: 's2',
      household_id: 'hh-a',
      starts_at: '2026-08-10T13:00:00.000Z',
      ends_at: '2026-08-10T17:00:00.000Z',
    });

    expect(findCrossHouseholdClashes([a, b])).toEqual([]);
  });

  it('ignores an overlap between two DIFFERENT carers', () => {
    const a = shift({
      id: 's1',
      household_id: 'hh-a',
      carer_id: 'carer-1',
      starts_at: '2026-08-10T09:00:00.000Z',
      ends_at: '2026-08-10T14:00:00.000Z',
    });
    const b = shift({
      id: 's2',
      household_id: 'hh-b',
      carer_id: 'carer-2',
      starts_at: '2026-08-10T13:00:00.000Z',
      ends_at: '2026-08-10T17:00:00.000Z',
    });

    expect(findCrossHouseholdClashes([a, b])).toEqual([]);
  });

  it('emits TWO events — one per household — for an overlapping cross-household pair, naming the other side only by opaque ical_uid', () => {
    const a = shift({
      id: 's1',
      household_id: 'hh-a',
      starts_at: '2026-08-10T09:00:00.000Z',
      ends_at: '2026-08-10T14:00:00.000Z',
      local_date: '2026-08-10',
      ical_uid: 'uid-s1',
    });
    const b = shift({
      id: 's2',
      household_id: 'hh-b',
      starts_at: '2026-08-10T13:00:00.000Z',
      ends_at: '2026-08-10T18:00:00.000Z',
      local_date: '2026-08-10',
      ical_uid: 'uid-s2',
    });

    const events = findCrossHouseholdClashes([a, b]);

    expect(events).toHaveLength(2);
    const forA = events.find(e => e.household_id === 'hh-a');
    const forB = events.find(e => e.household_id === 'hh-b');
    expect(forA).toEqual({
      household_id: 'hh-a',
      shift_id: 's1',
      local_date: '2026-08-10',
      actor_id: null,
      event_type: 'cross_family_clash',
      payload: {
        key: 's1|uid-s2',
        kind: 'other_commitment',
        other_source_uid: 'uid-s2',
        other_starts_at: b.starts_at,
        other_ends_at: b.ends_at,
      },
    });
    expect(forB).toEqual({
      household_id: 'hh-b',
      shift_id: 's2',
      local_date: '2026-08-10',
      actor_id: null,
      event_type: 'cross_family_clash',
      payload: {
        key: 's2|uid-s1',
        kind: 'other_commitment',
        other_source_uid: 'uid-s1',
        other_starts_at: a.starts_at,
        other_ends_at: a.ends_at,
      },
    });
    // Privacy discipline (016_calendar_seams.sql): no household id/name of
    // the OTHER family anywhere in either payload.
    expect(JSON.stringify(forA)).not.toContain('hh-b');
    expect(JSON.stringify(forB)).not.toContain('hh-a');
  });

  it('is keyed per shift so the same pair produces a stable, idempotent key across re-sweeps', () => {
    const a = shift({ id: 's1', household_id: 'hh-a', ical_uid: 'uid-s1' });
    const b = shift({
      id: 's2',
      household_id: 'hh-b',
      ical_uid: 'uid-s2',
      starts_at: '2026-08-10T15:00:00.000Z',
      ends_at: '2026-08-10T19:00:00.000Z',
    });

    const first = findCrossHouseholdClashes([a, b]);
    const second = findCrossHouseholdClashes([a, b]);
    expect(first.map(e => e.payload.key)).toEqual(
      second.map(e => e.payload.key)
    );
  });

  it('scopes the sweep-line per carer — an empty carer group produces no events', () => {
    expect(findCrossHouseholdClashes([])).toEqual([]);
  });
});
