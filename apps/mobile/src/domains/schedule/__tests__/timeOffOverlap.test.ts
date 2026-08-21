/**
 * @module domains/schedule/__tests__/timeOffOverlap.test
 */
import { describe, expect, it } from 'bun:test';
import {
  shiftOverlapsTimeOff,
  timeOffCoversLocalDate,
  timeOffRowsForLocalDate,
} from '../utils/timeOffOverlap';

describe('timeOffOverlap', () => {
  it('covers local dates inside an exclusive [start, end) range in UTC', () => {
    const row = {
      starts_at: '2026-08-10T00:00:00.000Z',
      ends_at: '2026-08-12T00:00:00.000Z',
      status: 'confirmed' as const,
    };
    expect(timeOffCoversLocalDate(row, '2026-08-10', 'UTC')).toBe(true);
    expect(timeOffCoversLocalDate(row, '2026-08-11', 'UTC')).toBe(true);
    expect(timeOffCoversLocalDate(row, '2026-08-12', 'UTC')).toBe(false);
  });

  it('uses household-local midnight bounds (London BST)', () => {
    // Away Aug 10–11 London: ends at local midnight starting Aug 12 (= 23:00Z).
    const row = {
      starts_at: '2026-08-09T23:00:00.000Z',
      ends_at: '2026-08-11T23:00:00.000Z',
      status: 'confirmed' as const,
    };
    expect(timeOffCoversLocalDate(row, '2026-08-10', 'Europe/London')).toBe(
      true
    );
    expect(timeOffCoversLocalDate(row, '2026-08-11', 'Europe/London')).toBe(
      true
    );
    expect(timeOffCoversLocalDate(row, '2026-08-12', 'Europe/London')).toBe(
      false
    );
  });

  it('ignores cancelled rows', () => {
    expect(
      timeOffRowsForLocalDate(
        [
          {
            starts_at: '2026-08-10T00:00:00.000Z',
            ends_at: '2026-08-12T00:00:00.000Z',
            status: 'cancelled',
            id: '1',
          } as never,
        ],
        '2026-08-10',
        'UTC'
      )
    ).toHaveLength(0);
  });
});

describe('shiftOverlapsTimeOff', () => {
  const carerId = 'carer-1';
  const timeOffRow = {
    id: 'row-1',
    user_id: carerId,
    starts_at: '2026-08-21T00:00:00.000Z',
    ends_at: '2026-08-24T00:00:00.000Z',
    all_day: true,
    status: 'confirmed',
  } as never;

  it('flags a shift fully inside an accepted time-off window', () => {
    const shift = {
      carer_id: carerId,
      starts_at: '2026-08-21T09:00:00.000Z',
      ends_at: '2026-08-21T17:00:00.000Z',
    };
    expect(shiftOverlapsTimeOff(shift, [timeOffRow])).toBe(true);
  });

  it('flags a shift that only partially overlaps the window', () => {
    const shift = {
      carer_id: carerId,
      // Starts a day before the time off and ends inside it.
      starts_at: '2026-08-20T09:00:00.000Z',
      ends_at: '2026-08-21T02:00:00.000Z',
    };
    expect(shiftOverlapsTimeOff(shift, [timeOffRow])).toBe(true);
  });

  it('does not flag a shift on an adjacent day outside the window', () => {
    const shift = {
      carer_id: carerId,
      starts_at: '2026-08-25T09:00:00.000Z',
      ends_at: '2026-08-25T17:00:00.000Z',
    };
    expect(shiftOverlapsTimeOff(shift, [timeOffRow])).toBe(false);
  });

  it('flags a shift inside an all-day time-off row', () => {
    // `timeOffRow` above is already `all_day: true` — a shift landing on
    // the middle day of the window still needs to be flagged.
    const shift = {
      carer_id: carerId,
      starts_at: '2026-08-22T09:00:00.000Z',
      ends_at: '2026-08-22T17:00:00.000Z',
    };
    expect(shiftOverlapsTimeOff(shift, [timeOffRow])).toBe(true);
  });

  it('does not flag a shift when the time off belongs to a different carer', () => {
    const shift = {
      carer_id: 'carer-2',
      starts_at: '2026-08-21T09:00:00.000Z',
      ends_at: '2026-08-21T17:00:00.000Z',
    };
    expect(shiftOverlapsTimeOff(shift, [timeOffRow])).toBe(false);
  });
});
