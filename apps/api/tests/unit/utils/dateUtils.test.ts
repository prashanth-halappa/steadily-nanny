import { describe, expect, test } from 'bun:test';
import { getPeriodStart, toDateOnlyString } from '../../../src/utils/dateUtils';

describe('dateUtils', () => {
  test('toDateOnlyString formats YYYY-MM-DD (UTC)', () => {
    expect(toDateOnlyString(new Date('2026-07-06T18:30:00Z'))).toBe(
      '2026-07-06'
    );
  });

  test('getPeriodStart daily = that day', () => {
    expect(getPeriodStart('daily', new Date('2026-07-06T18:30:00Z'))).toBe(
      '2026-07-06'
    );
  });

  test('getPeriodStart weekly = Monday of the ISO week', () => {
    // 2026-07-06 is a Monday; 2026-07-08 (Wed) rolls back to it.
    expect(getPeriodStart('weekly', new Date('2026-07-08T00:00:00Z'))).toBe(
      '2026-07-06'
    );
  });

  test('getPeriodStart monthly = first of the month', () => {
    expect(getPeriodStart('monthly', new Date('2026-07-20T00:00:00Z'))).toBe(
      '2026-07-01'
    );
  });
});
