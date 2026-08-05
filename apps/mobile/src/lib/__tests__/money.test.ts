/**
 * @module lib/__tests__/money
 * The one place that converts between integer minor units and a display
 * string (`docs/11-MONEY.md` §1, `docs/TIER0-CX-SPEC.md` §1). Property-ish
 * edge set from `TIER0-PLAN.md`: 0, 1p, £999,999.99.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  formatMoney,
  formatRate,
  minorToMajorText,
  parseMajorToMinor,
} from '../money';

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

  // A `currency` value arrives from a stored row, not from a picker, so a
  // corrupt or hand-edited code reaches this function. `Intl.NumberFormat`
  // throws a RangeError on anything that isn't a well-formed ISO-4217 code,
  // and an uncaught throw inside a render blanks the nanny's pay screen —
  // the amount she came to check. A bad code must degrade to inert text.
  describe('invalid stored currency code', () => {
    it('does not throw on a malformed code', () => {
      expect(() => formatMoney(1850, 'AB1')).not.toThrow();
    });

    it('falls back to "<code> <amount>" so the row renders inert instead of crashing', () => {
      expect(formatMoney(1850, 'AB1')).toBe('AB1 18.50');
    });

    it('keeps grouping in the invalid-code fallback', () => {
      expect(formatMoney(99999999, 'AB1')).toBe('AB1 999,999.99');
    });

    it('does not throw on an empty currency code', () => {
      expect(() => formatMoney(1850, '')).not.toThrow();
    });

    it('formatRate degrades the same way rather than throwing', () => {
      expect(formatRate(1850, 'AB1')).toBe('AB1 18.50/hr');
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

  it('strips a leading currency symbol followed by a space', () => {
    expect(parseMajorToMinor('£ 18.50')).toBe(1850);
    expect(parseMajorToMinor('€ 18.50')).toBe(1850);
    expect(parseMajorToMinor('$18.50')).toBe(1850);
  });

  // The corruption class this parser exists to prevent (review finding 1):
  // a "strip every leading non-digit" clean-up ate the decimal POINT itself,
  // so ".45" parsed as 45 major units — £45.00 written into a pay record
  // where £0.45 was typed. A leading dot is not a number this app accepts;
  // it is rejected, never reinterpreted.
  it('rejects a bare leading decimal point rather than reading it as whole units', () => {
    expect(parseMajorToMinor('.45')).toBeNull();
    expect(parseMajorToMinor('.5')).toBeNull();
    expect(parseMajorToMinor('.')).toBeNull();
  });

  it('rejects a leading decimal point behind a currency symbol', () => {
    expect(parseMajorToMinor('£.45')).toBeNull();
  });

  // Letters are not a currency symbol. Stripping them turned typed noise
  // into a confident number.
  it('rejects leading letters instead of stripping them', () => {
    expect(parseMajorToMinor('abc18.50')).toBeNull();
    expect(parseMajorToMinor('GBP18.50')).toBeNull();
  });

  it('rejects trailing junk after the number', () => {
    expect(parseMajorToMinor('18.50abc')).toBeNull();
    expect(parseMajorToMinor('18.50 ')).toBe(1850); // outer whitespace only
  });

  // Commas are thousands grouping or nothing — an unvalidated `replace(/,/g)`
  // turned "1,2,3" into 123 and "18,5" into 185.
  it('rejects commas that are not valid thousands grouping', () => {
    expect(parseMajorToMinor('1,2,3')).toBeNull();
    expect(parseMajorToMinor('18,5')).toBeNull();
    expect(parseMajorToMinor('1,23,456')).toBeNull();
    expect(parseMajorToMinor(',123')).toBeNull();
    expect(parseMajorToMinor('1,')).toBeNull();
  });

  it('accepts multi-group thousands separators', () => {
    expect(parseMajorToMinor('1,234.56')).toBe(123456);
    expect(parseMajorToMinor('12,345')).toBe(1234500);
  });

  it('rejects a second currency symbol', () => {
    expect(parseMajorToMinor('££18.50')).toBeNull();
    expect(parseMajorToMinor('£$18.50')).toBeNull();
  });

  // Upper bound (review nit 13): the largest amount the rest of the stack
  // renders and round-trips is £999,999.99. Anything above it is a typo (a
  // stray extra digit), and accepting it would write a nonsense rate.
  it('accepts the documented maximum, £999,999.99', () => {
    expect(parseMajorToMinor('999999.99')).toBe(99999999);
    expect(parseMajorToMinor('999,999.99')).toBe(99999999);
  });

  it('rejects an amount above £999,999.99', () => {
    expect(parseMajorToMinor('1000000')).toBeNull();
    expect(parseMajorToMinor('1,000,000.00')).toBeNull();
    expect(parseMajorToMinor('999999.999')).toBeNull();
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

describe('minorToMajorText', () => {
  // Phase 3+4 adversarial review, finding 14: the one util an editable
  // amount input seeds/re-normalises from, so `ExpenseAddSheet`/
  // `PayChangeSheet`/`PaySetupScreen` never hand-roll `(minor / 100).toFixed(2)`.
  it('formats minor units as a plain 2dp string, no currency symbol', () => {
    expect(minorToMajorText(0)).toBe('0.00');
    expect(minorToMajorText(1)).toBe('0.01');
    expect(minorToMajorText(1850)).toBe('18.50');
    expect(minorToMajorText(99999999)).toBe('999999.99');
  });

  it('round-trips through parseMajorToMinor', () => {
    for (const minor of [0, 1, 1850, 99999999]) {
      expect(parseMajorToMinor(minorToMajorText(minor))).toBe(minor);
    }
  });
});
