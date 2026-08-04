/**
 * @module domains/schedule/__tests__/timeOffOverlap.test
 */
import { describe, expect, it } from 'bun:test';
import {
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
