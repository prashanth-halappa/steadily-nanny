/**
 * The clock-time field on the correction sheet writes to a pay record, so it
 * must never coerce nonsense into a plausible time.
 */
import { describe, expect, it } from 'bun:test';
import { parseWallClockInput } from '../utils/wallClockInput';

describe('parseWallClockInput', () => {
  it('canonicalises what someone actually types', () => {
    expect(parseWallClockInput('17:30')).toBe('17:30');
    expect(parseWallClockInput('1730')).toBe('17:30');
    expect(parseWallClockInput('930')).toBe('09:30');
    expect(parseWallClockInput('9:5')).toBe('09:05');
    expect(parseWallClockInput('  08:00 ')).toBe('08:00');
    expect(parseWallClockInput('8.15')).toBe('08:15');
  });

  it('keeps the midnight boundaries', () => {
    expect(parseWallClockInput('00:00')).toBe('00:00');
    expect(parseWallClockInput('23:59')).toBe('23:59');
  });

  it('rejects rather than wraps an impossible time', () => {
    // Reading "25:00" as 01:00 would write an hour nobody meant.
    expect(parseWallClockInput('25:00')).toBeNull();
    expect(parseWallClockInput('12:60')).toBeNull();
    expect(parseWallClockInput('-1:00')).toBeNull();
  });

  it('rejects incomplete or non-numeric input', () => {
    expect(parseWallClockInput('')).toBeNull();
    expect(parseWallClockInput('17')).toBeNull();
    expect(parseWallClockInput('17:')).toBeNull();
    expect(parseWallClockInput('half five')).toBeNull();
    expect(parseWallClockInput('17:30:00')).toBeNull();
  });
});
