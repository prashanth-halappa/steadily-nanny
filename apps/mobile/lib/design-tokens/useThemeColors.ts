/**
 * Theme-aware color hook for inline styles.
 *
 * Returns the correct color set (light or dark) based on the color scheme.
 * This is the SANCTIONED inline-style path for cases where a NativeWind
 * `className` cannot be used — notably Reanimated `Animated.View`,
 * `LinearGradient` color arrays, and SVG fill/stroke props.
 *
 * For static components, prefer Tailwind classes (bg-background, text-foreground,
 * etc.) which adapt automatically via the CSS variables in global.css.
 *
 * Values project from `palette.ts` (Daylight). Dark is wired & parity-tested but
 * unverified — `useColorScheme` hard-forces light (see lib/useColorScheme.ts).
 */

import { useColorScheme } from '@/lib/useColorScheme';
import { palette } from './palette';

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  mutedStrong: string;
  accent: string;
  accentForeground: string;
  highlight: string;
  highlightForeground: string;
  /** Opaque tone-surface tints for `<Card tone="…">` — never a translucent `bg-card/90`-style class. */
  surfaceAttention: string;
  surfacePositive: string;
  surfaceLive: string;
  surfaceCritical: string;
  washPlum: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successInk: string;
  warning: string;
  warningStrong: string;
  warningInk: string;
  warningForeground: string;
  shortNotice: string;
  shortNoticeInk: string;
  shortNoticeStrong: string;
  pill: {
    success: string;
    warning: string;
    destructive: string;
    shortNotice: string;
  };
  chip: {
    plum: string;
    cat1: string;
    cat2: string;
    cat3: string;
  };
  border: string;
  borderStrong: string;
  input: string;
  ring: string;
  neutral: string;
  /** Three category accent hues (Daylight palette). */
  category: { accent1: string; accent2: string; accent3: string };
  skeleton: { base: string; highlight: string };
  errorInline: { bg: string; border: string; text: string };
  gray: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
  };
  /** Ink for modal/sheet overlays — apply alpha in style. */
  scrim: string;
}

function themeFromPalette(
  mode: (typeof palette)['light'] | (typeof palette)['dark']
): ThemeColors {
  return {
    background: mode.background.hex,
    foreground: mode.foreground.hex,
    card: mode.card.hex,
    cardForeground: mode.cardForeground.hex,
    popover: mode.popover.hex,
    popoverForeground: mode.popoverForeground.hex,
    primary: mode.primary.hex,
    primaryLight: mode.primaryLight.hex,
    primaryDark: mode.primaryDark.hex,
    primaryForeground: mode.primaryForeground.hex,
    secondary: mode.secondary.hex,
    secondaryForeground: mode.secondaryForeground.hex,
    muted: mode.muted.hex,
    mutedForeground: mode.mutedForeground.hex,
    mutedStrong: mode.mutedStrong.hex,
    accent: mode.accent.hex,
    accentForeground: mode.accentForeground.hex,
    highlight: mode.highlight.hex,
    highlightForeground: mode.highlightForeground.hex,
    surfaceAttention: mode.surfaceAttention.hex,
    surfacePositive: mode.surfacePositive.hex,
    surfaceLive: mode.surfaceLive.hex,
    surfaceCritical: mode.surfaceCritical.hex,
    washPlum: mode.washPlum.hex,
    destructive: mode.destructive.hex,
    destructiveForeground: mode.destructiveForeground.hex,
    success: mode.success.hex,
    successInk: mode.successInk.hex,
    warning: mode.warning.hex,
    warningStrong: mode.warningStrong.hex,
    warningInk: mode.warningInk.hex,
    warningForeground: mode.warningForeground.hex,
    shortNotice: mode.shortNotice.hex,
    shortNoticeInk: mode.shortNoticeInk.hex,
    shortNoticeStrong: mode.shortNoticeStrong.hex,
    pill: {
      success: mode.pillSuccess.hex,
      warning: mode.pillWarning.hex,
      destructive: mode.pillDestructive.hex,
      shortNotice: mode.pillShortNotice.hex,
    },
    chip: {
      plum: mode.chipPlum.hex,
      cat1: mode.chipCat1.hex,
      cat2: mode.chipCat2.hex,
      cat3: mode.chipCat3.hex,
    },
    border: mode.border.hex,
    borderStrong: mode.borderStrong.hex,
    input: mode.input.hex,
    ring: mode.ring.hex,
    neutral: mode.neutral.hex,
    category: {
      accent1: mode.categoryAccent1.hex,
      accent2: mode.categoryAccent2.hex,
      accent3: mode.categoryAccent3.hex,
    },
    skeleton: {
      base: mode.skeletonBase.hex,
      highlight: mode.skeletonHighlight.hex,
    },
    errorInline: {
      bg: mode.errorInlineBg.hex,
      border: mode.errorInlineBorder.hex,
      text: mode.errorInlineText.hex,
    },
    gray: {
      50: mode.gray50.hex,
      100: mode.gray100.hex,
      200: mode.gray200.hex,
      300: mode.gray300.hex,
      400: mode.gray400.hex,
      500: mode.gray500.hex,
      600: mode.gray600.hex,
      700: mode.gray700.hex,
      800: mode.gray800.hex,
      900: mode.gray900.hex,
    },
    scrim: mode.scrim.hex,
  };
}

const lightColors: ThemeColors = themeFromPalette(palette.light);
const darkColors: ThemeColors = themeFromPalette(palette.dark);

/**
 * Returns theme-aware colors for use in inline styles.
 *
 * Prefer Tailwind classes (bg-background, text-foreground) for static components.
 * Use this hook only for:
 * - Reanimated Animated.View (NativeWind className doesn't work reliably)
 * - Dynamic style calculations
 * - LinearGradient colors
 * - SVG fill/stroke
 */
export function useThemeColors(): ThemeColors {
  const { isDarkColorScheme } = useColorScheme();
  return isDarkColorScheme ? darkColors : lightColors;
}

/**
 * Returns both color sets for components that need to compare or interpolate.
 */
export function useThemeColorSets() {
  const { isDarkColorScheme } = useColorScheme();
  return {
    colors: isDarkColorScheme ? darkColors : lightColors,
    isDark: isDarkColorScheme,
    light: lightColors,
    dark: darkColors,
  };
}

/**
 * Drop-in replacement for static `colors` imports in React components.
 * Prefer Tailwind semantic classes for static UI; use this when inline styles are required.
 */
export function useDesignColors() {
  const c = useThemeColors();
  return {
    foreground: c.foreground,
    mutedForeground: c.mutedForeground,
    background: c.background,
    card: c.card,
    cardForeground: c.cardForeground,
    primary: c.primary,
    primaryForeground: c.primaryForeground,
    muted: c.muted,
    border: c.border,
    accent: c.accent,
    destructive: c.destructive,
    category: c.category,
    gray: c.gray,
  };
}
