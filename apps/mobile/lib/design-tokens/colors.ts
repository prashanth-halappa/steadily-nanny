/**
 * Color Design Tokens — light-mode static projection of `palette.ts` (Daylight).
 *
 * Usage Rules:
 * - Primary color: Only for main CTAs (1-2 per screen max)
 * - Neutrals: For 90% of UI
 * - Category accents: Use at ~10% opacity for subtle differentiation
 *
 * These static tokens are LIGHT-MODE values. For theme-aware inline styling
 * (Animated.View, LinearGradient, SVG) prefer `useThemeColors()`.
 * Prefer Tailwind alpha for tinted grounds (`bg-success/10`) over `.light` keys.
 */

import { palette } from './palette';

const light = palette.light;

export const colors = {
  primary: {
    DEFAULT: light.primary.hex,
    light: light.primaryLight.hex,
    dark: light.primaryDark.hex,
    foreground: light.primaryForeground.hex,
  },

  /**
   * @deprecated Light-mode only. Use `useThemeColors()` / `useDesignColors()` or `bg-background`.
   */
  background: {
    DEFAULT: light.background.hex,
    secondary: light.muted.hex,
  },
  /**
   * @deprecated Light-mode only. Use `useThemeColors().foreground` or `text-foreground`.
   */
  foreground: {
    DEFAULT: light.foreground.hex,
    secondary: light.mutedForeground.hex,
    tertiary: light.gray400.hex,
  },
  /**
   * @deprecated Light-mode only. Use `useThemeColors().muted` / `.mutedForeground` or semantic Tailwind.
   */
  muted: {
    DEFAULT: light.muted.hex,
    foreground: light.mutedForeground.hex,
  },
  border: {
    DEFAULT: light.border.hex,
    strong: light.borderStrong.hex,
  },

  success: {
    DEFAULT: light.success.hex,
    foreground: light.primaryForeground.hex,
  },
  warning: {
    DEFAULT: light.warning.hex,
    foreground: light.warningForeground.hex,
  },
  error: {
    DEFAULT: light.destructive.hex,
    foreground: light.destructiveForeground.hex,
  },
  destructive: {
    DEFAULT: light.destructive.hex,
    foreground: light.destructiveForeground.hex,
  },

  category: {
    accent1: light.categoryAccent1.hex,
    accent2: light.categoryAccent2.hex,
    accent3: light.categoryAccent3.hex,
  },

  accent: {
    DEFAULT: light.accent.hex,
    foreground: light.accentForeground.hex,
  },
  secondary: {
    DEFAULT: light.secondary.hex,
    foreground: light.secondaryForeground.hex,
  },

  card: {
    DEFAULT: light.card.hex,
    foreground: light.cardForeground.hex,
  },

  skeleton: {
    base: light.skeletonBase.hex,
    highlight: light.skeletonHighlight.hex,
  },

  errorInline: {
    bg: light.errorInlineBg.hex,
    border: light.errorInlineBorder.hex,
    text: light.errorInlineText.hex,
  },

  input: light.input.hex,
  ring: light.ring.hex,
  neutral: light.neutral.hex,
} as const;

/**
 * Opacity variants for backgrounds.
 * Use these for subtle color differentiation.
 */
export const opacity = {
  5: '0D',
  10: '1A',
  15: '26',
  20: '33',
  30: '4D',
  40: '66',
  50: '80',
  60: '99',
  70: 'B3',
  80: 'CC',
  90: 'E6',
} as const;

/**
 * Helper to create a color with opacity.
 * Example: getColorWithOpacity(colors.primary.DEFAULT, 10) => '#5B3E5D1A'
 */
export const getColorWithOpacity = (
  color: string,
  opacityPercent: keyof typeof opacity
): string => {
  return `${color}${opacity[opacityPercent]}`;
};

/**
 * Category accent color helper — keyed 1/2/3.
 */
export const getCategoryColor = (accentId: number): string => {
  switch (accentId) {
    case 1:
      return colors.category.accent1;
    case 2:
      return colors.category.accent2;
    case 3:
      return colors.category.accent3;
    default:
      return colors.muted.DEFAULT;
  }
};

export const getCategoryColorWithOpacity = (
  accentId: number,
  opacityPercent: keyof typeof opacity = 10
): string => {
  const color = getCategoryColor(accentId);
  return getColorWithOpacity(color, opacityPercent);
};

/**
 * Tailwind class mappings for common color usage.
 */
export const colorClasses = {
  bgPrimary: 'bg-primary',
  bgSecondary: 'bg-secondary',
  bgMuted: 'bg-muted',
  bgSuccess: 'bg-success',
  bgWarning: 'bg-warning',
  bgError: 'bg-destructive',

  textPrimary: 'text-foreground',
  textSecondary: 'text-muted-foreground',
  textMuted: 'text-muted-foreground',
  textSuccess: 'text-success',
  textWarning: 'text-warning',
  textError: 'text-destructive',

  borderDefault: 'border-border',
  borderStrong: 'border-border-strong',

  bgCategoryAccent1: 'bg-category-accent1/10',
  bgCategoryAccent2: 'bg-category-accent2/10',
  bgCategoryAccent3: 'bg-category-accent3/10',
} as const;

export type ColorToken = typeof colors;
export type ColorClass = keyof typeof colorClasses;
