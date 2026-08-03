/**
 * Typography Design Tokens — Daylight
 *
 * Platform face (omit fontFamily). Weight is load-bearing via numeric
 * `fontWeight` on the system font — SF Pro / Roboto handle this correctly.
 *
 * We removed Sora because per-file weight families made numeric `fontWeight`
 * a no-op on iOS; with the platform face, weight works again.
 *
 * Key Principles:
 * - Minimum 16px for body text (WCAG AA requirement)
 * - Clear hierarchy from display to body text
 * - Optical sizing: lighter at large sizes, heavier at small sizes
 * - Tabular numerals via factory `tabular` option (not a NativeWind class)
 */

export const typography = {
  // Display — For hero sections and major headings only
  displayLarge: {
    size: 56,
    lineHeight: 64,
    weight: '800' as const,
    letterSpacing: 0,
  },
  display: {
    size: 32,
    lineHeight: 40,
    weight: '800' as const,
    letterSpacing: 0,
  },

  // Headings — Clear hierarchy
  h1: {
    size: 32,
    lineHeight: 40,
    weight: '600' as const,
    letterSpacing: -0.58,
  },
  h2: {
    size: 24,
    lineHeight: 32,
    weight: '600' as const,
    letterSpacing: 0,
  },
  h3: {
    size: 20,
    lineHeight: 28,
    weight: '600' as const,
    letterSpacing: 0,
  },
  h4: {
    size: 18,
    lineHeight: 27,
    weight: '600' as const,
    letterSpacing: 0,
  },

  // Live timer — tabular numerals, lighter weight at large size
  timer: {
    size: 44,
    lineHeight: 48,
    weight: '500' as const,
    letterSpacing: -1.14,
  },

  // Day-group heading — agenda / week views (Wave A3 call sites)
  dayGroup: {
    size: 17,
    lineHeight: 24,
    weight: '600' as const,
    letterSpacing: -0.2,
  },

  // Body text — MINIMUM 16px for readability (WCAG AA requirement)
  body: {
    size: 16,
    lineHeight: 24,
    weight: '400' as const,
    letterSpacing: 0,
  },
  bodyLarge: {
    size: 18,
    lineHeight: 28,
    weight: '400' as const,
    letterSpacing: 0,
  },
  bodySmall: {
    size: 14,
    lineHeight: 21,
    weight: '400' as const,
    letterSpacing: 0,
  },
  bodyLight: {
    size: 16,
    lineHeight: 24,
    weight: '300' as const,
    letterSpacing: 0,
  },

  // UI elements — Interactive elements and labels
  caption: {
    size: 14,
    lineHeight: 21,
    weight: '400' as const,
    letterSpacing: 0,
  },
  label: {
    size: 14,
    lineHeight: 21,
    weight: '500' as const,
    letterSpacing: 0,
  },
  metadataLabel: {
    size: 13,
    lineHeight: 18,
    weight: '500' as const,
    letterSpacing: 0,
  },
  button: {
    size: 16,
    lineHeight: 24,
    weight: '600' as const,
    letterSpacing: 0,
  },
  buttonSmall: {
    size: 14,
    lineHeight: 20,
    weight: '600' as const,
    letterSpacing: 0.3,
  },

  achievement: {
    size: 24,
    lineHeight: 32,
    weight: '700' as const,
    letterSpacing: 0.5,
  },
  encouragement: {
    size: 18,
    lineHeight: 28,
    weight: '400' as const,
    letterSpacing: 0.1,
    fontStyle: 'italic' as const,
  },

  // Signature — retuned for platform face (no ultralight; less negative tracking)
  signature: {
    heroLight: {
      size: 40,
      lineHeight: 48,
      weight: '300' as const,
      letterSpacing: 0,
    },
    heroBold: {
      size: 40,
      lineHeight: 48,
      weight: '600' as const,
      letterSpacing: 0,
    },
    milestoneHeading: {
      size: 32,
      lineHeight: 40,
      weight: '800' as const,
      letterSpacing: 0,
    },
    contemplative: {
      size: 18,
      lineHeight: 32,
      weight: '300' as const,
      letterSpacing: 0.2,
    },
  },
} as const;

/**
 * Tailwind class mappings for typography.
 */
export const typographyClasses = {
  displayLarge: 'text-[56px] leading-[64px] font-extrabold',
  display: 'text-[32px] leading-[40px] font-extrabold',
  h1: 'text-[32px] leading-[40px] font-semibold',
  h2: 'text-2xl leading-8 font-semibold',
  h3: 'text-xl leading-7 font-semibold',
  h4: 'text-lg leading-[27px] font-semibold',
  timer: 'text-[44px] leading-[48px] font-medium',
  dayGroup: 'text-[17px] leading-6 font-semibold',
  body: 'text-base leading-6',
  bodyLarge: 'text-lg leading-7',
  bodySmall: 'text-sm leading-[21px]',
  bodyLight: 'text-base leading-6 font-light',
  caption: 'text-sm leading-[21px]',
  label: 'text-sm leading-[21px] font-medium',
  metadataLabel: 'text-[13px] leading-[18px] font-medium',
  button: 'text-base leading-6 font-semibold',
  buttonSmall: 'text-sm leading-5 font-semibold tracking-wide',
  achievement: 'text-2xl leading-8 font-bold tracking-wide',
  encouragement: 'text-lg leading-7 italic tracking-wide',
  signature: {
    heroLight: 'text-[40px] leading-[48px] font-light',
    heroBold: 'text-[40px] leading-[48px] font-semibold',
    milestoneHeading: 'text-[32px] leading-[40px] font-extrabold',
    contemplative: 'text-lg leading-[32px] font-light tracking-wide',
  },
} as const;

export type TypographyScale = keyof typeof typography;
export type TypographyClass = keyof typeof typographyClasses;
