/**
 * @module domains/timeOff/__tests__/busyConflict.test
 * D30 — overlap semantics for time-off vs anonymised busy blocks.
 */
import { describe, expect, it } from 'bun:test';
import type { AnonymisedBusyBlock } from '@steadily-nanny/shared-types/schemas/availability.schema';
import {
  findConflictingBusyBlocks,
  intervalsOverlap,
} from '../utils/busyConflict';

const RANGE_START = '2026-08-10T00:00:00.000Z';
const RANGE_END = '2026-08-13T00:00:00.000Z';

function block(
  overrides: Partial<AnonymisedBusyBlock> & Pick<AnonymisedBusyBlock, 'kind'>
): AnonymisedBusyBlock {
  return {
    starts_at: '2026-08-11T09:00:00.000Z',
    ends_at: '2026-08-11T17:00:00.000Z',
    ...overrides,
  };
}

describe('intervalsOverlap', () => {
  it('detects a partial overlap', () => {
    expect(
      intervalsOverlap(
        RANGE_START,
        RANGE_END,
        '2026-08-12T12:00:00.000Z',
        '2026-08-14T00:00:00.000Z'
      )
    ).toBe(true);
  });

  it('treats touching endpoints as non-overlapping', () => {
    expect(
      intervalsOverlap(
        RANGE_START,
        RANGE_END,
        '2026-08-13T00:00:00.000Z',
        '2026-08-14T00:00:00.000Z'
      )
    ).toBe(false);
    expect(
      intervalsOverlap(
        RANGE_START,
        RANGE_END,
        '2026-08-09T00:00:00.000Z',
        '2026-08-10T00:00:00.000Z'
      )
    ).toBe(false);
  });
});

describe('findConflictingBusyBlocks', () => {
  it('includes other_commitment and personal overlaps', () => {
    const conflicts = findConflictingBusyBlocks(RANGE_START, RANGE_END, [
      block({ kind: 'other_commitment' }),
      block({
        kind: 'personal',
        starts_at: '2026-08-12T10:00:00.000Z',
        ends_at: '2026-08-12T11:00:00.000Z',
      }),
    ]);
    expect(conflicts).toHaveLength(2);
  });

  it('ignores time_off even when ranges overlap', () => {
    const conflicts = findConflictingBusyBlocks(RANGE_START, RANGE_END, [
      block({ kind: 'time_off' }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it('ignores non-overlapping other_commitment blocks', () => {
    const conflicts = findConflictingBusyBlocks(RANGE_START, RANGE_END, [
      block({
        kind: 'other_commitment',
        starts_at: '2026-08-13T00:00:00.000Z',
        ends_at: '2026-08-13T08:00:00.000Z',
      }),
    ]);
    expect(conflicts).toEqual([]);
  });
});
