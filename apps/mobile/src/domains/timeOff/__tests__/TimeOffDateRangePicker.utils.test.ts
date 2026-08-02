/**
 * @module domains/timeOff/__tests__/TimeOffDateRangePicker.utils.test
 * TDD tests for the pure "yyyy-mm-dd" helpers behind TimeOffDateRangePicker.
 * Dependency-free (no react-native, no datetimepicker import) — see
 * TimeOffDateRangePicker.test.tsx for why the component itself falls back
 * to source inspection instead of a render test.
 */
import { describe, expect, it } from 'bun:test';
import {
  formatDate,
  isEndOnOrAfterStart,
  parseDate,
} from '../components/TimeOffDateRangePicker.utils';

describe('parseDate', () => {
  it('parses "yyyy-mm-dd" into a Date at local midnight', () => {
    const date = parseDate('2026-08-10');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(10);
    expect(date.getHours()).toBe(0);
  });
});

describe('formatDate', () => {
  it('formats a Date back to "yyyy-mm-dd"', () => {
    expect(formatDate(new Date(2026, 7, 10))).toBe('2026-08-10');
  });

  it('zero-pads single-digit month and day', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('round-trips through parseDate', () => {
    expect(formatDate(parseDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('isEndOnOrAfterStart', () => {
  it('is true when end is after start', () => {
    expect(isEndOnOrAfterStart('2026-08-10', '2026-08-12')).toBe(true);
  });

  it('is true when end equals start — a single day off is valid', () => {
    expect(isEndOnOrAfterStart('2026-08-10', '2026-08-10')).toBe(true);
  });

  it('is false when end is before start', () => {
    expect(isEndOnOrAfterStart('2026-08-10', '2026-08-09')).toBe(false);
  });
});
