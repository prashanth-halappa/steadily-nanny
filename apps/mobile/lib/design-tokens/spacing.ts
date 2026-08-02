/**
 * Spacing Design Tokens
 * 8pt grid system for consistent spacing across the app
 *
 * All values are in pixels and follow 8pt increments
 * Usage: Use these values for padding, margin, and gaps
 */

export const spacing = {
  // Base scale (8pt increments)
  none: 0,
  xs: 4, // 0.5 rem
  sm: 8, // 1 rem
  md: 16, // 2 rem
  lg: 24, // 3 rem
  xl: 32, // 4 rem
  xxl: 48, // 6 rem
  xxxl: 64, // 8 rem

  // Component-specific spacing
  screenPadding: 16, // Default horizontal padding for screens
  screenPaddingVertical: 24, // Default vertical padding for screens
  cardPadding: 16, // Internal card padding
  cardGap: 12, // Gap between cards in a list
  sectionGap: 24, // Gap between major sections
  itemGap: 8, // Gap between list items
  iconGap: 12, // Gap between icon and text

  // Touch targets (iOS Human Interface Guidelines)
  minTouchTarget: 44, // Minimum touch target size (44x44pt)
  minTouchTargetAndroid: 48, // Android minimum (48x48dp)

  // Border radius — Ledger tight scale
  radiusSm: 2,
  radiusMd: 4,
  radiusLg: 6,
  radiusXl: 8,
  radiusXxl: 10,
  radiusFull: 9999,
} as const;

/**
 * Tailwind class mappings for spacing
 * Use these classes for consistent spacing
 */
export const spacingClasses = {
  // Padding
  screenPadding: 'px-4', // 16px horizontal
  screenPaddingVertical: 'py-6', // 24px vertical
  screenPaddingFull: 'px-4 py-6', // Both
  cardPadding: 'p-4', // 16px all sides

  // Gaps
  sectionGap: 'gap-6', // 24px
  cardGap: 'gap-3', // 12px
  itemGap: 'gap-2', // 8px
  iconGap: 'gap-3', // 12px

  // Margins
  sectionMargin: 'mb-6', // 24px bottom
  cardMargin: 'mb-3', // 12px bottom

  // Border radius
  radiusSm: 'rounded-lg', // 8px
  radiusMd: 'rounded-xl', // 12px
  radiusLg: 'rounded-2xl', // 16px
  radiusFull: 'rounded-full', // Full circle
} as const;

/**
 * Helper function to get spacing value
 */
export const getSpacing = (scale: keyof typeof spacing): number => {
  return spacing[scale];
};

/**
 * Helper to create consistent padding objects
 */
export const padding = {
  screen: {
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: spacing.screenPaddingVertical,
  },
  card: {
    padding: spacing.cardPadding,
  },
  section: {
    marginBottom: spacing.sectionGap,
  },
} as const;

export type SpacingScale = keyof typeof spacing;
export type SpacingClass = keyof typeof spacingClasses;
