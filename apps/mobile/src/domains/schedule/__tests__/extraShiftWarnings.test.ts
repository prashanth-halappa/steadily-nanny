/**
 * @module domains/schedule/__tests__/extraShiftWarnings.test
 */
import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  collectExtraShiftWarnings,
  primaryExtraShiftWarning,
} from '../utils/extraShiftWarnings';

const CARER_A = '55555555-5555-4555-8555-555555555555';
const CARER_B = '66666666-6666-4666-8666-666666666666';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: '11111111-1111-4111-8111-111111111111',
    carer_id: CARER_A,
    starts_at: '2026-08-10T09:00:00.000Z',
    ends_at: '2026-08-10T17:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-08-10',
    kind: 'recurring',
    status: SHIFT_STATUSES.CONFIRMED,
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

const BASE = {
  startsAt: '2026-08-10T10:00:00.000Z',
  endsAt: '2026-08-10T18:00:00.000Z',
  nowIso: '2026-08-10T08:00:00.000Z',
  carerId: CARER_A,
  shifts: [] as Shift[],
  busyBlocks: [] as never[],
};

describe('collectExtraShiftWarnings', () => {
  it('flags a past start time', () => {
    const result = collectExtraShiftWarnings({
      ...BASE,
      startsAt: '2026-08-10T07:00:00.000Z',
      nowIso: '2026-08-10T08:00:00.000Z',
    });
    expect(result.sameCarerConflict).toBeNull();
    expect(result.warnings).toContain('past');
  });

  it('flags household overlap when another carer has an overlapping shift', () => {
    const result = collectExtraShiftWarnings({
      ...BASE,
      shifts: [
        makeShift({
          id: 'other',
          carer_id: CARER_B,
          starts_at: '2026-08-10T09:00:00.000Z',
          ends_at: '2026-08-10T17:00:00.000Z',
        }),
      ],
    });
    expect(result.sameCarerConflict).toBeNull();
    expect(result.warnings).toContain('householdOverlap');
  });

  it('returns sameCarerConflict instead of householdOverlap for the same carer', () => {
    const existing = makeShift({
      id: 'mine',
      carer_id: CARER_A,
      starts_at: '2026-08-10T09:00:00.000Z',
      ends_at: '2026-08-10T17:00:00.000Z',
    });
    const result = collectExtraShiftWarnings({
      ...BASE,
      shifts: [existing],
    });
    expect(result.sameCarerConflict?.id).toBe('mine');
    expect(result.warnings).not.toContain('householdOverlap');
  });

  it('ignores cancelled and declined shifts', () => {
    const result = collectExtraShiftWarnings({
      ...BASE,
      shifts: [
        makeShift({
          id: 'cancelled',
          carer_id: CARER_A,
          status: SHIFT_STATUSES.CANCELLED,
        }),
        makeShift({
          id: 'declined',
          carer_id: CARER_B,
          status: SHIFT_STATUSES.DECLINED,
        }),
      ],
    });
    expect(result.sameCarerConflict).toBeNull();
    expect(result.warnings).not.toContain('householdOverlap');
  });

  it('does not treat touching endpoints as an overlap (half-open)', () => {
    const result = collectExtraShiftWarnings({
      ...BASE,
      startsAt: '2026-08-10T17:00:00.000Z',
      endsAt: '2026-08-10T21:00:00.000Z',
      shifts: [
        makeShift({
          id: 'earlier',
          carer_id: CARER_B,
          starts_at: '2026-08-10T09:00:00.000Z',
          ends_at: '2026-08-10T17:00:00.000Z',
        }),
      ],
    });
    expect(result.sameCarerConflict).toBeNull();
    expect(result.warnings).not.toContain('householdOverlap');
  });

  it('flags busy when a conflicting busy block overlaps', () => {
    const result = collectExtraShiftWarnings({
      ...BASE,
      busyBlocks: [
        {
          starts_at: '2026-08-10T14:00:00.000Z',
          ends_at: '2026-08-10T18:00:00.000Z',
          kind: 'other_commitment',
        },
      ],
    });
    expect(result.warnings).toContain('busy');
  });
});

describe('primaryExtraShiftWarning', () => {
  it('ranks past over householdOverlap over busy', () => {
    // The dialog shows ONE title, so this order is what the parent reads when
    // a shift is both in the past and on top of somebody.
    expect(primaryExtraShiftWarning(['busy', 'householdOverlap', 'past'])).toBe(
      'past'
    );
    expect(primaryExtraShiftWarning(['busy', 'householdOverlap'])).toBe(
      'householdOverlap'
    );
    expect(primaryExtraShiftWarning(['busy'])).toBe('busy');
    expect(primaryExtraShiftWarning([])).toBeNull();
  });
});

describe('a past start is compared as an instant, not as text', () => {
  it('reads an offset-spelled now the same as a Z-spelled one', () => {
    const offsetNow = collectExtraShiftWarnings({
      ...BASE,
      startsAt: '2026-08-10T07:00:00.000Z',
      nowIso: '2026-08-10T08:00:00+00:00',
    });
    expect(offsetNow.warnings).toContain('past');
  });
});
