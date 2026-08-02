/**
 * Ledger palette — single authored source of truth.
 *
 * Each token holds both notations because neither derives from the other at
 * runtime (Tailwind reads CSS vars; Animated/SVG/LinearGradient need hex):
 * - `css` — HSL channel triple for `global.css` (`hsl(var(--token))`)
 * - `hex` — literal for inline styles
 *
 * Dark values are wired and parity-tested but unverified — `useColorScheme`
 * hard-forces light. Correct, not designed.
 */

export type PaletteEntry = {
  /** Space-separated HSL channels, e.g. `"216 64% 34%"` (no `hsl()` wrapper). */
  css: string;
  hex: string;
};

/**
 * Maps palette key → CSS custom property name (without `--`).
 * Bidirectional parity tests walk this map.
 */
export const PALETTE_CSS_VARS = {
  background: 'background',
  foreground: 'foreground',
  card: 'card',
  cardForeground: 'card-foreground',
  popover: 'popover',
  popoverForeground: 'popover-foreground',
  primary: 'primary',
  primaryForeground: 'primary-foreground',
  primaryLight: 'primary-light',
  primaryDark: 'primary-dark',
  secondary: 'secondary',
  secondaryForeground: 'secondary-foreground',
  muted: 'muted',
  mutedForeground: 'muted-foreground',
  accent: 'accent',
  accentForeground: 'accent-foreground',
  categoryAccent1: 'category-accent1',
  categoryAccent2: 'category-accent2',
  categoryAccent3: 'category-accent3',
  destructive: 'destructive',
  destructiveForeground: 'destructive-foreground',
  success: 'success-state',
  warning: 'warning',
  warningForeground: 'warning-foreground',
  border: 'border',
  borderStrong: 'border-strong',
  input: 'input',
  ring: 'ring',
  neutral: 'neutral',
  skeletonBase: 'skeleton-base',
  skeletonHighlight: 'skeleton-highlight',
  errorInlineBg: 'error-inline-bg',
  errorInlineBorder: 'error-inline-border',
  errorInlineText: 'error-inline-text',
  gray50: 'gray-50',
  gray100: 'gray-100',
  gray200: 'gray-200',
  gray300: 'gray-300',
  gray400: 'gray-400',
  gray500: 'gray-500',
  gray600: 'gray-600',
  gray700: 'gray-700',
  gray800: 'gray-800',
  gray900: 'gray-900',
  scrim: 'scrim',
} as const;

export type PaletteKey = keyof typeof PALETTE_CSS_VARS;

export type PaletteMode = Record<PaletteKey, PaletteEntry>;

