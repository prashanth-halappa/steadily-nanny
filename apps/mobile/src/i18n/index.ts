/**
 * i18n configuration for the mobile app (i18next + react-i18next).
 *
 * Namespaces (template starter set — extend as you add screens):
 * - common:   shared buttons, loading + navigation labels
 * - errors:   generic error-message catalog (looked up by errorLocalization)
 * - auth:     sign-in / sign-up screens
 * - welcome:  first-run welcome carousel
 * - settings: settings screen
 * - schedule: schedule-pattern build/pending/respond + shifts screens
 * - today:    the Today tab's clock-in card
 * - hours:    the Hours tab (clock in/out history, approve/query)
 * - household: children/invite/availability, shared between the first-run
 *   setup wizard and their post-onboarding Settings entry points
 * - timeOff:   the nanny-only time-off request/list/cancel screen
 * - inbox:     pending-work "needs attention" surface
 *
 * Language resolution order (each candidate validated vs SUPPORTED_LANGUAGES):
 *   1. MMKV-persisted preference from the `language-storage` Zustand store
 *   2. Device locale via expo-localization
 *   3. Fallback to 'en'
 *
 * SETUP: add a locale by extending SUPPORTED_LOCALES in
 * `@steadily-nanny/shared-types/locale`, adding a `locales/<code>/*.json` set, and
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
import enHours from './locales/en/hours.json';
import enHousehold from './locales/en/household.json';
import enInbox from './locales/en/inbox.json';
import enSchedule from './locales/en/schedule.json';
import enSettings from './locales/en/settings.json';
import enTimeOff from './locales/en/timeOff.json';
import enToday from './locales/en/today.json';
import enWelcome from './locales/en/welcome.json';
import esAuth from './locales/es/auth.json';
import esCommon from './locales/es/common.json';
import esErrors from './locales/es/errors.json';
import esHours from './locales/es/hours.json';
import esHousehold from './locales/es/household.json';
import esInbox from './locales/es/inbox.json';
import esSchedule from './locales/es/schedule.json';
import esSettings from './locales/es/settings.json';
import esTimeOff from './locales/es/timeOff.json';
import esToday from './locales/es/today.json';
import esWelcome from './locales/es/welcome.json';

const resources = {
  en: {
    common: enCommon,
    errors: enErrors,
    auth: enAuth,
    welcome: enWelcome,
    settings: enSettings,
    schedule: enSchedule,
    today: enToday,
    hours: enHours,
    household: enHousehold,
    timeOff: enTimeOff,
    inbox: enInbox,
  },
  es: {
    common: esCommon,
    errors: esErrors,
    auth: esAuth,
    welcome: esWelcome,
    settings: esSettings,
    schedule: esSchedule,
    today: esToday,
    hours: esHours,
    household: esHousehold,
    timeOff: esTimeOff,
    inbox: esInbox,
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
