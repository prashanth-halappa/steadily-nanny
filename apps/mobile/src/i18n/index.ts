/**
 * i18n configuration for the mobile app (i18next + react-i18next).
 *
 * Namespaces (template starter set — extend as you add screens):
 * - common:   shared buttons, loading + navigation labels
 * - errors:   generic error-message catalog (looked up by errorLocalization)
 * - auth:     sign-in / sign-up screens
 * - welcome:  first-run welcome carousel
 * - settings: settings screen
 *
 * Language resolution order (each candidate validated vs SUPPORTED_LANGUAGES):
 *   1. MMKV-persisted preference from the `language-storage` Zustand store
 *   2. Device locale via expo-localization
 *   3. Fallback to 'en'
 *
 * SETUP: add a locale by extending SUPPORTED_LOCALES in
 * `@yourapp/shared-types/locale`, adding a `locales/<code>/*.json` set, and
 * wiring its imports into the `resources` map below.
 */

import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { storage } from '@/src/lib/mmkvStorage';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './constants';
import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enSettings from './locales/en/settings.json';
import enWelcome from './locales/en/welcome.json';
import esAuth from './locales/es/auth.json';
import esCommon from './locales/es/common.json';
import esErrors from './locales/es/errors.json';
import esSettings from './locales/es/settings.json';
import esWelcome from './locales/es/welcome.json';

const resources = {
  en: {
    common: enCommon,
    errors: enErrors,
    auth: enAuth,
    welcome: enWelcome,
    settings: enSettings,
  },
  es: {
    common: esCommon,
    errors: esErrors,
    auth: esAuth,
    welcome: esWelcome,
    settings: esSettings,
  },
};

// Zustand persist stores the language store under this MMKV key.
const LANGUAGE_STORAGE_KEY = 'language-storage';

function resolveInitialLanguage(): SupportedLanguage {
  // 1. Persisted preference (Zustand persist envelope in MMKV).
  try {
    const persistedState = storage.getString(LANGUAGE_STORAGE_KEY);
    if (persistedState) {
      const parsed = JSON.parse(persistedState) as {
        state?: { language?: string };
      };
      const storedLang = parsed?.state?.language;
      if (
        storedLang &&
        SUPPORTED_LANGUAGES.includes(storedLang as SupportedLanguage)
      ) {
        return storedLang as SupportedLanguage;
      }
    }
  } catch {
    // Ignore parse errors — fall through to device locale.
  }

  // 2. Device locale.
  const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';
  if (SUPPORTED_LANGUAGES.includes(deviceLocale as SupportedLanguage)) {
    return deviceLocale as SupportedLanguage;
  }

  // 3. Fallback.
  return 'en';
}

const initI18n = async () => {
  await i18n.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    resources,
    lng: resolveInitialLanguage(),
    fallbackLng: 'en',
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    // Ensure components re-render on language change.
    react: {
      useSuspense: false,
      bindI18n: 'languageChanged loaded',
      bindI18nStore: 'added removed',
    },
  });
};

initI18n();

export default i18n;
