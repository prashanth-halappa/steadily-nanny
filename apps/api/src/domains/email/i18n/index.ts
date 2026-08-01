/**
 * Email i18n runtime.
 *
 * Localizes transactional email copy across the app's supported locales (see
 * `@steadily-nanny/shared-types/locale`). Mirrors i18next conventions — nested
 * camelCase keys, `{{var}}` interpolation, `_one`/`_other` plural suffixes.
 *
 * Design notes:
 * - **Auto-discovery:** locale catalogs (`en.json`, …) are read from this
 *   directory at module load. Ships with `en` only; a new locale lights up with
 *   NO code change here — SETUP: add a `<locale>.json` catalog alongside
 *   `en.json` (and add its code to `SUPPORTED_LOCALES` in shared-types).
 * - **Fallback:** `en.json` is the source of truth and the i18next `fallbackLng`,
 *   so a missing key or an untranslated locale renders English, never a blank.
 * - **One namespace, nested keys:** everything loads under the `email` namespace,
 *   so templates call `t('welcome.subject', { appName })`.
 * - **HTML safety:** interpolation does NOT auto-escape (`escapeValue: false`)
 *   because templates interpolate trusted markup fragments. Run untrusted
 *   values (user-supplied names, free text) through {@link escapeHtml} at the
 *   call site before interpolation.
 *
 * @module domains/email/i18n
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_LOCALE,
  isValidLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@steadily-nanny/shared-types/locale';
import { createInstance, type i18n, type TFunction } from 'i18next';

/** Single namespace all email catalogs load under. */
const EMAIL_NS = 'email' as const;

/**
 * Locales that render right-to-left.
 * SETUP: add RTL locale codes here (e.g. 'ar', 'he') as you add their catalogs.
 */
const RTL_LOCALES = new Set<string>();

// API compiles as CommonJS; Bun provides `__dirname` at runtime in both modes.
const catalogDir = __dirname;

/**
 * Read every `<locale>.json` catalog present in this directory and build the
 * i18next `resources` map. Locales without a file fall back to English.
 */
function loadResources(): Record<string, { [EMAIL_NS]: object }> {
  const resources: Record<string, { [EMAIL_NS]: object }> = {};
  for (const file of readdirSync(catalogDir)) {
    if (!file.endsWith('.json')) continue;
    const locale = file.slice(0, -'.json'.length);
    if (!isValidLocale(locale)) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(catalogDir, file), 'utf8'));
      resources[locale] = { [EMAIL_NS]: parsed };
    } catch (err) {
      // A malformed catalog must never take down email sending — log and skip.
      console.error(`[email-i18n] failed to load catalog "${file}":`, err);
    }
  }
  return resources;
}

const instance: i18n = createInstance();
// Inline resources → init resolves synchronously; `t` is usable immediately.
void instance.init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES as unknown as string[],
  ns: [EMAIL_NS],
  defaultNS: EMAIL_NS,
  resources: loadResources(),
  returnNull: false,
  returnEmptyString: false,
  interpolation: {
    // Templates interpolate trusted HTML fragments; escape untrusted values
    // explicitly at the call site via escapeHtml().
    escapeValue: false,
  },
});

/** A bound email translator plus locale-aware formatting + direction. */
export interface EmailI18n {
  /** Locale-bound translation lookup (nested keys, `{{var}}` interpolation). */
  t: TFunction;
  /** The resolved, validated locale (falls back to `en`). */
  locale: SupportedLocale;
  /** `'rtl'` for RTL locales, `'ltr'` otherwise. */
  dir: 'ltr' | 'rtl';
  /** Format a date for this locale via `Intl.DateTimeFormat`. */
  formatDate: (date: Date, opts?: Intl.DateTimeFormatOptions) => string;
  /** Format a number for this locale via `Intl.NumberFormat`. */
  formatNumber: (value: number, opts?: Intl.NumberFormatOptions) => string;
}

/**
 * Build a locale-bound email translator. Invalid/undefined locales fall back to
 * the default (`en`).
 *
 * @example
 * const { t } = createEmailI18n(data.locale);
 * const subject = t('welcome.subject', { appName });
 */
export function createEmailI18n(locale?: string): EmailI18n {
  const resolved: SupportedLocale =
    locale && isValidLocale(locale) ? locale : DEFAULT_LOCALE;

  return {
    t: instance.getFixedT(resolved, EMAIL_NS),
    locale: resolved,
    dir: RTL_LOCALES.has(resolved) ? 'rtl' : 'ltr',
    formatDate: (date, opts) =>
      new Intl.DateTimeFormat(resolved, opts).format(date),
    formatNumber: (value, opts) =>
      new Intl.NumberFormat(resolved, opts).format(value),
  };
}

/** Text direction for a locale (without building a full translator). */
export function localeDir(locale?: string): 'ltr' | 'rtl' {
  return locale && isValidLocale(locale) && RTL_LOCALES.has(locale)
    ? 'rtl'
    : 'ltr';
}

/**
 * Escape a string for safe interpolation into email HTML. Apply to ALL
 * untrusted/user-supplied values before passing them as interpolation vars —
 * templates render with HTML escaping off.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Truncate a preheader string to `max` characters without splitting an HTML
 * entity. Preheaders are built from already-escaped body copy, so a naive
 * `slice` can cut inside a sequence like `&amp;` and leave `&amp` (no `;`). If
 * the cut point falls inside an unterminated entity, backtrack to before its `&`.
 *
 * @param text - The (already HTML-escaped) source text.
 * @param max - Maximum length of the returned preheader.
 */
export function truncatePreheader(text: string, max: number): string {
  if (text.length <= max) return text;

  let cut = max;
  const amp = text.lastIndexOf('&', cut - 1);
  if (amp !== -1) {
    const semi = text.indexOf(';', amp);
    if (semi === -1 || semi >= cut) {
      cut = amp;
    }
  }

  return text.slice(0, cut);
}
