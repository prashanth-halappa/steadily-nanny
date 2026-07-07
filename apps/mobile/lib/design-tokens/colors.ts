/**
 * Color Design Tokens
 * Simplified, professional color system.
 *
 * Usage Rules:
 * - Primary color: Only for main CTAs (1-2 per screen max)
 * - Neutrals: For 90% of UI
 * - Accent colors (accent1/2/3): Use at ~10% opacity for subtle category
 *   differentiation. These are generic, meaning-free hues — remap them to your
 *   product's taxonomy as needed.
 *
 * These static tokens are LIGHT-MODE values. For theme-aware inline styling
 * (Animated.View, LinearGradient, SVG) prefer `useThemeColors()`.
 */

export const colors = {
  // Primary brand color — use sparingly for CTAs only.
  // Matches global.css: --primary: 230 80% 60% = #3B6FF5 (neutral blue)
  primary: {
    DEFAULT: '#3B6FF5', // Blue — main actions
    light: '#6B92F7', // Lighter blue for hover/pressed states
    dark: '#2B5AD4', // Darker blue
    foreground: '#FFFFFF', // White text on primary
  },

  // Neutrals — use for 90% of UI
  /**
   * @deprecated Light-mode only. Use `useThemeColors()` / `useDesignColors()` or `bg-background`.
   */
  background: {
    DEFAULT: '#FFFFFF', // Pure white
    secondary: '#F4F5F7', // Cool gray secondary backgrounds
  },
  /**
   * @deprecated Light-mode only. Use `useThemeColors().foreground` or `text-foreground`.
   */
  foreground: {
    DEFAULT: '#17181A', // Near-black
    secondary: '#777E8B', // Medium gray
    tertiary: '#9CA3AF', // Tertiary text
  },
  /**
   * @deprecated Light-mode only. Use `useThemeColors().muted` / `.mutedForeground` or semantic Tailwind.
   */
  muted: {
    DEFAULT: '#F4F5F7', // Cool gray
    foreground: '#777E8B', // Medium gray
  },
  // Matches global.css: --border: 220 13% 91% = #E3E5E8
  border: {
    DEFAULT: '#E3E5E8', // Cool border
    strong: '#C4C8CE', // More prominent borders
  },

  // Semantic colors — use only when needed
  // Matches global.css: --success-state: 152 60% 42% = #2DA86B
  success: {
    DEFAULT: '#2DA86B', // Green
    light: '#A1D4B2', // Light background
    foreground: '#FFFFFF', // Text on success
  },
  warning: {
    DEFAULT: '#F59E0B', // Amber (--warning: 38 92% 50%)
    light: '#FDE68A', // Light background
    foreground: '#17181A', // Near-black text
  },
  error: {
    DEFAULT: '#DC2626', // Red (--destructive: 0 72% 51%)
    light: '#FCA5A5', // Light background
    foreground: '#FFFFFF', // Text on error
  },
  // Matches global.css: --destructive: 0 72% 51% = #DC2626
  destructive: {
    DEFAULT: '#DC2626', // Red
    foreground: '#FFFFFF', // White text
  },

  // Category accent colors — three distinct, generic hues with no built-in
  // meaning. Matches global.css: --category-accent1/2/3.
  category: {
    accent1: '#6366F1', // Indigo
    accent2: '#14B8A6', // Teal
    accent3: '#EC4899', // Pink
  },

  // Accent — Matches global.css: --accent: 16 80% 58% = #EF7B45
  accent: {
    DEFAULT: '#EF7B45', // Warm orange
    foreground: '#FFFFFF', // White text
  },
  // Matches global.css: --secondary: 220 10% 94% = #EDEEF0
  secondary: {
    DEFAULT: '#EDEEF0', // Light gray
    foreground: '#17181A', // Near-black
  },

  // Card colors — Matches global.css: --card: 0 0% 100% = #FFFFFF
  card: {
    DEFAULT: '#FFFFFF', // White
    foreground: '#17181A', // Near-black
  },

  // Skeleton shimmer tokens (neutral gray) — matches global.css --skeleton-*
  skeleton: {
    base: '#F0F1F3',
    highlight: '#F9FAFB',
  },

  // Inline error tokens (warm amber) — matches global.css --error-inline-*
  errorInline: {
    bg: '#FFF7ED',
    border: '#FDBA74',
    text: '#9A3412',
  },

  // Additional UI elements
  // Matches global.css: --input: 220 14% 96% = #F4F5F7
  input: '#F4F5F7',
  // Matches global.css: --ring: 230 80% 60% = #3B6FF5
  ring: '#3B6FF5',
  // Matches global.css: --neutral: 0 0% 66% = #A8A8A8
  neutral: '#A8A8A8',
} as const;

/**
 * Opacity variants for backgrounds.
 * Use these for subtle color differentiation.
 */
export const opacity = {
  5: '0D', // 5% opacity hex suffix
  10: '1A', // 10%
  15: '26', // 15%
  20: '33', // 20%
  30: '4D', // 30%
  40: '66', // 40%
  50: '80', // 50%
  60: '99', // 60%
  70: 'B3', // 70%
  80: 'CC', // 80%
  90: 'E6', // 90%
} as const;

/**
 * Helper to create a color with opacity.
 * Example: getColorWithOpacity(colors.primary.DEFAULT, 10) => '#3B6FF51A'
 */
export const getColorWithOpacity = (
  color: string,
  opacityPercent: keyof typeof opacity
): string => {
  return `${color}${opacity[opacityPercent]}`;
};

/**
 * Category accent color helper — keyed 1/2/3 (no built-in meaning).
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
  // Backgrounds
  bgPrimary: 'bg-primary',
  bgSecondary: 'bg-secondary',
  bgMuted: 'bg-muted',
  bgSuccess: 'bg-success',
  bgWarning: 'bg-warning',
  bgError: 'bg-destructive',

  // Text
  textPrimary: 'text-foreground',
  textSecondary: 'text-muted-foreground',
  textMuted: 'text-muted-foreground',
  textSuccess: 'text-success',
  textWarning: 'text-warning',
  textError: 'text-destructive',

  // Borders
  borderDefault: 'border-border',
  borderStrong: 'border-border',

  // Category accent backgrounds (10% opacity)
  bgCategoryAccent1: 'bg-category-accent1/10',
  bgCategoryAccent2: 'bg-category-accent2/10',
  bgCategoryAccent3: 'bg-category-accent3/10',
} as const;

export type ColorToken = typeof colors;
export type ColorClass = keyof typeof colorClasses;
