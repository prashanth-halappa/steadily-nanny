/**
 * @module domains/setup/__tests__/timezones.test
 * Covers: every curated zone is a real, unique IANA identifier `Intl`
 * recognizes (the whole point of a picker over free text), and
 * `findTimezoneOption` looks up correctly.
 */
import { describe, expect, it } from 'bun:test';
import { COMMON_TIMEZONES, findTimezoneOption } from '../utils/timezones';

function isRecognizedByIntl(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

describe('COMMON_TIMEZONES', () => {
  it('is non-empty', () => {
    expect(COMMON_TIMEZONES.length).toBeGreaterThan(0);
  });

  it('every value is a real IANA zone Intl recognizes', () => {
    for (const zone of COMMON_TIMEZONES) {
      expect(isRecognizedByIntl(zone.value)).toBe(true);
    }
  });

  it('has no duplicate values', () => {
    const values = COMMON_TIMEZONES.map(z => z.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('includes UTC and Europe/London (the app default)', () => {
    expect(COMMON_TIMEZONES.some(z => z.value === 'UTC')).toBe(true);
    expect(COMMON_TIMEZONES.some(z => z.value === 'Europe/London')).toBe(true);
  });
});

describe('findTimezoneOption', () => {
  it('finds a curated zone by value', () => {
    expect(findTimezoneOption('Europe/London')?.label).toContain('London');
  });

  it('returns undefined for a zone not in the curated list', () => {
    expect(findTimezoneOption('Not/AZone')).toBeUndefined();
  });
});
