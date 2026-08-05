/**
 * @module tests/unit/domains/pay/utils/allocateMinutes
 *
 * Written BEFORE the implementation (TDD red-first). Pure function, no mocks.
 *
 * This is the one place minutes are split across days — a multi-day time off
 * marked paid (`ptoCommandService`), the same total re-allocated after a
 * correction, and the netted total attributed back across dates for pricing
 * (`weekEarningsService.netPtoUsage`). The invariant every caller depends on
 * is EXACTNESS: the parts sum to the whole, always, with no minute lost to
 * rounding and none invented. A lost minute is a lost penny at the carer's
 * rate, and an invented one is money nobody agreed.
 */
import { describe, expect, it } from 'bun:test';
import { allocateMinutes } from '../../../../../src/domains/pay/utils/allocateMinutes';

describe('allocateMinutes — exact division', () => {
  it('splits evenly when it divides exactly', () => {
    expect(allocateMinutes(480, [1, 1, 1])).toEqual([160, 160, 160]);
  });

  it('gives the whole total to a single part', () => {
    expect(allocateMinutes(480, [1])).toEqual([480]);
  });

  it('returns [] for no parts at all', () => {
    expect(allocateMinutes(480, [])).toEqual([]);
  });

  it('allocates nothing when the total is zero', () => {
    expect(allocateMinutes(0, [1, 1, 1])).toEqual([0, 0, 0]);
  });
});

describe('allocateMinutes — indivisible totals lose and invent nothing', () => {
  it('hands the remainder to the EARLIEST parts, largest-remainder style', () => {
    // 100 / 3 = 33.33 -> 34, 33, 33
    expect(allocateMinutes(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('spreads two leftover minutes across the first two parts', () => {
    // 101 / 3 -> 34, 34, 33
    expect(allocateMinutes(101, [1, 1, 1])).toEqual([34, 34, 33]);
  });

  it('a total smaller than the part count leaves later parts at zero, never negative', () => {
    expect(allocateMinutes(2, [1, 1, 1, 1, 1])).toEqual([1, 1, 0, 0, 0]);
  });

  it('THE INVARIANT: the parts always sum to exactly the total', () => {
    for (const total of [0, 1, 2, 7, 59, 100, 480, 4800, 4801, 99_999]) {
      for (const parts of [1, 2, 3, 5, 7, 14, 31]) {
        const weights = Array.from({ length: parts }, () => 1);
        const allocated = allocateMinutes(total, weights);
        expect(allocated).toHaveLength(parts);
        expect(allocated.reduce((sum, part) => sum + part, 0)).toBe(total);
        expect(allocated.every(part => part >= 0)).toBe(true);
      }
    }
  });
});

describe('allocateMinutes — weighted allocation', () => {
  it('respects the weights when they divide the total exactly', () => {
    expect(allocateMinutes(5200, [2400, 2800])).toEqual([2400, 2800]);
  });

  it('scales proportionally when the total differs from the weight sum', () => {
    expect(allocateMinutes(4000, [2400, 2400])).toEqual([2000, 2000]);
  });

  it('gives a zero-weight part nothing', () => {
    expect(allocateMinutes(600, [1, 0, 1])).toEqual([300, 0, 300]);
  });

  it('falls back to an EVEN split when every weight is zero', () => {
    // A fully-reversed marking has no per-date shape left to preserve, but a
    // new total still has to land somewhere.
    expect(allocateMinutes(600, [0, 0, 0])).toEqual([200, 200, 200]);
  });

  it('THE INVARIANT holds for weighted allocation too', () => {
    for (const total of [1, 97, 480, 4801]) {
      for (const weights of [
        [1, 2],
        [2400, 2400, 1],
        [7, 11, 13, 17],
        [0, 5, 0],
      ]) {
        const allocated = allocateMinutes(total, weights);
        expect(allocated.reduce((sum, part) => sum + part, 0)).toBe(total);
      }
    }
  });

  it('treats a negative weight as zero rather than stealing from its neighbours', () => {
    expect(allocateMinutes(600, [1, -5, 1])).toEqual([300, 0, 300]);
  });
});
