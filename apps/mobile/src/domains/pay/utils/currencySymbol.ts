/**
 * @module domains/pay/utils/currencySymbol
 *
 * Small LOCAL fallback-symbol map for the currency prefix badge in
 * `PayChangeSheet` (review finding 14) — GBP/EUR/USD only, falling back to
 * the bare ISO code for anything else.
 *
 * Deliberately duplicated rather than importing `apps/mobile/src/lib/money.ts`'s
 * `CURRENCY_SYMBOL_FALLBACKS` map: that map is a private (unexported)
 * implementation detail of `formatMoney`, and `money.ts` is owned by a
 * concurrent workstream mid-fix at the time this was written. Dedupe into a
 * single shared export once that lands and money.ts exposes one.
 */
const CURRENCY_SYMBOL_FALLBACKS: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
};

/** `"GBP"` -> `"£"`; an unrecognised code falls back to itself, never blank. */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL_FALLBACKS[currency.toUpperCase()] ?? currency;
}
