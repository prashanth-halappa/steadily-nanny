/**
 * @module lib/__tests__/weekdayOrder.test
 * D29 — presentation-only weekday reorder. Stored dow values never change.
 */
import { describe, expect, it } from 'bun:test';
import { getWeekdayOrder } from '../weekdayOrder';

describe('getWeekdayOrder', () => {
  it('defaults to Monday-first when start is 1', () => {
    expect(getWeekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('starts on Sunday when start is 0', () => {
    expect(getWeekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('starts on Saturday when start is 6', () => {
    expect(getWeekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it('falls back to Monday-first for null/undefined/invalid', () => {
    expect(getWeekdayOrder(null)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(getWeekdayOrder(undefined)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(getWeekdayOrder(7)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(getWeekdayOrder(-1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});
