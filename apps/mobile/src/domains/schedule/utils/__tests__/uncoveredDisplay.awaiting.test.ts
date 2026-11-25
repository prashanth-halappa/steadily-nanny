/**
 * @module domains/schedule/utils/__tests__/uncoveredDisplay.awaiting.test
 *
 * `splitAwaiting` — the part of an uncovered window the parent has already
 * asked about (pending one-off shift, or a pending weekly pattern) is not
 * "Not booked yet". Interval-level: only the asked-about slice moves; the
 * residual pieces stay unbooked. Display only — the detector (S1) still
 * calls the whole window uncovered.
 */
import { describe, expect, it } from 'bun:test';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { computeUncovered } from '@steadily-nanny/shared-types/uncoveredCare';
import { type AwaitingPattern, splitAwaiting } from '../uncoveredDisplay';
import { toNeedWindow } from '../uncoveredWeek';

const CHILD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_CHILD = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const COMMITMENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
// Monday 3 Aug 2026, New York (UTC-4): local 07:00 = 11:00Z.
const LOCAL_DATE = '2026-08-03';
const TZ = 'America/New_York';
const MONDAY = 1;

const commitment = {
  id: COMMITMENT,
  child_id: CHILD,
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  start_time: '07:00:00',
  end_time: '13:00:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
} as unknown as ChildCommitment;

/** A piece of the 07:00–13:00 need, by UTC hour. */
const piece = (startZ: number, endZ: number) => ({
  childId: CHILD,
  commitmentId: COMMITMENT,
  startsAt: `2026-08-03T${String(startZ).padStart(2, '0')}:00:00.000Z`,
  endsAt: `2026-08-03T${String(endZ).padStart(2, '0')}:00:00.000Z`,
});

function makeShift(
  status: Shift['status'],
  startZ: number,
  endZ: number
): Shift {
  const { startsAt, endsAt } = piece(startZ, endZ);
  return {
    id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    carer_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    kind: 'extra',
    status,
    starts_at: startsAt,
    ends_at: endsAt,
    local_date: LOCAL_DATE,
    shift_children: [],
  } as unknown as Shift;
}

function makePattern(
  weekday: number,
  start: string,
  end: string,
  children: AwaitingPattern['days'][number]['children'] = []
): AwaitingPattern {
  return {
    dtstart: '2026-01-01',
    until: null,
    timezone: TZ,
    days: [{ weekday, start_time: start, end_time: end, children }],
  };
}

/** The S1 windows the screen already has: pending is NOT cover there. */
function split(shifts: Shift[], pattern: AwaitingPattern | null) {
  const windows = computeUncovered({
    localDate: LOCAL_DATE,
    timezone: TZ,
    needWindows: [toNeedWindow(commitment)],
    shifts: [],
    closures: [],
  });
  return splitAwaiting({
    windows,
    localDate: LOCAL_DATE,
    timezone: TZ,
    commitments: [commitment],
    shifts,
    closures: [],
    pendingPattern: pattern,
  });
}

describe('splitAwaiting', () => {
  it('a partial pending shift leaves both residual pieces unbooked', () => {
    // Need 07–13 local; pending shift 08–11 local (12–15Z). The shift row
    // itself says Pending, so no awaiting piece is emitted for it.
    expect(split([makeShift('pending', 12, 15)], null)).toEqual({
      unbooked: [piece(11, 12), piece(15, 17)],
      awaiting: [],
    });
  });

  it('a pending shift over the whole need leaves nothing unbooked', () => {
    expect(split([makeShift('pending', 11, 17)], null)).toEqual({
      unbooked: [],
      awaiting: [],
    });
  });

  it('a partial pattern block gives a clipped awaiting piece plus unbooked residuals', () => {
    // Block 09–12 local = 13–16Z.
    expect(split([], makePattern(MONDAY, '09:00:00', '12:00:00'))).toEqual({
      unbooked: [piece(11, 13), piece(16, 17)],
      awaiting: [piece(13, 16)],
    });
  });

  it('narrows a pattern block to its per-child times', () => {
    const pattern = makePattern(MONDAY, '07:00:00', '13:00:00', [
      { child_id: CHILD, start_time: '10:00:00', end_time: '11:00:00' },
    ]);
    expect(split([], pattern)).toEqual({
      unbooked: [piece(11, 14), piece(15, 17)],
      awaiting: [piece(14, 15)],
    });
  });

  it('a pattern block for a different child leaves the window unbooked', () => {
    const pattern = makePattern(MONDAY, '07:00:00', '13:00:00', [
      { child_id: OTHER_CHILD, start_time: null, end_time: null },
    ]);
    expect(split([], pattern)).toEqual({
      unbooked: [piece(11, 17)],
      awaiting: [],
    });
  });

  it('a pattern block on a different weekday, or before dtstart, does nothing', () => {
    expect(split([], makePattern(MONDAY + 1, '07:00:00', '13:00:00'))).toEqual({
      unbooked: [piece(11, 17)],
      awaiting: [],
    });
    const notYet = {
      ...makePattern(MONDAY, '07:00:00', '13:00:00'),
      dtstart: '2026-09-01',
    };
    expect(split([], notYet)).toEqual({
      unbooked: [piece(11, 17)],
      awaiting: [],
    });
  });
});
