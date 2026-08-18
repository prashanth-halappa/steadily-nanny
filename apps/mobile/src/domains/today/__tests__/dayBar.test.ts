/**
 * @module domains/today/__tests__/dayBar
 *
 * The day bar is the coverage surface's one picture: today, left to right,
 * as who has it. Pure — the only inputs are today's shifts, the uncovered
 * windows and the local date, so it pins here without rendering anything.
 *
 * The filter is `COVERING_SHIFT_STATUSES`, the same one every other coverage
 * question uses: a pending ask is not cover, and painting it as cover would
 * be the "one card, one filter" contradiction in a new medium.
 */
import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindowDisplay } from '@/src/domains/schedule/utils/uncoveredDisplay';
import { buildDayBar } from '../hooks/useTodayCoverage';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ZONE = 'Europe/London';
const TODAY = '2026-08-10';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    starts_at: '2026-08-10T09:00:00.000Z',
    ends_at: '2026-08-10T17:00:00.000Z',
    timezone: ZONE,
    local_date: TODAY,
    kind: SHIFT_KINDS.RECURRING,
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'uid-1',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeWindow(startsAt: string, endsAt: string): UncoveredWindowDisplay {
  return {
    childId: CHILD_ID,
    commitmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    startsAt,
    endsAt,
    cause: 'nothingScheduled',
  };
}

describe('buildDayBar', () => {
  it("paints a nanny's shift as a nanny segment, in minutes", () => {
    const bar = buildDayBar([makeShift()], [], TODAY);

    expect(bar).toEqual([
      {
        kind: 'nanny',
        minutes: 8 * 60,
        startsAt: '2026-08-10T09:00:00.000Z',
      },
    ]);
  });

  // The parent who tapped "I've got it" must read as a different hue from
  // the nanny he booked — same cover, different person.
  it('paints parent cover as its own kind, never as a nanny', () => {
    const bar = buildDayBar(
      [
        makeShift({
          id: 'parent-cover-1',
          kind: SHIFT_KINDS.PARENT_COVER,
          carer_id: null,
          starts_at: '2026-08-10T13:00:00.000Z',
          ends_at: '2026-08-10T15:00:00.000Z',
        }),
      ],
      [],
      TODAY
    );

    expect(bar).toHaveLength(1);
    expect(bar[0]?.kind).toBe('parentCover');
    expect(bar[0]?.minutes).toBe(120);
  });

  it('lays the gaps out among the shifts, sorted by when they start', () => {
    const bar = buildDayBar(
      [
        makeShift({
          id: 'afternoon',
          starts_at: '2026-08-10T11:00:00.000Z',
          ends_at: '2026-08-10T17:00:00.000Z',
        }),
      ],
      [
        makeWindow('2026-08-10T17:00:00.000Z', '2026-08-10T18:00:00.000Z'),
        makeWindow('2026-08-10T09:00:00.000Z', '2026-08-10T11:00:00.000Z'),
      ],
      TODAY
    );

    expect(bar.map(segment => segment.kind)).toEqual(['gap', 'nanny', 'gap']);
    expect(bar.map(segment => segment.minutes)).toEqual([120, 360, 60]);
  });

  // Same filter as every other coverage question (`COVERING_SHIFT_STATUSES`):
  // a pending ask is not cover, so it must not paint over the gap that is
  // the whole reason the ask exists.
  it('paints neither a pending ask nor a declined one', () => {
    const bar = buildDayBar(
      [
        makeShift({ id: 'pending-1', status: 'pending' }),
        makeShift({ id: 'declined-1', status: 'declined' }),
        makeShift({ id: 'cancelled-1', status: 'cancelled' }),
      ],
      [],
      TODAY
    );

    expect(bar).toEqual([]);
  });

  it("ignores another day's shift entirely", () => {
    const bar = buildDayBar(
      [makeShift({ id: 'tomorrow-1', local_date: '2026-08-11' })],
      [],
      TODAY
    );

    expect(bar).toEqual([]);
  });
});
