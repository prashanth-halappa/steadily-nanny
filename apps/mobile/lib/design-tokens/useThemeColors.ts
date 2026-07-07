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
 * NOTE: `useColorScheme` currently hard-forces light mode (see lib/useColorScheme.ts).
 * The dark palette below is authored and ready but stays dormant until you wire up
 * the Appearance API. See lib/useColorScheme.ts for details.
 */

import { useColorScheme } from '@/lib/useColorScheme';

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
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  warning: string;
  warningForeground: string;
  border: string;
  borderStrong: string;
  input: string;
  ring: string;
  neutral: string;
  /** Three generic, meaning-free category accent hues. */
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
}

const lightColors: ThemeColors = {
  // Core surfaces
  background: '#FFFFFF',
  foreground: '#17181A',
  card: '#FFFFFF',
  cardForeground: '#17181A',
  popover: '#FFFFFF',
  popoverForeground: '#17181A',

  // Primary
  primary: '#3B6FF5',
  primaryLight: '#6B92F7',
  primaryDark: '#2B5AD4',
  primaryForeground: '#FFFFFF',

  // Secondary & Muted
  secondary: '#EDEEF0',
  secondaryForeground: '#17181A',
  muted: '#F4F5F7',
  mutedForeground: '#777E8B',

  // Accent
  accent: '#EF7B45',
  accentForeground: '#FFFFFF',

  // System
  destructive: '#DC2626',
  destructiveForeground: '#FFFFFF',
  success: '#2DA86B',
  warning: '#F59E0B',
  warningForeground: '#17181A',

  // UI elements
  border: '#E3E5E8',
  borderStrong: '#C4C8CE',
  input: '#F4F5F7',
  ring: '#3B6FF5',
  neutral: '#A8A8A8',

  // Category accents (indigo / teal / pink)
  category: {
    accent1: '#6366F1',
    accent2: '#14B8A6',
    accent3: '#EC4899',
  },

  // Specialty: Skeleton
  skeleton: { base: '#F0F1F3', highlight: '#F9FAFB' },

  // Specialty: Inline Error
  errorInline: { bg: '#FFF7ED', border: '#FDBA74', text: '#9A3412' },

  // Gray scale
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
};

const darkColors: ThemeColors = {
  // Core surfaces (warm neutral)
  background: '#18181B',
  foreground: '#F4F5F7',
  card: '#232326',
  cardForeground: '#F4F5F7',
  popover: '#232326',
  popoverForeground: '#F4F5F7',

  // Primary
  primary: '#6B92F7',
  primaryLight: '#8BABF9',
  primaryDark: '#3B6FF5',
  primaryForeground: '#18181B',

  // Secondary & Muted
  secondary: '#303033',
  secondaryForeground: '#F4F5F7',
  muted: '#27272A',
  mutedForeground: '#C2C5CC',

  // Accent
  accent: '#EF7B45',
  accentForeground: '#18181B',

  // System
  destructive: '#EF4444',
  destructiveForeground: '#18181B',
  success: '#4ADE80',
  warning: '#FBBF24',
  warningForeground: '#18181B',

  // UI elements
  border: '#343437',
  borderStrong: '#454548',
  input: '#2B2B2E',
  ring: '#6B92F7',
  neutral: '#808080',

  // Category accents (brighter for dark backgrounds)
  category: {
    accent1: '#818CF8',
    accent2: '#2DD4BF',
    accent3: '#F472B6',
  },

  // Specialty: Skeleton
  skeleton: { base: '#27272A', highlight: '#343437' },

  // Specialty: Inline Error
  errorInline: { bg: '#2A1F1A', border: '#7A3A1A', text: '#FDBA74' },

  // Gray scale (inverted: 50=subtle dark bg, 900=strong light text)
  gray: {
    50: '#232326',
    100: '#27272A',
    200: '#343437',
    300: '#454548',
    400: '#6E7078',
    500: '#898B93',
    600: '#A8ABB3',
    700: '#C0C3CA',
    800: '#DFE1E5',
    900: '#F4F5F7',
  },
};

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
