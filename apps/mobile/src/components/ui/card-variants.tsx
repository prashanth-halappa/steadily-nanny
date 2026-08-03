/**
 * Card Variants (Daylight)
 *
 * Standardized card styles with elevation from `useElevation()` (RN
 * multi-layer `boxShadow` — not Tailwind `shadow-*`), borders, and padding.
 *
 * Variants:
 * - elevated: Standard card with border + plum-tinted card shadow (default)
 * - hero: Featured card, no border, apricot liveCard shadow
 * - outlined: Card with border, no shadow
 * - filled: Muted background card, no shadow
 *
 * When `tintColor` is set, elevation is suppressed — translucent backgrounds
 * under shadows read wrong on device (GOLDEN-FIXES #19).
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
import { useElevation } from '~/lib/design-tokens/elevation';

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

// `elevated` and `hero` separate with shadow alone, matching <Card> — only
// `outlined` keeps a border, which is the entire point of that variant.
const variantStyles: Record<CardVariant, string> = {
  elevated: 'bg-card',
  hero: 'bg-card',
  outlined: 'bg-card border border-border',
  filled: 'bg-muted',
};

/**
 * CardVariant Component
 *
 * A versatile card component with consistent styling across variants.
 * Uses rounded-card for all variants per Daylight.
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
  const elevation = useElevation();

  const accentStyle: ViewStyle =
    accentWidth > 0 && accentColor
      ? { borderLeftWidth: accentWidth, borderLeftColor: accentColor }
      : {};

  const tintStyle: ViewStyle = tintColor
    ? { backgroundColor: getColorWithOpacity(tintColor, tintOpacity) }
    : {};

  // GOLDEN-FIXES #19: tintStyle applies a translucent backgroundColor.
  // Shadows over translucent grounds bleed / read wrong on device — suppress
  // elevation whenever tintColor is set (even on elevated/hero variants).
  const elevationStyle: ViewStyle | undefined = tintColor
    ? undefined
    : variant === 'elevated'
      ? elevation.card
      : variant === 'hero'
        ? elevation.liveCard
        : undefined;

  return (
    <View
      className={cn(
        'rounded-card',
        variantStyles[variant],
        pressed && 'opacity-95 scale-[0.99]',
        className
      )}
      style={[
        elevationStyle,
        accentStyle,
        tintStyle,
        style as StyleProp<ViewStyle>,
      ]}
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
