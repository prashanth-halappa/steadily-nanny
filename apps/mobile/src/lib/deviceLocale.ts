/**
 * @module lib/deviceLocale
 *
 * Best-effort locale + currency from expo-localization, sibling of
 * `deviceTimeZone.ts` and the same shape: one `getLocales()` read wrapped in a
 * try/catch with a safe fallback, because a native-module read must never be
 * the reason a pay screen fails to render.
 *
 * Both values come from the device's Language & Region SETTING, not from GPS,
 * SIM or timezone — they do not change when someone travels, only when they
 * change the setting themselves. That is what makes them safe to use as a
 * default for a stored pay arrangement.
 */
import { getLocales } from 'expo-localization';

/** BCP-47 tag for `Intl` formatting, e.g. `"en-GB"` — controls grouping,
 * decimal separator and currency-symbol placement, never WHICH currency. */
export function getDeviceLocale(): string {
  try {
    return getLocales()[0]?.languageTag ?? 'en-GB';
  } catch {
    return 'en-GB';
  }
}

/**
 * The device's ISO-4217 code, UPPERCASED and shape-checked against the same
 * `^[A-Z]{3}$` that `CurrencyCodeSchema`
 * (`packages/shared-types/src/schemas/payArrangement.schema.ts`) and the
 * `pay_arrangements.currency` DB check enforce. Nothing between here and the
 * column upcases, so a lowercase or malformed platform value would be a 400 at
 * best and a wrong stored code at worst — it degrades to `'USD'` instead.
 *
 * This is a PREFILL, never the final word: currency belongs to the employment
 * arrangement, not to the phone (a UK family whose phone region is US must not
 * silently store USD), which is why every caller pairs it with a picker.
 */
export function getDeviceCurrency(): string {
  try {
    const code = getLocales()[0]?.currencyCode?.toUpperCase();
    return code && /^[A-Z]{3}$/.test(code) ? code : 'USD';
  } catch {
    return 'USD';
  }
}
