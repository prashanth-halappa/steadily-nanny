/**
 * @module domains/schedule/components/__tests__/AdjustSchedulePatternSheet.utils.test
 * Dependency-free unit tests for the pure "yyyy-mm-dd" helpers backing
 * AdjustSchedulePatternSheet's end-date field.
 */
import { describe, expect, it } from 'bun:test';
import {
  formatDate,
  isOnOrAfter,
  parseDate,
} from '../AdjustSchedulePatternSheet.utils';

describe('parseDate / formatDate round-trip', () => {
  it('parses a "yyyy-mm-dd" string to local midnight and back', () => {
    const date = parseDate('2026-03-01');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2); // 0-indexed: March
    expect(date.getDate()).toBe(1);
    expect(formatDate(date)).toBe('2026-03-01');
  });

  it('pads single-digit month/day', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('isOnOrAfter', () => {
  it('accepts an until on or after dtstart (mirrors the server refine)', () => {
    expect(isOnOrAfter('2026-03-01', '2026-03-01')).toBe(true);
    expect(isOnOrAfter('2026-03-02', '2026-03-01')).toBe(true);
  });

  it('rejects an until before dtstart', () => {
    expect(isOnOrAfter('2026-02-28', '2026-03-01')).toBe(false);
  });
});
