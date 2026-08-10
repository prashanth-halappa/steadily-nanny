/**
 * Daylight palette — single authored source of truth.
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
  mutedStrong: 'muted-strong',
  accent: 'accent',
  accentForeground: 'accent-foreground',
  highlight: 'highlight',
  highlightForeground: 'highlight-foreground',
  /** Opaque apricot-on-card ground for `<Card tone="live">` — mirrors `liveCardBackground()`. */
  surfaceLive: 'surface-live',
  washPlum: 'wash-plum',
  categoryAccent1: 'category-accent1',
  categoryAccent2: 'category-accent2',
  categoryAccent3: 'category-accent3',
  destructive: 'destructive',
  destructiveForeground: 'destructive-foreground',
  success: 'success-state',
  successInk: 'success-ink',
  warning: 'warning',
  warningStrong: 'warning-strong',
  warningInk: 'warning-ink',
  warningForeground: 'warning-foreground',
  /** Opaque warning-on-card ground for `<Card tone="attention">`. */
  surfaceAttention: 'surface-attention',
  /** Opaque success-on-card ground for `<Card tone="positive">`. */
  surfacePositive: 'surface-positive',
  /** Opaque destructive-on-card ground for `<Card tone="critical">`. */
  surfaceCritical: 'surface-critical',
  pillSuccess: 'pill-success',
  pillWarning: 'pill-warning',
  pillDestructive: 'pill-destructive',
  pillShortNotice: 'pill-short-notice',
  chipPlum: 'chip-plum',
  chipCat1: 'chip-cat1',
  chipCat2: 'chip-cat2',
  chipCat3: 'chip-cat3',
  shortNotice: 'short-notice',
  shortNoticeInk: 'short-notice-ink',
  shortNoticeStrong: 'short-notice-strong',
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
    background: { css: '345 17% 95%', hex: '#F5F1F2' },
    foreground: { css: '295 16% 15%', hex: '#2A1F2B' },
    card: { css: '0 0% 100%', hex: '#FFFFFF' },
    cardForeground: { css: '295 16% 15%', hex: '#2A1F2B' },
    popover: { css: '0 0% 100%', hex: '#FFFFFF' },
    popoverForeground: { css: '295 16% 15%', hex: '#2A1F2B' },

    primary: { css: '296 20% 30%', hex: '#5B3E5D' },
    primaryForeground: { css: '0 0% 100%', hex: '#FFFFFF' },
    primaryLight: { css: '295 17% 43%', hex: '#7C5A7F' },
    primaryDark: { css: '303 22% 21%', hex: '#40293F' },

    secondary: { css: '323 18% 91%', hex: '#EDE5EA' },
    secondaryForeground: { css: '295 16% 15%', hex: '#2A1F2B' },
    muted: { css: '326 19% 93%', hex: '#F0E9ED' },
    mutedForeground: { css: '291 7% 41%', hex: '#6E6270' },
    mutedStrong: { css: '291 7% 35%', hex: '#5F5461' },

    // Semantic: accent is a subtle hover ground, not apricot.
    accent: { css: '322 20% 92%', hex: '#EFE7EC' },
    accentForeground: { css: '295 16% 15%', hex: '#2A1F2B' },
    highlight: { css: '24 79% 57%', hex: '#E8823C' },
    highlightForeground: { css: '295 16% 15%', hex: '#2A1F2B' },
    // mixHex(card, highlight, 0.08) — same value as liveCardBackground('light').
    surfaceLive: { css: '26 78% 96%', hex: '#FDF5EF' },
    // mixHex(background, primary, 0.14)
    washPlum: { css: '317 10% 86%', hex: '#DFD8DD' },

    categoryAccent1: { css: '282 22% 38%', hex: '#6A4C77' },
    categoryAccent2: { css: '159 23% 39%', hex: '#4C7A6A' },
    categoryAccent3: { css: '347 30% 51%', hex: '#A85E6E' },

    destructive: { css: '7 42% 46%', hex: '#A85145' },
    destructiveForeground: { css: '0 0% 100%', hex: '#FFFFFF' },
    success: { css: '143 24% 38%', hex: '#4A7A5C' },
    successInk: { css: '147 31% 27%', hex: '#2F5A42' },
    warning: { css: '35 51% 50%', hex: '#C08A3E' },
    // Fails AA for text on every tinted ground (3.77:1 on surfaceAttention v2). Non-text uses only.
    warningStrong: { css: '35 54% 40%', hex: '#9C6E2E' },
    warningInk: { css: '37 59% 27%', hex: '#6E4E1C' },
    warningForeground: { css: '295 16% 15%', hex: '#2A1F2B' },
    // mixHex(card, warning, 0.18)
    surfaceAttention: { css: '35 52% 91%', hex: '#F4EADC' },
    // mixHex(card, success, 0.12)
    surfacePositive: { css: '140 16% 93%', hex: '#E9EFEB' },
    // mixHex(card, destructive, 0.14)
    surfaceCritical: { css: '9 37% 93%', hex: '#F3E7E5' },
    pillSuccess: { css: '147 16% 89%', hex: '#DEE7E2' },
    pillWarning: { css: '34 50% 89%', hex: '#F1E5D5' },
    pillDestructive: { css: '7 35% 90%', hex: '#EFE0DE' },
    pillShortNotice: { css: '20 52% 91%', hex: '#F4E4DC' },
    chipPlum: { css: '285 10% 92%', hex: '#EBE8EC' },
    chipCat1: { css: '276 14% 93%', hex: '#EDEAEF' },
    chipCat2: { css: '156 14% 93%', hex: '#EAEFED' },
    chipCat3: { css: '347 31% 94%', hex: '#F5ECEE' },
    shortNotice: { css: '20 54% 50%', hex: '#C4693A' },
    shortNoticeInk: { css: '20 65% 30%', hex: '#7E3C1B' },
    shortNoticeStrong: { css: '21 60% 43%', hex: '#B15A2C' },

    border: { css: '323 13% 88%', hex: '#E5DDE2' },
    borderStrong: { css: '323 13% 80%', hex: '#D2C5CD' },
    input: { css: '326 19% 93%', hex: '#F0E9ED' },
    ring: { css: '296 20% 30%', hex: '#5B3E5D' },
    neutral: { css: '315 6% 61%', hex: '#A2969F' },

    skeletonBase: { css: '322 20% 92%', hex: '#EFE7EC' },
    skeletonHighlight: { css: '330 25% 97%', hex: '#F9F5F7' },

    errorInlineBg: { css: '12 65% 95%', hex: '#FBEFEC' },
    errorInlineBorder: { css: '9 48% 74%', hex: '#DDA79D' },
    errorInlineText: { css: '8 44% 33%', hex: '#7A392F' },

    gray50: { css: '320 23% 97%', hex: '#FAF7F9' },
    gray100: { css: '330 19% 94%', hex: '#F2ECEF' },
    gray200: { css: '323 13% 88%', hex: '#E5DDE2' },
    gray300: { css: '323 13% 80%', hex: '#D2C5CD' },
    gray400: { css: '295 6% 58%', hex: '#9A8E9B' },
    gray500: { css: '291 6% 47%', hex: '#7E7280' },
    gray600: { css: '291 7% 41%', hex: '#6E6270' },
    gray700: { css: '291 9% 29%', hex: '#4E4350' },
    gray800: { css: '295 12% 21%', hex: '#3A2E3B' },
    gray900: { css: '295 16% 15%', hex: '#2A1F2B' },

    // Ink at full saturation — apply alpha at the call site (bg-scrim/80).
    scrim: { css: '295 16% 15%', hex: '#2A1F2B' },
  } satisfies PaletteMode,

  dark: {
    background: { css: '291 14% 10%', hex: '#1B151C' },
    foreground: { css: '309 20% 93%', hex: '#F1EAF0' },
    card: { css: '288 15% 13%', hex: '#241C26' },
    cardForeground: { css: '309 20% 93%', hex: '#F1EAF0' },
    popover: { css: '288 15% 13%', hex: '#241C26' },
    popoverForeground: { css: '309 20% 93%', hex: '#F1EAF0' },

    primary: { css: '297 28% 72%', hex: '#C9A2CB' },
    primaryForeground: { css: '291 14% 10%', hex: '#1B151C' },
    primaryLight: { css: '298 32% 80%', hex: '#DBBBDC' },
    primaryDark: { css: '296 22% 58%', hex: '#A97CAC' },

    secondary: { css: '286 15% 17%', hex: '#2E2431' },
    secondaryForeground: { css: '309 20% 93%', hex: '#F1EAF0' },
    muted: { css: '278 20% 16%', hex: '#2A2030' },
    mutedForeground: { css: '296 9% 67%', hex: '#B2A4B3' },
    // unverified — dark mode is undesigned
    mutedStrong: { css: '291 9% 29%', hex: '#4E4350' },

    accent: { css: '286 15% 17%', hex: '#2E2431' },
    accentForeground: { css: '309 20% 93%', hex: '#F1EAF0' },
    highlight: { css: '27 87% 62%', hex: '#F2954B' },
    highlightForeground: { css: '291 14% 10%', hex: '#1B151C' },
    // mixHex('#241C26', '#F2954B', 0.08)
    surfaceLive: { css: '347 16% 18%', hex: '#342629' },
    // unverified — dark mode is undesigned
    washPlum: { css: '286 15% 17%', hex: '#2E2431' },

    categoryAccent1: { css: '284 21% 63%', hex: '#A98CB4' },
    categoryAccent2: { css: '159 28% 59%', hex: '#79B39F' },
    categoryAccent3: { css: '349 45% 72%', hex: '#D796A2' },

    destructive: { css: '6 61% 67%', hex: '#DE8378' },
    destructiveForeground: { css: '291 14% 10%', hex: '#1B151C' },
    success: { css: '142 35% 58%', hex: '#6FB98A' },
    // unverified — dark mode is undesigned
    successInk: { css: '142 35% 58%', hex: '#6FB98A' },
    warning: { css: '37 67% 63%', hex: '#E0B061' },
    warningStrong: { css: '38 77% 73%', hex: '#EFC886' },
    // unverified — dark mode is undesigned
    warningInk: { css: '38 77% 73%', hex: '#EFC886' },
    warningForeground: { css: '291 14% 10%', hex: '#1B151C' },
    // mixHex('#241C26', '#E0B061', 0.12)
    surfaceAttention: { css: '4 13% 20%', hex: '#3B2E2D' },
    // mixHex('#241C26', '#6FB98A', 0.10)
    surfacePositive: { css: '240 4% 18%', hex: '#2C2C30' },
    // unverified — dark mode is undesigned
    surfaceCritical: { css: '4 13% 20%', hex: '#3B2E2D' },
    // unverified — dark mode is undesigned
    pillSuccess: { css: '240 4% 18%', hex: '#2C2C30' },
    // unverified — dark mode is undesigned
    pillWarning: { css: '4 13% 20%', hex: '#3B2E2D' },
    // unverified — dark mode is undesigned
    pillDestructive: { css: '5 31% 14%', hex: '#2E1A18' },
    // unverified — dark mode is undesigned
    pillShortNotice: { css: '5 31% 14%', hex: '#2E1A18' },
    // unverified — dark mode is undesigned
    chipPlum: { css: '286 15% 17%', hex: '#2E2431' },
    // unverified — dark mode is undesigned
    chipCat1: { css: '278 20% 16%', hex: '#2A2030' },
    // unverified — dark mode is undesigned
    chipCat2: { css: '278 20% 16%', hex: '#2A2030' },
    // unverified — dark mode is undesigned
    chipCat3: { css: '278 20% 16%', hex: '#2A2030' },
    shortNotice: { css: '25 74% 65%', hex: '#E89A63' },
    // unverified — dark mode is undesigned
    shortNoticeInk: { css: '23 77% 74%', hex: '#F0B189' },
    shortNoticeStrong: { css: '23 77% 74%', hex: '#F0B189' },

    border: { css: '279 18% 19%', hex: '#332839' },
    borderStrong: { css: '282 15% 26%', hex: '#46384C' },
    input: { css: '278 20% 16%', hex: '#2A2030' },
    ring: { css: '297 28% 72%', hex: '#C9A2CB' },
    neutral: { css: '285 7% 53%', hex: '#8C8090' },

    skeletonBase: { css: '278 20% 16%', hex: '#2A2030' },
    skeletonHighlight: { css: '279 18% 19%', hex: '#332839' },

    errorInlineBg: { css: '5 31% 14%', hex: '#2E1A18' },
    errorInlineBorder: { css: '9 32% 28%', hex: '#5E3730' },
    errorInlineText: { css: '6 69% 76%', hex: '#EC9F96' },

    gray50: { css: '288 15% 13%', hex: '#241C26' },
    gray100: { css: '278 20% 16%', hex: '#2A2030' },
    gray200: { css: '279 18% 19%', hex: '#332839' },
    gray300: { css: '282 15% 26%', hex: '#46384C' },
    gray400: { css: '300 6% 49%', hex: '#857785' },
    gray500: { css: '296 7% 58%', hex: '#9A8C9B' },
    gray600: { css: '296 9% 67%', hex: '#B2A4B3' },
    gray700: { css: '300 10% 76%', hex: '#C9BDC9' },
    gray800: { css: '306 14% 86%', hex: '#E0D6DF' },
    gray900: { css: '309 20% 93%', hex: '#F1EAF0' },

    scrim: { css: '291 14% 10%', hex: '#1B151C' },
  } satisfies PaletteMode,
} as const;

/** Old brand child swatches → Daylight category accents. Unmapped values pass through. */
export const DAYLIGHT_SWATCH_MAP: Readonly<Record<string, string>> = {
  '#6366F1': '#6A4C77',
  '#14B8A6': '#4C7A6A',
  '#EC4899': '#A85E6E',
  // lowercase variants (API may normalise either way)
  '#6366f1': '#6A4C77',
  '#14b8a6': '#4C7A6A',
  '#ec4899': '#A85E6E',
};

export function remapChildSwatch(colour: string): string {
  return (
    DAYLIGHT_SWATCH_MAP[colour] ??
    DAYLIGHT_SWATCH_MAP[colour.toLowerCase()] ??
    colour
  );
}
