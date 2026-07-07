/**
 * Tests for the language store that manages locale preferences.
 * Covers setLanguage, loadFromBackend, the grace period, and switching.
 * Uses Zustand with MMKV persistence (react-native-mmkv / expo-localization /
 * react-i18next are mocked globally in bun.setup.ts; i18next is mocked here so
 * changeLanguage calls can be asserted).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock i18next so we can assert on changeLanguage calls.
const mockChangeLanguage = mock((_lang: string) => Promise.resolve());

let useLanguageStore: typeof import('../languageStore').useLanguageStore;
let SUPPORTED_LANGUAGES: typeof import('../languageStore').SUPPORTED_LANGUAGES;
let LANGUAGE_NAMES: typeof import('../languageStore').LANGUAGE_NAMES;

beforeAll(async () => {
  // Set up the mock BEFORE importing the module under test.
  mock.module('i18next', () => ({
    default: {
      changeLanguage: mockChangeLanguage,
      language: 'en',
      use: () => ({ init: () => Promise.resolve() }),
    },
  }));

  // Dynamic import AFTER mocking.
  const mod = await import('../languageStore');
  useLanguageStore = mod.useLanguageStore;
  SUPPORTED_LANGUAGES = mod.SUPPORTED_LANGUAGES;
  LANGUAGE_NAMES = mod.LANGUAGE_NAMES;
});

beforeEach(() => {
  mockChangeLanguage.mockClear();
  useLanguageStore.setState({ language: 'en', lastLocalChangeAt: null });
});

describe('languageStore', () => {
  describe('initial state', () => {
    it('has English as the default language', () => {
      expect(useLanguageStore.getState().language).toBe('en');
    });

    it('has null lastLocalChangeAt', () => {
      expect(useLanguageStore.getState().lastLocalChangeAt).toBeNull();
    });

    it('exposes setLanguage and loadFromBackend actions', () => {
      const state = useLanguageStore.getState();
      expect(typeof state.setLanguage).toBe('function');
      expect(typeof state.loadFromBackend).toBe('function');
    });
  });

  describe('setLanguage', () => {
    it('updates the store language to Spanish', async () => {
      await useLanguageStore.getState().setLanguage('es');
      expect(useLanguageStore.getState().language).toBe('es');
    });

    it('calls i18n.changeLanguage with the new language', async () => {
      await useLanguageStore.getState().setLanguage('es');
      expect(mockChangeLanguage).toHaveBeenCalledWith('es');
    });

    it('sets lastLocalChangeAt on language change', async () => {
      const before = Date.now();
      await useLanguageStore.getState().setLanguage('es');
      const stamp = useLanguageStore.getState().lastLocalChangeAt;
      expect(stamp).not.toBeNull();
      expect(stamp).toBeGreaterThanOrEqual(before);
      expect(stamp).toBeLessThanOrEqual(Date.now());
    });

    it('switches from Spanish back to English correctly', async () => {
      const { setLanguage } = useLanguageStore.getState();
      await setLanguage('es');
      expect(useLanguageStore.getState().language).toBe('es');
      await setLanguage('en');
      expect(useLanguageStore.getState().language).toBe('en');
      expect(mockChangeLanguage).toHaveBeenCalledWith('en');
    });
  });

  describe('loadFromBackend', () => {
    it('updates language when different and supported', async () => {
      await useLanguageStore.getState().loadFromBackend('es');
      expect(useLanguageStore.getState().language).toBe('es');
      expect(mockChangeLanguage).toHaveBeenCalledWith('es');
    });

    it('does not change language when backend matches current', async () => {
      await useLanguageStore.getState().loadFromBackend('en');
      expect(useLanguageStore.getState().language).toBe('en');
      expect(mockChangeLanguage).not.toHaveBeenCalled();
    });

    it('keeps the current language when backend returns null', async () => {
      useLanguageStore.setState({ language: 'es', lastLocalChangeAt: null });
      await useLanguageStore.getState().loadFromBackend(null);
      expect(useLanguageStore.getState().language).toBe('es');
    });

    it('keeps the current language when backend returns undefined', async () => {
      useLanguageStore.setState({ language: 'es', lastLocalChangeAt: null });
      await useLanguageStore.getState().loadFromBackend(undefined);
      expect(useLanguageStore.getState().language).toBe('es');
    });

    it('ignores unsupported languages from backend', async () => {
      await useLanguageStore.getState().loadFromBackend('fr');
      expect(useLanguageStore.getState().language).toBe('en');
      expect(mockChangeLanguage).not.toHaveBeenCalled();
    });
  });

  describe('grace period', () => {
    it('skips backend sync during the grace period after a local change', async () => {
      useLanguageStore.setState({
        language: 'es',
        lastLocalChangeAt: Date.now(),
      });
      // Stale backend tries to set it back to English.
      await useLanguageStore.getState().loadFromBackend('en');
      expect(useLanguageStore.getState().language).toBe('es');
      expect(mockChangeLanguage).not.toHaveBeenCalled();
    });

    it('allows backend sync after the grace period expires', async () => {
      useLanguageStore.setState({
        language: 'en',
        lastLocalChangeAt: Date.now() - 6000,
      });
      await useLanguageStore.getState().loadFromBackend('es');
      expect(useLanguageStore.getState().language).toBe('es');
      expect(mockChangeLanguage).toHaveBeenCalledWith('es');
    });

    it('allows backend sync when lastLocalChangeAt is null', async () => {
      useLanguageStore.setState({ language: 'en', lastLocalChangeAt: null });
      await useLanguageStore.getState().loadFromBackend('es');
      expect(useLanguageStore.getState().language).toBe('es');
    });
  });

  describe('supported languages', () => {
    it('exports SUPPORTED_LANGUAGES containing en and es', () => {
      expect(SUPPORTED_LANGUAGES).toContain('en');
      expect(SUPPORTED_LANGUAGES).toContain('es');
    });

    it('exports LANGUAGE_NAMES with native-script names', () => {
      expect(LANGUAGE_NAMES.en).toBe('English');
      expect(LANGUAGE_NAMES.es).toBe('Español');
    });
  });
});
