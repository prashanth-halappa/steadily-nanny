/**
 * Typography Design Tokens
 *
 * Uses the Sora font family (the template's default OSS font) with dramatic
 * weight contrast and size jumps for visual impact while maintaining readability.
 *
 * SORA WEIGHT GOTCHA (golden fix — do not "simplify" this):
 *   On iOS, Sora weight MUST be selected via the `fontFamily` value
 *   (Sora-Bold / Sora-SemiBold / Sora-Light / ...), NOT via a numeric
 *   `fontWeight`. A numeric `fontWeight` is a no-op (or produces faux-bold)
 *   because each Sora weight ships as a separate font file. The `weight` field
 *   below is kept only as documentation for the corresponding `fontFamily`.
 *
 * SETUP: To swap fonts, replace the `Sora-*` families here (and in
 *   tailwind.config.js `fontFamily`) with your font's per-weight family names,
 *   and load those files via expo-font.
 *
 * Key Principles:
 * - Minimum 16px for body text (WCAG AA requirement)
 * - Dramatic size jumps for impact
 * - Heavy + Light weight pairings for visual interest
 * - Clear hierarchy from display to body text
 * - Optical sizing: lighter at large sizes, heavier at small sizes
 */

export const typography = {
  // Display — For hero sections and major headings only
  displayLarge: {
    size: 56,
    lineHeight: 64,
    weight: '800' as const, // ExtraBold — set via fontFamily below
    fontFamily: 'Sora-ExtraBold' as const,
    letterSpacing: -0.5,
  },
  display: {
    size: 32,
    lineHeight: 40,
    weight: '800' as const,
    fontFamily: 'Sora-ExtraBold' as const,
    letterSpacing: -0.5,
  },

  // Headings — Clear hierarchy
  h1: {
    size: 32,
    lineHeight: 40,
    weight: '700' as const,
    fontFamily: 'Sora-Bold' as const,
    letterSpacing: -0.3,
  },
  h2: {
    size: 24,
    lineHeight: 32,
    weight: '600' as const,
    fontFamily: 'Sora-SemiBold' as const,
    letterSpacing: 0,
  },
  h3: {
    size: 20,
    lineHeight: 28,
    weight: '600' as const,
    fontFamily: 'Sora-SemiBold' as const,
    letterSpacing: 0,
  },
  h4: {
    size: 18,
    lineHeight: 26,
    weight: '600' as const,
    fontFamily: 'Sora-SemiBold' as const,
    letterSpacing: 0,
  },

  // Body text — MINIMUM 16px for readability (WCAG AA requirement)
  body: {
    size: 16,
    lineHeight: 24,
    weight: '400' as const,
    fontFamily: 'Sora-Regular' as const,
    letterSpacing: 0,
  },
  bodyLarge: {
    size: 18,
    lineHeight: 28,
    weight: '400' as const,
    fontFamily: 'Sora-Regular' as const,
    letterSpacing: 0,
  },
  bodySmall: {
    size: 14,
    lineHeight: 20,
    weight: '400' as const,
    fontFamily: 'Sora-Regular' as const,
    letterSpacing: 0,
  },
  bodyLight: {
    size: 16,
    lineHeight: 24,
    weight: '300' as const,
    fontFamily: 'Sora-Light' as const,
    letterSpacing: 0,
  },

  // UI elements — Interactive elements and labels
  caption: {
    size: 14,
    lineHeight: 20,
    weight: '400' as const,
    fontFamily: 'Sora-Regular' as const,
    letterSpacing: 0,
  },
  label: {
    size: 14,
    lineHeight: 20,
    weight: '500' as const,
    fontFamily: 'Sora-Medium' as const,
    letterSpacing: 0,
  },
  // Metadata label — small text with heavier weight for legibility (optical sizing)
  metadataLabel: {
    size: 12,
    lineHeight: 16,
    weight: '600' as const,
    fontFamily: 'Sora-SemiBold' as const,
    letterSpacing: 0.5,
  },
  button: {
    size: 16,
    lineHeight: 24,
    weight: '600' as const,
    fontFamily: 'Sora-SemiBold' as const,
    letterSpacing: 0.3,
  },
  buttonSmall: {
    size: 14,
    lineHeight: 20,
    weight: '600' as const,
    fontFamily: 'Sora-SemiBold' as const,
    letterSpacing: 0.3,
  },

  // Special treatments — For emphasis and celebratory moments
  achievement: {
    size: 24,
    lineHeight: 32,
    weight: '700' as const,
    fontFamily: 'Sora-Bold' as const,
    letterSpacing: 0.5,
  },
  encouragement: {
    size: 18,
    lineHeight: 28,
    weight: '400' as const,
    fontFamily: 'Sora-Regular' as const,
    letterSpacing: 0.1,
    fontStyle: 'italic' as const, // Warm, personal feel — use sparingly
  },

  // Signature patterns — Expressive typography for distinctive moments.
  // Pair heroLight with heroBold to create a weight gradient.
  signature: {
    heroLight: {
      size: 40,
      lineHeight: 48,
      weight: '200' as const,
      fontFamily: 'Sora-ExtraLight' as const,
      letterSpacing: -0.8,
    },
    heroBold: {
      size: 40,
      lineHeight: 48,
      weight: '700' as const,
      fontFamily: 'Sora-Bold' as const,
      letterSpacing: -0.8,
    },
    milestoneHeading: {
      size: 32,
      lineHeight: 40,
      weight: '800' as const,
      fontFamily: 'Sora-ExtraBold' as const,
      letterSpacing: -1,
    },
    contemplative: {
      size: 18,
      lineHeight: 32,
      weight: '300' as const,
      fontFamily: 'Sora-Light' as const,
      letterSpacing: 0.2,
    },
  },
} as const;

/**
 * Tailwind class mappings for typography.
 *
 * Best Practices:
 * - Pair heavy weights (h1, display) with light weights (bodyLight) for contrast
 * - Never use text smaller than 16px for body content
 * - Pair signature.heroLight with signature.heroBold for weight gradients
 */
export const typographyClasses = {
  displayLarge: 'text-[56px] leading-[64px] font-extrabold tracking-tight',
  display: 'text-[32px] leading-[40px] font-extrabold tracking-tight',
  h1: 'text-[32px] leading-[40px] font-bold tracking-tight',
  h2: 'text-2xl leading-8 font-semibold',
  h3: 'text-xl leading-7 font-semibold',
  h4: 'text-lg leading-[26px] font-semibold',
  body: 'text-base leading-6',
  bodyLarge: 'text-lg leading-7',
  bodySmall: 'text-sm leading-5',
  bodyLight: 'text-base leading-6 font-light',
  caption: 'text-sm leading-5',
  label: 'text-sm leading-5 font-medium',
  metadataLabel: 'text-xs leading-4 font-semibold tracking-wide uppercase',
  button: 'text-base leading-6 font-semibold tracking-wide',
  buttonSmall: 'text-sm leading-5 font-semibold tracking-wide',
  achievement: 'text-2xl leading-8 font-bold tracking-wide',
  encouragement: 'text-lg leading-7 italic tracking-wide',
  signature: {
    heroLight: 'text-[40px] leading-[48px] font-extralight tracking-tight',
    heroBold: 'text-[40px] leading-[48px] font-bold tracking-tight',
    milestoneHeading:
      'text-[32px] leading-[40px] font-extrabold tracking-tight',
    contemplative: 'text-lg leading-[32px] font-light tracking-wide',
  },
} as const;

export type TypographyScale = keyof typeof typography;
export type TypographyClass = keyof typeof typographyClasses;
