import { describe, expect, it } from 'bun:test';
import { ageFromBirthDate, birthDateFromAge } from '../childAge';

const NOW = new Date('2026-06-15T00:00:00.000Z');

describe('birthDateFromAge', () => {
  it('returns Jan 1 of the birth year', () => {
    expect(birthDateFromAge(5, NOW)).toBe('2021-01-01');
  });

  it('handles age 0', () => {
    expect(birthDateFromAge(0, NOW)).toBe('2026-01-01');
  });
});

describe('ageFromBirthDate', () => {
  it('returns null for null input', () => {
    expect(ageFromBirthDate(null, NOW)).toBeNull();
  });

  it('returns null for an invalid date string', () => {
    expect(ageFromBirthDate('not-a-date', NOW)).toBeNull();
  });

  it('computes age when the birthday has already passed this year', () => {
    expect(ageFromBirthDate('2021-01-01', NOW)).toBe(5);
  });

  it('computes age when the birthday has not yet happened this year', () => {
    expect(ageFromBirthDate('2021-12-25', NOW)).toBe(4);
  });

  it('round-trips with birthDateFromAge for a whole-year birth date', () => {
    const birthDate = birthDateFromAge(7, NOW);
    expect(ageFromBirthDate(birthDate, NOW)).toBe(7);
  });
});
