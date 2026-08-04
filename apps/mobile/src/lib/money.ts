/**
 * @module lib/money
 *
 * The ONE place that converts between integer minor units (pence, cents —
 * what every `*_minor` column and wire field actually stores) and a display
 * string. `docs/11-MONEY.md` §1 and `docs/TIER0-CX-SPEC.md` §1 are binding:
 * nobody hand-rolls `* 100` / `/ 100` outside this file.
 *
 * `parseMajorToMinor` works on the STRING a person typed, never
 * `Math.round(parseFloat(text) * 100)` on a raw float — floats cannot
 * represent currency exactly (`0.1 + 0.2 !== 0.3`), and that's the exact
 * class of bug integer storage exists to avoid. It returns `null` rather
 * than throwing or coercing on anything it can't parse cleanly (more than 2
 * decimal places, non-numeric text, a negative amount) — the same
 * "return null, never guess" discipline `parseWallClockInput` uses:
 * silently reinterpreting what someone typed would write a wrong number
 * into a pay record.
 */

/**
 * Explicit fallback symbol map for the currencies this app actually uses.
 * Some Hermes ICU builds ship without CLDR currency-symbol data, so
 * `Intl.NumberFormat(..., { style: 'currency', currency })` degrades to
 * emitting the bare ISO code ("GBP18.50") instead of a symbol ("£18.50").
 * `formatMoney` detects that and falls back to hand-building the string
 * with this map instead.
 */
const CURRENCY_SYMBOL_FALLBACKS: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
};

/** Plain decimal formatting (grouping + 2dp, en-GB), no currency symbol —
 * the piece that still works even on the degraded-ICU builds this file
 * works around. */
function formatMajorAmount(major: number): string {
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/** `minor` (integer pence/cents) + an ISO-4217 `currency` -> a display
 * string, e.g. `formatMoney(1850, 'GBP')` -> `"£18.50"`. */
export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  const formatted = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(major);

  // Detect the Hermes ICU variance: if the currency's own ISO code leaked
  // literally into the formatted output, `Intl` didn't have a symbol for
  // it and we build the string ourselves instead.
  const code = currency.toUpperCase();
  const fallbackSymbol = CURRENCY_SYMBOL_FALLBACKS[code];
  if (fallbackSymbol && formatted.toUpperCase().includes(code)) {
    return `${fallbackSymbol}${formatMajorAmount(major)}`;
  }

  return formatted;
}

/** `formatMoney` plus the `/hr` suffix used everywhere a rate (as opposed
 * to a total) is shown, e.g. `"£18.50/hr"`. */
export function formatRate(minor: number, currency: string): string {
  return `${formatMoney(minor, currency)}/hr`;
}

/**
 * Parses what someone typed (or copied from `formatMoney`'s own output) —
 * "18.50", "£18.50", "1,234.56", "18" — into integer minor units. Returns
 * `null`, never a coerced/rounded guess, when the text:
 *   - isn't a number at all,
 *   - carries more than 2 decimal places (the amount isn't representable in
 *     minor units without inventing a fraction of a penny), or
 *   - is negative (every money input in this app — a rate, a mileage rate,
 *     an expense amount — is non-negative; the app has no discount/refund
 *     concept that would need a signed amount here).
 */
export function parseMajorToMinor(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // Strip a single leading currency symbol (or any other non-digit,
  // non-minus prefix) and thousands-separator commas — what's left should
  // be a plain signed decimal number.
  const cleaned = trimmed.replace(/^[^\d-]+/, '').replace(/,/g, '');

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, wholePart, fractionPart] = match;
  if (sign === '-') return null; // negative: reject, see doc comment above.

  const minorFraction = Number((fractionPart ?? '').padEnd(2, '0'));
  return Number(wholePart) * 100 + minorFraction;
}