export const palette = {
  light: {
    background: { css: '240 20% 99%', hex: '#FCFCFD' },
    foreground: { css: '220 13% 9%', hex: '#14161A' },
    card: { css: '0 0% 100%', hex: '#FFFFFF' },
    cardForeground: { css: '220 13% 9%', hex: '#14161A' },
    popover: { css: '0 0% 100%', hex: '#FFFFFF' },
    popoverForeground: { css: '220 13% 9%', hex: '#14161A' },

    primary: { css: '216 64% 34%', hex: '#1F4A8C' },
    primaryForeground: { css: '0 0% 100%', hex: '#FFFFFF' },
    primaryLight: { css: '216 64% 48%', hex: '#2C6BC9' },
    primaryDark: { css: '216 64% 26%', hex: '#183A6D' },

    secondary: { css: '220 10% 93%', hex: '#EBEDF0' },
    secondaryForeground: { css: '220 13% 9%', hex: '#14161A' },
    muted: { css: '220 13% 95%', hex: '#F2F3F5' },
    mutedForeground: { css: '214 7% 38%', hex: '#5A6068' },

    // Semantic change: accent is a subtle hover ground, not orange.
    accent: { css: '220 13% 95%', hex: '#F2F3F5' },
    accentForeground: { css: '220 13% 9%', hex: '#14161A' },

    categoryAccent1: { css: '214 35% 37%', hex: '#3D5A80' },
    categoryAccent2: { css: '164 18% 35%', hex: '#4A6B62' },
    categoryAccent3: { css: '30 33% 36%', hex: '#7A5C3E' },

    destructive: { css: '3 54% 39%', hex: '#98332E' },
    destructiveForeground: { css: '0 0% 100%', hex: '#FFFFFF' },
    success: { css: '152 40% 30%', hex: '#2E6B4F' },
    warning: { css: '42 63% 33%', hex: '#8A6A1F' },
    warningForeground: { css: '0 0% 100%', hex: '#FFFFFF' },

    border: { css: '214 13% 90%', hex: '#E1E4E8' },
    borderStrong: { css: '212 14% 82%', hex: '#CBD1D8' },
    input: { css: '220 13% 95%', hex: '#F2F3F5' },
    ring: { css: '216 64% 34%', hex: '#1F4A8C' },
    neutral: { css: '0 0% 66%', hex: '#A8A8A8' },

    skeletonBase: { css: '220 13% 95%', hex: '#F2F3F5' },
    skeletonHighlight: { css: '210 20% 98%', hex: '#F9FAFB' },

    errorInlineBg: { css: '30 100% 96%', hex: '#FFF5EB' },
    errorInlineBorder: { css: '3 54% 70%', hex: '#DC8D89' },
    errorInlineText: { css: '3 54% 30%', hex: '#762723' },

    gray50: { css: '210 20% 98%', hex: '#F9FAFB' },
    gray100: { css: '220 13% 95%', hex: '#F2F3F5' },
    gray200: { css: '214 13% 90%', hex: '#E1E4E8' },
    gray300: { css: '212 14% 82%', hex: '#CBD1D8' },
    gray400: { css: '214 8% 65%', hex: '#9FA5AD' },
    gray500: { css: '214 7% 46%', hex: '#6B7280' },
    gray600: { css: '214 7% 38%', hex: '#5A6068' },
    gray700: { css: '217 19% 27%', hex: '#374151' },
    gray800: { css: '215 28% 17%', hex: '#1F2937' },
    gray900: { css: '220 13% 9%', hex: '#14161A' },

    // Ink at full saturation — apply alpha at the call site (bg-scrim/80).
    scrim: { css: '220 13% 9%', hex: '#14161A' },
  } satisfies PaletteMode,

  dark: {
    background: { css: '218 22% 7%', hex: '#0E1116' },
    foreground: { css: '214 17% 92%', hex: '#E7EAEE' },
    card: { css: '215 23% 10%', hex: '#141920' },
    cardForeground: { css: '214 17% 92%', hex: '#E7EAEE' },
    popover: { css: '215 23% 10%', hex: '#141920' },
    popoverForeground: { css: '214 17% 92%', hex: '#E7EAEE' },

    primary: { css: '216 70% 70%', hex: '#7FA9E8' },
    primaryForeground: { css: '218 22% 7%', hex: '#0E1116' },
    primaryLight: { css: '216 70% 78%', hex: '#A0BFEE' },
    primaryDark: { css: '216 70% 60%', hex: '#528BE0' },

    secondary: { css: '215 18% 16%', hex: '#212830' },
    secondaryForeground: { css: '214 17% 92%', hex: '#E7EAEE' },
    muted: { css: '215 23% 12%', hex: '#181D26' },
    mutedForeground: { css: '213 10% 64%', hex: '#9BA3AD' },

    accent: { css: '215 23% 12%', hex: '#181D26' },
    accentForeground: { css: '214 17% 92%', hex: '#E7EAEE' },

    categoryAccent1: { css: '214 35% 55%', hex: '#6487B4' },
    categoryAccent2: { css: '164 25% 50%', hex: '#609F8E' },
    categoryAccent3: { css: '30 35% 55%', hex: '#B48C64' },

    destructive: { css: '4 65% 65%', hex: '#E0756D' },
    destructiveForeground: { css: '218 22% 7%', hex: '#0E1116' },
    success: { css: '152 43% 56%', hex: '#5FBF92' },
    warning: { css: '41 65% 54%', hex: '#D6A63F' },
    warningForeground: { css: '218 22% 7%', hex: '#0E1116' },

    border: { css: '214 18% 17%', hex: '#242B34' },
    borderStrong: { css: '214 18% 24%', hex: '#323C48' },
    input: { css: '215 18% 14%', hex: '#1D232A' },
    ring: { css: '216 70% 70%', hex: '#7FA9E8' },
    neutral: { css: '0 0% 50%', hex: '#808080' },

    skeletonBase: { css: '215 23% 12%', hex: '#181D26' },
    skeletonHighlight: { css: '214 18% 17%', hex: '#242B34' },

    errorInlineBg: { css: '4 40% 12%', hex: '#2B1412' },
    errorInlineBorder: { css: '4 40% 28%', hex: '#642F2B' },
    errorInlineText: { css: '4 65% 72%', hex: '#E68F89' },

    gray50: { css: '215 23% 10%', hex: '#141920' },
    gray100: { css: '215 23% 12%', hex: '#181D26' },
    gray200: { css: '214 18% 17%', hex: '#242B34' },
    gray300: { css: '214 18% 24%', hex: '#323C48' },
    gray400: { css: '213 10% 45%', hex: '#67727E' },
    gray500: { css: '213 10% 55%', hex: '#818B98' },
    gray600: { css: '213 10% 64%', hex: '#9BA3AD' },
    gray700: { css: '214 14% 75%', hex: '#B8BEC6' },
    gray800: { css: '214 16% 88%', hex: '#DDE1E6' },
    gray900: { css: '214 17% 92%', hex: '#E7EAEE' },

    scrim: { css: '218 22% 7%', hex: '#0E1116' },
  } satisfies PaletteMode,
} as const;

/** Old brand child swatches → Ledger category accents. Unmapped values pass through. */
export const LEDGER_SWATCH_MAP: Readonly<Record<string, string>> = {
  '#6366F1': '#3D5A80',
  '#14B8A6': '#4A6B62',
  '#EC4899': '#7A5C3E',
  // lowercase variants (API may normalise either way)
  '#6366f1': '#3D5A80',
  '#14b8a6': '#4A6B62',
  '#ec4899': '#7A5C3E',
};

export function remapChildSwatch(colour: string): string {
  return (
    LEDGER_SWATCH_MAP[colour] ??
    LEDGER_SWATCH_MAP[colour.toLowerCase()] ??
    colour
  );
}
