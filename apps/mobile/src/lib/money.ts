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
 *
 * BOTH exported functions are total: `parseMajorToMinor` never throws and
 * never guesses (it returns `null`), and `formatMoney` never throws even on
 * a corrupt stored currency code (it degrades to inert text). Money code
 * runs inside a render on the screen a nanny opens to check what she is
 * owed; a throw there shows her a blank screen instead of a number.
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
 * string, e.g. `formatMoney(1850, 'GBP')` -> `"£18.50"`.
 *
 * `currency` arrives from a stored row, not from a picker, so a corrupt or
 * hand-edited code reaches this function. `Intl.NumberFormat` throws a
 * RangeError on anything that isn't a well-formed ISO-4217 code, and an
 * uncaught throw inside a render blanks the pay screen — the one number the
 * nanny opened the app for. A bad code therefore degrades to inert text
 * (`"AB1 18.50"`): visibly wrong, legible, and not a crash. */
export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(major);
  } catch {
    // RangeError in practice ("Invalid currency code"); caught broadly on
    // purpose — the contract this function owes its callers is "never throw",
    // and narrowing the catch would make that contract depend on which error
    // class a given JS engine picked.
    return `${currency} ${formatMajorAmount(major)}`;
  }

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
 * Minor units -> the plain (no currency symbol, no grouping) 2dp string an
 * EDITABLE amount input seeds/re-normalises to, e.g.
 * `minorToMajorText(1850)` -> `"18.50"`. This is `parseMajorToMinor`'s
 * display-side inverse for the specific "pre-fill or re-normalise-on-blur a
 * rate/amount field" shape — `PayChangeSheet` and `ExpenseAddSheet` both
 * need exactly this, and docs/11-MONEY.md §1's one-util rule means neither
 * gets to hand-roll `(minor / 100).toFixed(2)` itself (Phase 3+4 review,
 * finding 14).
 *
 * Deliberately NOT `formatMoney`: that function adds a currency symbol via
 * `Intl.NumberFormat`, which is right for read-only display but wrong for
 * an editable text input's value (the field already renders its own
 * currency prefix/adornment beside it).
 */
export function minorToMajorText(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * The largest amount this app accepts, in minor units: £999,999.99. It is the
 * same ceiling the format/parse round-trip is pinned at, and above it every
 * realistic input is a typo — a stray extra digit on an hourly rate. Rejecting
 * beats storing a nonsense number that then flows into a week's gross pay.
 */
const MAX_MINOR = 99_999_999;

/**
 * The only prefixes stripped before parsing: the symbols this app can itself
 * emit (`CURRENCY_SYMBOL_FALLBACKS`), so `parseMajorToMinor` accepts exactly
 * what `formatMoney` produces and nothing looser.
 */
const LEADING_SYMBOLS = new Set(Object.values(CURRENCY_SYMBOL_FALLBACKS));

/** Plain amount: `18`, `18.5`, `18.50`. No sign, no grouping. */
const PLAIN_AMOUNT = /^\d+(?:\.\d{1,2})?$/;
/** Comma-grouped amount: `1,234`, `12,345.67`, `999,999.99` — groups of
 * exactly three after the first, which is 1-3 digits. `1,2,3` and `18,5` are
 * not this shape and are not amounts. */
const GROUPED_AMOUNT = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;

/**
 * Removes AT MOST ONE leading currency symbol plus one optional space after
 * it. Deliberately not a `^[^\d]+` strip: that ate the decimal POINT of
 * ".45" and turned it into 45 whole units (review finding 1), and it turned
 * typed noise like "abc18.50" into a confident 1850.
 */
function stripLeadingCurrencySymbol(text: string): string {
  const first = text[0];
  if (first === undefined || !LEADING_SYMBOLS.has(first)) return text;
  const rest = text.slice(1);
  return rest.startsWith(' ') ? rest.slice(1) : rest;
}

/**
 * Parses what someone typed (or copied from `formatMoney`'s own output) —
 * "18.50", "£18.50", "1,234.56", "18" — into integer minor units. Returns
 * `null`, never a coerced/rounded guess, when the text:
 *   - isn't a number at all, or carries ANY character beyond one optional
 *     leading currency symbol and a fully-matching decimal amount (no
 *     leading letters, no trailing junk, no bare leading `.`),
 *   - uses commas as anything other than valid thousands grouping,
 *   - carries more than 2 decimal places (the amount isn't representable in
 *     minor units without inventing a fraction of a penny),
 *   - is negative (every money input in this app — a rate, a mileage rate,
 *     an expense amount — is non-negative; the app has no discount/refund
 *     concept that would need a signed amount here), or
 *   - exceeds `MAX_MINOR` (£999,999.99).
 *
 * The whole-string match is the point: this function used to *clean* its
 * input and parse whatever survived, which is how ".45" became £45.00. It
 * now VALIDATES and refuses — the caller shows "enter a valid amount", which
 * is always better than writing a number nobody typed into a pay record.
 */
export function parseMajorToMinor(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const amount = stripLeadingCurrencySymbol(trimmed);
  const grouped = GROUPED_AMOUNT.test(amount);
  if (!grouped && !PLAIN_AMOUNT.test(amount)) return null;

  // Safe only now: the grouping has been proven valid, so removing the
  // commas cannot silently reinterpret the number.
  const [wholePart = '', fractionPart = ''] = amount
    .replace(/,/g, '')
    .split('.');

  const minor = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, '0'));
  return minor > MAX_MINOR ? null : minor;
}
