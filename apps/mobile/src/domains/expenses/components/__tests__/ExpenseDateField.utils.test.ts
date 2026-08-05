import { describe, expect, it } from 'bun:test';
import {
  formatDate,
  isOnOrBeforeToday,
  parseDate,
} from '../ExpenseDateField.utils';

describe('parseDate / formatDate', () => {
  it('round-trips a calendar date', () => {
    const date = parseDate('2026-08-03');
    expect(formatDate(date)).toBe('2026-08-03');
  });

  it('parses month/day correctly (no off-by-one)', () => {
    const date = parseDate('2026-01-31');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(31);
  });
});

describe('isOnOrBeforeToday', () => {
  it('accepts today', () => {
    expect(isOnOrBeforeToday('2026-08-05', '2026-08-05')).toBe(true);
  });

  it('accepts a past date', () => {
    expect(isOnOrBeforeToday('2026-08-01', '2026-08-05')).toBe(true);
  });

  it('refuses a future date', () => {
    expect(isOnOrBeforeToday('2026-08-06', '2026-08-05')).toBe(false);
  });
});
