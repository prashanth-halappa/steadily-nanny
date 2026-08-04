/**
 * @module lib/__tests__/money
 * The one place that converts between integer minor units and a display
 * string (`docs/11-MONEY.md` §1, `docs/TIER0-CX-SPEC.md` §1). Property-ish
 * edge set from `TIER0-PLAN.md`: 0, 1p, £999,999.99.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { formatMoney, formatRate, parseMajorToMinor } from '../money';

describe('formatMoney', () => {
  it('formats zero', () => {
    expect(formatMoney(0, 'GBP')).toBe('£0.00');
  });

  it('formats a single penny', () => {
    expect(formatMoney(1, 'GBP')).toBe('£0.01');
  });

  it('formats a large amount with thousands separators', () => {
    expect(formatMoney(99999999, 'GBP')).toBe('£999,999.99');
  });

  it('formats EUR with its own symbol', () => {
    expect(formatMoney(1850, 'EUR')).toBe('€18.50');
  });

  // Real (non-degraded) en-GB ICU renders USD as "US$", not bare "$" — the
  // disambiguation from £ is deliberate on Intl's part, not a bug. The bare
  // "$18.50" only appears on the Hermes-degraded fallback path below, where
  // this file supplies the symbol itself.
  it('formats USD as Intl’s own en-GB disambiguated form', () => {
    expect(formatMoney(1850, 'USD')).toBe('US$18.50');
  });

  describe('Hermes ICU fallback (currency-symbol data missing)', () => {
    const RealNumberFormat = Intl.NumberFormat;

    afterEach(() => {
      Intl.NumberFormat = RealNumberFormat;
    });

    /** Stands in for a Hermes build whose ICU data lacks CLDR currency
     * symbols: `style: 'currency'` degrades to emitting the bare ISO code
     * ("GBP18.50") instead of "£18.50". Only the currency formatter is
     * broken here — a plain decimal formatter still works, the same shape
     * the real bug takes. */
    function stubBrokenCurrencyIntl() {
      class StubNumberFormat {
        private readonly opts: Intl.NumberFormatOptions;
        constructor(_locale: string, opts: Intl.NumberFormatOptions = {}) {
          this.opts = opts;
        }
        format(value: number): string {
          if (this.opts.style === 'currency') {
            return `${this.opts.currency}${value.toFixed(2)}`;
          }
          return new RealNumberFormat('en-GB', this.opts).format(value);
        }
      }
      Intl.NumberFormat =
        StubNumberFormat as unknown as typeof Intl.NumberFormat;
    }

    it('falls back to the explicit symbol map when Intl leaks the bare currency code', () => {
      stubBrokenCurrencyIntl();
      expect(formatMoney(1850, 'GBP')).toBe('£18.50');
    });

    it('falls back correctly for EUR and USD too', () => {
      stubBrokenCurrencyIntl();
      expect(formatMoney(1850, 'EUR')).toBe('€18.50');
      expect(formatMoney(1850, 'USD')).toBe('$18.50');
    });

    it('applies thousands separators in the fallback path too', () => {
      stubBrokenCurrencyIntl();
      expect(formatMoney(99999999, 'GBP')).toBe('£999,999.99');
    });
  });
});

describe('formatRate', () => {
  it('appends /hr to the formatted amount', () => {
    expect(formatRate(1850, 'GBP')).toBe('£18.50/hr');
  });
});

describe('parseMajorToMinor', () => {
  it('parses 0', () => {
    expect(parseMajorToMinor('0')).toBe(0);
  });

  it('parses a single penny', () => {
    expect(parseMajorToMinor('0.01')).toBe(1);
  });

  it('parses £999,999.99', () => {
    expect(parseMajorToMinor('999,999.99')).toBe(99999999);
  });

  it('parses one decimal place by right-padding, not truncating ("18.5" -> £18.50)', () => {
    expect(parseMajorToMinor('18.5')).toBe(1850);
  });

  it('parses a whole number with no decimal point', () => {
    expect(parseMajorToMinor('18')).toBe(1800);
  });

  it('rejects more than two decimal places', () => {
    expect(parseMajorToMinor('18.505')).toBeNull();
  });

  it('rejects non-numeric text', () => {
    expect(parseMajorToMinor('not a number')).toBeNull();
    expect(parseMajorToMinor('')).toBeNull();
  });

  // Money inputs in this app are non-negative — a rate, a mileage rate, an
  // expense amount are never entered as negative numbers, so a negative
  // string is rejected rather than silently coerced with Math.abs(). The
  // same reasoning `parseWallClockInput` uses for an out-of-range time:
  // silently reinterpreting a value the user didn't mean would write a
  // wrong number into a pay record.
  it('rejects a negative amount', () => {
    expect(parseMajorToMinor('-18.50')).toBeNull();
  });

  it('strips a leading currency symbol, mirroring formatMoney output', () => {
    expect(parseMajorToMinor('£18.50')).toBe(1850);
  });

  it('round-trips through formatMoney (symbol and thousands separators stripped)', () => {
    const minorValues = [0, 1, 1850, 99999999];
    for (const minor of minorValues) {
      const formatted = formatMoney(minor, 'GBP');
      const stripped = formatted.replace(/^£/, '');
      expect(parseMajorToMinor(stripped)).toBe(minor);
    }
  });
});
