/**
 * @module domains/schedule/utils/__tests__/windowSlices.test
 *
 * `windowSlices` — the rest of a remainder card's need window (A1): which
 * other parts of the window are asked about, booked, or parent-covered.
 */
import { describe, expect, it } from 'bun:test';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type AwaitingPattern, windowSlices } from '../uncoveredDisplay';

const CHILD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_CHILD = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const COMMITMENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CARER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
// Monday 3 Aug 2026, New York (UTC-4): local 07:00 = 11:00Z.
const LOCAL_DATE = '2026-08-03';
const TZ = 'America/New_York';

const commitment = {
  id: COMMITMENT,
  child_id: CHILD,
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  start_time: '07:00:00',
  end_time: '09:00:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
} as unknown as ChildCommitment;

const z = (h: number, m = 0) =>
  `2026-08-03T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

// Remainder 07:00–08:00 local.
const remainder = {
  childId: CHILD,
  commitmentId: COMMITMENT,
  startsAt: z(11),
  endsAt: z(12),
};

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    carer_id: CARER,
    kind: 'extra',
    status: 'pending',
    starts_at: z(12),
    ends_at: z(13),
    local_date: LOCAL_DATE,
    shift_children: [],
    ...overrides,
  } as unknown as Shift;
}

function slices(
  shifts: Shift[],
  pendingPattern:
    | (AwaitingPattern & { carer_id?: string | null })
    | null = null,
  rem = remainder
) {
  return windowSlices({
    remainder: rem,
    commitments: [commitment],
    shifts,
    pendingPattern,
    localDate: LOCAL_DATE,
    timezone: TZ,
  });
}

describe('windowSlices', () => {
  it('partial pending: a pending shift 8–9 is a pending slice with its carer', () => {
    expect(slices([makeShift()])).toEqual({
      needStart: z(11),
      needEnd: z(13),
      slices: [
        { kind: 'pending', startsAt: z(12), endsAt: z(13), carerId: CARER },
      ],
    });
  });

  it('partial coverage: confirmed and completed shifts are confirmed slices', () => {
    const result = slices([
      makeShift({ status: 'completed', starts_at: z(12, 30), ends_at: z(14) }),
      makeShift({ status: 'confirmed', starts_at: z(12), ends_at: z(12, 30) }),
    ]);
    expect(result.slices).toEqual([
      { kind: 'confirmed', startsAt: z(12), endsAt: z(12, 30), carerId: CARER },
      // Clipped to the need window's end.
      { kind: 'confirmed', startsAt: z(12, 30), endsAt: z(13), carerId: CARER },
    ]);
  });

  it('parent cover is a parentCover slice with no carer', () => {
    const result = slices([
      makeShift({
        kind: 'parent_cover',
        status: 'confirmed',
        carer_id: null,
        starts_at: z(12, 30),
      }),
    ]);
    expect(result.slices).toEqual([
      {
        kind: 'parentCover',
        startsAt: z(12, 30),
        endsAt: z(13),
        carerId: null,
      },
    ]);
  });

  it('a pending-pattern block is a pending slice (carer from the pattern when it has one)', () => {
    const pattern: AwaitingPattern = {
      dtstart: '2026-01-01',
      until: null,
      timezone: TZ,
      days: [
        {
          weekday: 1,
          start_time: '08:00:00',
          end_time: '10:00:00',
          children: [],
        },
      ],
    };
    expect(slices([], pattern).slices).toEqual([
      { kind: 'pending', startsAt: z(12), endsAt: z(13), carerId: null },
    ]);
    expect(slices([], { ...pattern, carer_id: CARER }).slices).toEqual([
      { kind: 'pending', startsAt: z(12), endsAt: z(13), carerId: CARER },
    ]);
  });

  it('a pattern block for a different child is ignored', () => {
    const pattern: AwaitingPattern = {
      dtstart: '2026-01-01',
      until: null,
      timezone: TZ,
      days: [
        {
          weekday: 1,
          start_time: '08:00:00',
          end_time: '10:00:00',
          children: [
            { child_id: OTHER_CHILD, start_time: null, end_time: null },
          ],
        },
      ],
    };
    expect(slices([], pattern).slices).toEqual([]);
  });

  it('a shift for a different child is ignored; per-child times narrow the slice', () => {
    const result = slices([
      makeShift({
        status: 'confirmed',
        shift_children: [
          { child_id: OTHER_CHILD, starts_at: null, ends_at: null },
        ] as unknown as Shift['shift_children'],
      }),
      makeShift({
        status: 'pending',
        shift_children: [
          { child_id: CHILD, starts_at: z(12, 15), ends_at: null },
        ] as unknown as Shift['shift_children'],
      }),
    ]);
    expect(result.slices).toEqual([
      { kind: 'pending', startsAt: z(12, 15), endsAt: z(13), carerId: CARER },
    ]);
  });

  it('cancelled, declined and draft shifts are ignored', () => {
    expect(
      slices([
        makeShift({ status: 'cancelled' }),
        makeShift({ status: 'declined' }),
        makeShift({ status: 'draft' }),
      ]).slices
    ).toEqual([]);
  });

  it('a slice overlapping the remainder is dropped (guard)', () => {
    expect(
      slices([makeShift({ status: 'pending', starts_at: z(11, 30) })]).slices
    ).toEqual([]);
  });

  it('no other slices in the window gives slices: []', () => {
    expect(slices([])).toEqual({
      needStart: z(11),
      needEnd: z(13),
      slices: [],
    });
  });

  it('no containing need window falls back to the remainder itself', () => {
    const stray = {
      childId: OTHER_CHILD,
      commitmentId: COMMITMENT,
      startsAt: z(11),
      endsAt: z(12),
    };
    expect(slices([makeShift()], null, stray)).toEqual({
      needStart: z(11),
      needEnd: z(12),
      slices: [],
    });
  });
});
