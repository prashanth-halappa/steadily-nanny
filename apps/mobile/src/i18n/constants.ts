/**
 * Language constants for i18n configuration.
 *
 * Re-exports the shared locale source of truth from
 * `@yourapp/shared-types/locale` under app-friendly aliases, and adds
 * native-script display names for the language picker in the settings UI
 * (the shared package only carries English-only names).
 *
 * SETUP: to add a language, extend SUPPORTED_LOCALES in
 * `@yourapp/shared-types/locale`, then add its native-script entry to
 * LANGUAGE_NAMES below and a `locales/<code>/*.json` catalog set.
 */

import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@yourapp/shared-types/locale';

// Re-export with backward-compatible, app-facing aliases.
export const SUPPORTED_LANGUAGES = SUPPORTED_LOCALES;
export type SupportedLanguage = SupportedLocale;

// Display names in each language's native script, for the settings picker.
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
};

/**
 * Type guard: is the given string one of the app's supported languages?
 */
export function isSupported(language: string): language is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}

// Re-export the shared primitives for convenience.
export {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@yourapp/shared-types/locale';
