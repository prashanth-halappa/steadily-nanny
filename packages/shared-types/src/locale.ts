/**
 * Supported locale codes and helpers — a single source of truth shared by the
 * API and the app so locale handling stays consistent.
 *
 * Ships with `en` + `es` as example locales. Add a code to SUPPORTED_LOCALES
 * and a matching entry to LOCALE_NAMES to support more.
 *
 * @module locale
 */

/**
 * Supported locale codes.
 *
 * SETUP: extend with your app's locales. A production app might support, e.g.:
 * ['en','es','kn','ja','de','fr','pt','zh','hi','ko','it','ar','nl','sv','ta','te']
 */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;

/** A valid supported locale code, derived from SUPPORTED_LOCALES. */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Default locale used when no preference is set or when an invalid locale is
 * encountered.
 */
export const DEFAULT_LOCALE = 'en' as const;

/**
 * Human-readable locale names in English. Used primarily for API-side display
 * and LLM prompt construction. For native script names (used in the app UI),
 * see the client i18n constants.
 */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Espanol',
};

/**
 * Type guard that validates whether a string is a supported locale.
 *
 * @param locale - The string to validate
 * @returns True if the locale is a valid SupportedLocale
 */
export function isValidLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}
