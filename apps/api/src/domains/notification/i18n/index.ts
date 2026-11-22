/**
 * Push-copy i18n runtime (A10).
 *
 * The uncovered-care digest's Spanish strings used to live only in a module
 * comment in `uncoveredDigestJob.ts` — unreachable by any code path. This
 * wires them into a real catalog. Mirrors `domains/email/i18n/index.ts`'s
 * shape (auto-discovered `<locale>.json` catalogs, `en` as fallback,
 * i18next nested keys + `{{var}}` interpolation) — see that module for the
 * full design rationale.
 *
 * Every OTHER push emitter in this repo stays hardcoded English by
 * deliberate, documented convention (push i18n is a deferred, repo-wide
 * concern) — this module exists for A10's specific, named fix, not as an
 * invitation to route every push through it.
 *
 * @module domains/notification/i18n
 */

import {
  DEFAULT_LOCALE,
  isValidLocale,
  SUPPORTED_LOCALES,
} from '@steadily-nanny/shared-types/locale';
import { createInstance, type i18n, type TFunction } from 'i18next';
import en from './en.json';
import es from './es.json';

/** Single namespace every push catalog loads under. */
const PUSH_NS = 'push' as const;

/**
 * Locale catalogs, statically imported (no fs on Workers). Locales without a
 * catalog fall back to English.
 * SETUP: a new locale needs its `<locale>.json` imported and added here.
 */
const CATALOGS: Record<string, object> = { en, es };

function loadResources(): Record<string, { [PUSH_NS]: object }> {
  const resources: Record<string, { [PUSH_NS]: object }> = {};
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    if (isValidLocale(locale)) resources[locale] = { [PUSH_NS]: catalog };
  }
  return resources;
}

const instance: i18n = createInstance();
// Inline resources → init resolves synchronously; `t` is usable immediately.
void instance.init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES as unknown as string[],
  ns: [PUSH_NS],
  defaultNS: PUSH_NS,
  resources: loadResources(),
  returnNull: false,
  returnEmptyString: false,
  interpolation: {
    // Push bodies are plain text, not HTML — no entity-escaping wanted.
    escapeValue: false,
  },
});

export interface NotificationI18n {
  /** Locale-bound translation lookup (nested keys, `{{var}}` interpolation, `_one`/`_other` plurals). */
  t: TFunction;
}

/**
 * Build a locale-bound push translator. An invalid/unsupported locale falls
 * back to `en` — never throws, so a bad `preferred_locale` value on a user
 * row can't take down a push send.
 */
export function createNotificationI18n(locale?: string): NotificationI18n {
  const resolved = locale && isValidLocale(locale) ? locale : DEFAULT_LOCALE;
  return { t: instance.getFixedT(resolved, PUSH_NS) };
}
