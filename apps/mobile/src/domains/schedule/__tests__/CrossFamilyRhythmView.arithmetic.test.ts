/**
 * @module domains/schedule/__tests__/CrossFamilyRhythmView.arithmetic.test
 *
 * Pure-function tests for the grid rebuild's two headline numbers — the
 * per-family "N days with this family" count and the joint "N clashes"
 * count. Both are sentences a nanny reads as fact before she ever looks at
 * the grid, so a silently wrong number here is worse than a wrong pixel.
 * No rendering needed: these are plain functions over a slot index.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildSlotIndex,
  countClashDays,
  countWorkingDays,
  householdColourIndex,
  isClashSlot,
  isFilledSlot,
  type RhythmWorkSlot,
  slotsFromShifts,
} from '../components/CrossFamilyRhythmView';

const HH_A = 'household-a';
const HH_B = 'household-b';
const DATES = ['2026-08-03', '2026-08-04', '2026-08-05'];

function slot(
  householdId: string,
  date: string,
  period: RhythmWorkSlot['period']
): RhythmWorkSlot {
  return { householdId, date, period };
}

describe('buildSlotIndex / isFilledSlot', () => {
  it('marks a household filled only for the slot it actually has', () => {
    const index = buildSlotIndex([slot(HH_A, DATES[0]!, 'morning')]);
    expect(isFilledSlot(index, HH_A, DATES[0]!, 'morning')).toBe(true);
    expect(isFilledSlot(index, HH_A, DATES[0]!, 'afternoon')).toBe(false);
    expect(isFilledSlot(index, HH_B, DATES[0]!, 'morning')).toBe(false);
  });
});

describe('isClashSlot', () => {
  it('is false when only one household occupies the slot', () => {
    const index = buildSlotIndex([slot(HH_A, DATES[0]!, 'morning')]);
    expect(isClashSlot(index, DATES[0]!, 'morning')).toBe(false);
  });

  it('is true only when TWO households occupy the exact same date+period', () => {
    const index = buildSlotIndex([
      slot(HH_A, DATES[0]!, 'morning'),
      slot(HH_B, DATES[0]!, 'morning'),
    ]);
    expect(isClashSlot(index, DATES[0]!, 'morning')).toBe(true);
  });

  it('is false when both households work the same DAY but different periods', () => {
    const index = buildSlotIndex([
      slot(HH_A, DATES[0]!, 'morning'),
      slot(HH_B, DATES[0]!, 'afternoon'),
    ]);
    expect(isClashSlot(index, DATES[0]!, 'morning')).toBe(false);
    expect(isClashSlot(index, DATES[0]!, 'afternoon')).toBe(false);
  });
});

describe('countWorkingDays', () => {
  it('counts DISTINCT DATES, not slots — two periods on the same day is one day', () => {
    const index = buildSlotIndex([
      slot(HH_A, DATES[0]!, 'morning'),
      slot(HH_A, DATES[0]!, 'evening'),
      slot(HH_A, DATES[1]!, 'afternoon'),
    ]);
    expect(countWorkingDays(index, HH_A, DATES)).toBe(2);
  });

  it('is 0 for a household with nothing in the window', () => {
    const index = buildSlotIndex([slot(HH_A, DATES[0]!, 'morning')]);
    expect(countWorkingDays(index, HH_B, DATES)).toBe(0);
  });

  it('only counts dates inside the given window', () => {
    const index = buildSlotIndex([
      slot(HH_A, DATES[0]!, 'morning'),
      slot(HH_A, '2099-01-01', 'morning'), // outside DATES
    ]);
    expect(countWorkingDays(index, HH_A, DATES)).toBe(1);
  });
});

describe('countClashDays', () => {
  it('counts distinct clash DATES, deduping across periods on the same day', () => {
    const index = buildSlotIndex([
      slot(HH_A, DATES[0]!, 'morning'),
      slot(HH_B, DATES[0]!, 'morning'),
      slot(HH_A, DATES[0]!, 'evening'),
      slot(HH_B, DATES[0]!, 'evening'),
    ]);
    expect(countClashDays(index, DATES)).toBe(1);
  });

  it('is 0 when nobody overlaps', () => {
    const index = buildSlotIndex([
      slot(HH_A, DATES[0]!, 'morning'),
      slot(HH_B, DATES[1]!, 'morning'),
    ]);
    expect(countClashDays(index, DATES)).toBe(0);
  });

  it('counts each clashing day once even with a third household in the window', () => {
    const index = buildSlotIndex([
      slot(HH_A, DATES[0]!, 'morning'),
      slot(HH_B, DATES[0]!, 'morning'),
      slot('household-c', DATES[0]!, 'morning'),
      slot(HH_A, DATES[1]!, 'afternoon'),
      slot(HH_B, DATES[2]!, 'evening'),
    ]);
    expect(countClashDays(index, DATES)).toBe(1);
  });
});

describe('slotsFromShifts', () => {
  it('excludes a cancelled shift — it is not real cover for either family', () => {
    const slots = slotsFromShifts(
      [
        {
          household_id: HH_A,
          local_date: DATES[0]!,
          starts_at: '2026-08-03T09:00:00.000Z',
          status: 'cancelled',
        } as never,
      ],
      () => 'UTC'
    );
    expect(slots).toEqual([]);
  });

  it('derives the period from starts_at in the shift household own timezone', () => {
    const slots = slotsFromShifts(
      [
        {
          household_id: HH_A,
          local_date: DATES[0]!,
          starts_at: '2026-08-03T09:00:00.000Z', // 09:00 UTC = morning
          status: 'confirmed',
        } as never,
      ],
      () => 'UTC'
    );
    expect(slots).toEqual([
      { householdId: HH_A, date: DATES[0]!, period: 'morning' },
    ]);
  });
});

describe('householdColourIndex', () => {
  it('gives the first three households their own index, in order', () => {
    const ids = ['a', 'b', 'c'];
    expect(householdColourIndex(ids, 'a')).toBe(0);
    expect(householdColourIndex(ids, 'b')).toBe(1);
    expect(householdColourIndex(ids, 'c')).toBe(2);
  });

  it('clamps a 4th+ household to index 3 (the neutral fallback) rather than throwing', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    expect(householdColourIndex(ids, 'd')).toBe(3);
    expect(householdColourIndex(ids, 'e')).toBe(3);
  });

  it('falls back to 0 for an id not in the list', () => {
    expect(householdColourIndex(['a'], 'nope')).toBe(0);
  });
});
