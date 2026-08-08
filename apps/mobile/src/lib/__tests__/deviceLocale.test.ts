/**
 * @module lib/__tests__/deviceLocale
 *
 * `getDeviceCurrency` is the only branch here worth pinning: it feeds a value
 * straight into `pay_arrangements.currency`, whose DB check and
 * `CurrencyCodeSchema` both demand `^[A-Z]{3}$`. Nothing between this function
 * and that column upcases or re-validates, so a lowercase or junk platform
 * value would be a 400 at best. These asserts are the guard on that.
 *
 * `getLocales` is already mocked globally in `bun.setup.ts`; each test here
 * re-points that same mock rather than calling `mock.module` again.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { getLocales } from 'expo-localization';
import { getDeviceCurrency, getDeviceLocale } from '../deviceLocale';

const mockGetLocales = getLocales as unknown as {
  mockImplementation: (fn: () => unknown) => void;
};

const DEFAULT_LOCALES = [
  {
    languageCode: 'en',
    regionCode: 'GB',
    languageTag: 'en-GB',
    currencyCode: 'GBP',
  },
];

afterEach(() => {
  mockGetLocales.mockImplementation(() => DEFAULT_LOCALES);
});

describe('getDeviceCurrency', () => {
  it('passes a well-formed code through', () => {
    mockGetLocales.mockImplementation(() => [{ currencyCode: 'USD' }]);
    expect(getDeviceCurrency()).toBe('USD');
  });

  it('upcases — the DB check and CurrencyCodeSchema are uppercase-only', () => {
    mockGetLocales.mockImplementation(() => [{ currencyCode: 'eur' }]);
    expect(getDeviceCurrency()).toBe('EUR');
  });

  it('falls back to GBP on a malformed code rather than storing junk', () => {
    mockGetLocales.mockImplementation(() => [{ currencyCode: 'Pound' }]);
    expect(getDeviceCurrency()).toBe('GBP');
  });

  it('falls back to GBP when the platform reports no currency', () => {
    mockGetLocales.mockImplementation(() => [{ languageTag: 'en-GB' }]);
    expect(getDeviceCurrency()).toBe('GBP');
  });

  it('falls back to GBP when the native module throws', () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error('native module unavailable');
    });
    expect(getDeviceCurrency()).toBe('GBP');
  });
});

describe('getDeviceLocale', () => {
  it('returns the BCP-47 tag', () => {
    mockGetLocales.mockImplementation(() => [{ languageTag: 'de-DE' }]);
    expect(getDeviceLocale()).toBe('de-DE');
  });

  it('falls back to en-GB when the native module throws', () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error('native module unavailable');
    });
    expect(getDeviceLocale()).toBe('en-GB');
  });
});
