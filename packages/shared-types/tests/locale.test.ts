import { describe, expect, it } from 'bun:test';
import type { SupportedLocale } from '../src/locale';
import {
  DEFAULT_LOCALE,
  isValidLocale,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
} from '../src/locale';

describe('locale', () => {
  describe('SUPPORTED_LOCALES', () => {
    it('ships en and es as the example locales', () => {
      expect(SUPPORTED_LOCALES).toEqual(['en', 'es']);
    });
  });

  describe('DEFAULT_LOCALE', () => {
    it('is en', () => {
      expect(DEFAULT_LOCALE).toBe('en');
    });
  });

  describe('LOCALE_NAMES', () => {
    it('has a name for every supported locale', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(typeof LOCALE_NAMES[locale]).toBe('string');
        expect(LOCALE_NAMES[locale].length).toBeGreaterThan(0);
      }
    });
  });

  describe('isValidLocale', () => {
    it('returns true for supported locales', () => {
      expect(isValidLocale('en')).toBe(true);
      expect(isValidLocale('es')).toBe(true);
    });

    it('returns false for unsupported or malformed input', () => {
      expect(isValidLocale('fr')).toBe(false);
      expect(isValidLocale('EN')).toBe(false);
      expect(isValidLocale('')).toBe(false);
    });

    it('works as a type guard', () => {
      const locale = 'es';
      if (isValidLocale(locale)) {
        const narrowed: SupportedLocale = locale;
        expect(narrowed).toBe('es');
      }
    });
  });
});
