/**
 * Language store.
 *
 * Zustand store that manages the user's locale preference:
 * - persisted to MMKV (key `language-storage`) so it survives restarts
 * - drives i18next so a language change applies immediately across the app
 *
 * A short grace window after a local change prevents a stale backend value
 * (synced separately via the user-profile mutation) from clobbering a choice
 * the user just made.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { zustandStorage } from '@/src/lib/mmkvStorage';
import { createV1Migrate } from '@/src/store/persistMigrations';
// Import constants from the shared file to avoid circular dependencies.
import {
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from './constants';
// Import the configured i18n instance (ensures react-i18next is initialized).
import i18n from './index';

// Re-export constants for backward compatibility with consumers.
export { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type SupportedLanguage };

export interface LanguageState {
  // Current language code.
  language: SupportedLanguage;

  // Timestamp of the last local language change (guards against a backend
  // sync race).
  lastLocalChangeAt: number | null;

  // Actions.
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  loadFromBackend: (locale: string | null | undefined) => Promise<void>;
}

// Window (ms) after a local change during which backend syncs are ignored.
const LOCAL_CHANGE_GRACE_PERIOD_MS = 5000;

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: 'en',
      lastLocalChangeAt: null,

      setLanguage: async (language: SupportedLanguage) => {
        // Stamp the change so a stale backend sync can't override it.
        set({ language, lastLocalChangeAt: Date.now() });

        // Apply immediately in i18next.
        await i18n.changeLanguage(language);
      },

      loadFromBackend: async (locale: string | null | undefined) => {
        if (!locale) return;

        const { language, lastLocalChangeAt } = get();

        // Don't override a recent local change (race-condition prevention).
        if (lastLocalChangeAt) {
          const timeSinceLocalChange = Date.now() - lastLocalChangeAt;
          if (timeSinceLocalChange < LOCAL_CHANGE_GRACE_PERIOD_MS) {
            if (__DEV__) {
              console.log(
                '[LanguageStore] Skipping backend sync - recent local change'
              );
            }
            return;
          }
        }

        // Only update when the backend differs and is a supported language.
        if (
          locale !== language &&
          SUPPORTED_LANGUAGES.includes(locale as SupportedLanguage)
        ) {
          set({ language: locale as SupportedLanguage });
          await i18n.changeLanguage(locale);
        }
      },
    }),
    {
      name: 'language-storage',
      version: 1,
      migrate: createV1Migrate<LanguageState>(),
      storage: createJSONStorage(() => zustandStorage),
      partialize: state => ({
        language: state.language,
        // Persist the timestamp so the grace window survives a restart.
        lastLocalChangeAt: state.lastLocalChangeAt,
      }),
    }
  )
);
