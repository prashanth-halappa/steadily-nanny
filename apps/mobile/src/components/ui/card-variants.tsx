/**
 * Card Variants
 *
 * Standardized card styles with consistent shadows, borders, and padding.
 * Use these variants across all screens for visual consistency.
 *
 * Variants:
 * - elevated: Standard card with shadow (default)
 * - hero: Featured card with stronger shadow
 * - outlined: Card with border, no shadow
 * - filled: Solid background card
 */

import type * as React from 'react';
import {
  type StyleProp,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { cn } from '@/lib/utils';
import { TextClassContext } from '@/src/components/ui/text';
import { getColorWithOpacity } from '~/lib/design-tokens/colors';

export type CardVariant = 'elevated' | 'hero' | 'outlined' | 'filled';

interface CardVariantProps extends ViewProps {
  ref?: React.RefObject<View>;
  variant?: CardVariant;
  /**
   * Apply pressed state styling
   */
  pressed?: boolean;
  /**
   * Left accent border color (hex). Requires accentWidth > 0 to be visible.
   */
  accentColor?: string;
  /**
   * Left accent border width in px (default 0)
   */
  accentWidth?: number;
  /**
   * Background tint color (hex). Applied as backgroundColor with tintOpacity.
   */
  tintColor?: string;
  /**
   * Tint opacity 5-90 (default 10). Only used when tintColor is set.
   */
  tintOpacity?: 5 | 10 | 15 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90;
}

const variantStyles: Record<CardVariant, string> = {
  elevated: 'bg-card border border-border',
  hero: 'bg-card border border-border',
  outlined: 'bg-card border border-border',
  filled: 'bg-muted border border-border',
};

/**
 * CardVariant Component
 *
 * A versatile card component with consistent styling across variants.
 * Uses rounded-2xl for all variants per design system.
 *
 * @example
 * ```tsx
 * <CardVariant variant="hero">
 *   <CardVariantContent>
 *     <H2>Featured content</H2>
 *   </CardVariantContent>
 * </CardVariant>
 * ```
 */
function CardVariant({
  className,
  variant = 'elevated',
  pressed = false,
  accentColor,
  accentWidth = 0,
  tintColor,
  tintOpacity = 10,
  style,
  ...props
}: CardVariantProps) {
  const accentStyle: ViewStyle =
    accentWidth > 0 && accentColor
      ? { borderLeftWidth: accentWidth, borderLeftColor: accentColor }
      : {};

  const tintStyle: ViewStyle = tintColor
    ? { backgroundColor: getColorWithOpacity(tintColor, tintOpacity) }
    : {};

  return (
    <View
      className={cn(
        'rounded-2xl',
        variantStyles[variant],
        pressed && 'opacity-95 scale-[0.99]',
        className
      )}
      style={[accentStyle, tintStyle, style as StyleProp<ViewStyle>]}
      {...props}
    />
  );
}

/**
 * CardVariantHeader Component
 *
 * Header section for CardVariant with consistent padding.
 */
function CardVariantHeader({
  className,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
}) {
  return (
    <View className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />
  );
}

/**
 * CardVariantContent Component
 *
 * Content section for CardVariant with consistent padding.
 * Provides text color context for nested text components.
 */
function CardVariantContent({
  className,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
}) {
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View className={cn('p-4 pt-0', className)} {...props} />
    </TextClassContext.Provider>
  );
}

/**
 * CardVariantFooter Component
 *
 * Footer section for CardVariant with consistent padding.
 */
function CardVariantFooter({
  className,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
}) {
  return (
    <View
      className={cn('flex flex-row items-center p-4 pt-0', className)}
      {...props}
    />
  );
}

/**
 * HeroCard Component
 *
 * Convenience wrapper for hero variant cards.
 * Use for featured content that needs visual prominence.
 */
function HeroCard({ className, ...props }: Omit<CardVariantProps, 'variant'>) {
  return <CardVariant variant="hero" className={className} {...props} />;
}

/**
 * ElevatedCard Component
 *
 * Convenience wrapper for elevated variant cards.
 * Use for standard interactive cards.
 */
function ElevatedCard({
  className,
  ...props
}: Omit<CardVariantProps, 'variant'>) {
  return <CardVariant variant="elevated" className={className} {...props} />;
}

/**
 * OutlinedCard Component
 *
 * Convenience wrapper for outlined variant cards.
 * Use for secondary content or nested cards.
 */
function OutlinedCard({
  className,
  ...props
}: Omit<CardVariantProps, 'variant'>) {
  return <CardVariant variant="outlined" className={className} {...props} />;
}

/**
 * FilledCard Component
 *
 * Convenience wrapper for filled variant cards.
 * Use for subtle content grouping.
 */
function FilledCard({
  className,
  ...props
}: Omit<CardVariantProps, 'variant'>) {
  return <CardVariant variant="filled" className={className} {...props} />;
}

export type { CardVariantProps };

export {
  CardVariant,
  CardVariantContent,
  CardVariantFooter,
  CardVariantHeader,
  ElevatedCard,
  FilledCard,
  HeroCard,
  OutlinedCard,
};
