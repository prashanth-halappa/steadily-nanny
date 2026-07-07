/**
 * Email design tokens.
 *
 * Single source of truth for the visual language of transactional emails: warm,
 * calm, cream backgrounds with a single accent used sparingly for CTAs.
 * Presentation-only — kept separate from the sending-side constants.
 *
 * SETUP: swap these hex values, fonts, and the font-import URL for your brand.
 *
 * @module domains/email/templates/designTokens
 */

/**
 * Frozen string literals so templates and tests reference tokens instead of
 * hardcoding hex values.
 */
export const EMAIL = {
  color: {
    /** Primary accent — CTAs ONLY (1–2 per email). */
    accent: '#3B6FF5',
    accentText: '#FFFFFF',

    /** Outer page cream — set as table bgcolor (Gmail strips body bg). */
    bgPage: '#F5F0E8',
    /** Inner content card cream (lightest). */
    bgCard: '#FAF8F5',
    /** Tinted info blocks / callouts / footer. */
    bgTint: '#EDE8DF',

    /** Headings + body text (warm near-black). */
    text: '#17181A',
    /** Labels, meta, footer (warm gray) — AA on cream / tint. */
    textMuted: '#5E6470',
    /** Hairlines / borders. */
    border: '#EDE8DF',

    /** Accent darkened for AA-compliant colored TEXT on the cream card / tint. */
    inkAccent: '#2B5AD4',
  },

  font: {
    /** Editorial headlines, with broadly-supported serif fallbacks. */
    serif: "'Lora',Georgia,'Times New Roman',serif",
    /** Body / UI, with system-sans fallbacks. */
    sans: "'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
  },

  /** Webfont import (loaded in baseLayout, guarded from Outlook). */
  fontImportUrl:
    'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Sora:wght@400;500;600;700&display=swap',

  space: { xs: '8px', sm: '16px', md: '24px', lg: '32px' },
  radius: { card: '16px', box: '12px', pill: '9999px' },
  size: {
    h1: '26px',
    h2: '19px',
    body: '16px',
    small: '14px',
    label: '13px',
  },
} as const;
