/**
 * @module TimeRangePickerUtilsTests
 *
 * TDD tests for the pure "HH:MM" wall-clock helpers behind TimeRangePicker.
 * Deliberately dependency-free (no react-native, no
 * @react-native-community/datetimepicker import) so they can be exercised
 * directly — see time-range-picker.test.tsx for why the component itself
 * falls back to source-inspection instead of a render test.
 */

import { describe, expect, it } from 'bun:test';
import {
  formatTime,
  isEndAfterStart,
  parseTime,
} from '../time-range-picker.utils';

describe('parseTime', () => {
  it('parses "HH:MM" into a Date carrying only hour/minute', () => {
    const date = parseTime('09:30');
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(30);
  });

  it('zero-pads correctly for midnight', () => {
    const date = parseTime('00:00');
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });
});

describe('formatTime', () => {
  it('formats a Date back to zero-padded "HH:MM"', () => {
    expect(formatTime(new Date(2000, 0, 1, 9, 5))).toBe('09:05');
  });

  it('zero-pads single-digit hours and minutes', () => {
    expect(formatTime(new Date(2000, 0, 1, 0, 0))).toBe('00:00');
  });

  it('round-trips through parseTime', () => {
    expect(formatTime(parseTime('17:45'))).toBe('17:45');
  });
});

describe('isEndAfterStart', () => {
  it('is true when end is later than start', () => {
    expect(isEndAfterStart('09:00', '17:00')).toBe(true);
  });

  it('is false when end equals start', () => {
    expect(isEndAfterStart('09:00', '09:00')).toBe(false);
  });

  it('is false when end is before start', () => {
    expect(isEndAfterStart('09:00', '08:59')).toBe(false);
  });

  it('compares correctly across the hour boundary (zero-padded lexicographic compare)', () => {
    expect(isEndAfterStart('08:59', '09:00')).toBe(true);
    expect(isEndAfterStart('09:59', '10:00')).toBe(true);
  });
});
