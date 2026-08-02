/**
 * Card Layout Components
 *
 * Composable card layouts built on CardVariant primitives.
 * Each layout defines a distinct visual identity for different content types.
 *
 * Types: StatCard, MediaCard, InsightCard, ActionGridCard, ListItemCard, CelebrationCard, CardGrid
 */

import { ChevronRight, Sparkles } from 'lucide-react-native';
import type * as React from 'react';
import {
  Image,
  Pressable,
  Text,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { cn } from '@/lib/utils';
import { getColorWithOpacity } from '~/lib/design-tokens/colors';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';
import { CardVariant, ElevatedCard, FilledCard } from './card-variants';

// ─── StatCard ────────────────────────────────────────────────────────────────
// Giant number + label for at-a-glance data. Optionally accent-tinted.

interface StatCardProps extends ViewProps {
  /** The prominent number or stat string */
  stat: string | number;
  /** Supporting label below the stat */
  label: string;
  /** Optional icon element rendered beside the stat */
  icon?: React.ReactNode;
  /** Accent color (hex) used to tint the card background */
  accentColor?: string;
  /** Compact mode for 2-column grids (smaller typography) */
  compact?: boolean;
}

function StatCard({
  stat,
  label,
  icon,
  accentColor,
  compact = false,
  className,
  style,
  ...props
}: StatCardProps) {
  return (
    <CardVariant
      variant="filled"
      tintColor={accentColor}
      tintOpacity={10}
      className={cn('p-4', compact ? 'p-3' : 'p-4', className)}
      style={style}
      {...props}
    >
      <View className="flex-row items-center gap-2">
        {icon}
        <Text
          className={cn(
            'font-bold text-foreground',
            compact ? 'text-2xl' : 'text-3xl'
          )}
        >
          {stat}
        </Text>
      </View>
      <Text className="text-sm text-muted-foreground mt-1">{label}</Text>
    </CardVariant>
  );
}

// ─── MediaCard ───────────────────────────────────────────────────────────────
// Image-forward card with image top section + content area below.

interface MediaCardProps extends ViewProps {
  /** Image URL for the top section */
  imageUrl?: string | null;
  /** Image height in px (default 180) */
  imageHeight?: number;
  /** Accent color (hex) for the strip + badge at the image bottom */
  accentColor?: string;
  /** Whether the item is completed (dims image + shows overlay) */
  completed?: boolean;
  /** Badge text overlaid on image bottom-left */
  badgeText?: string;
  /** Content rendered below the image */
  children?: React.ReactNode;
}

function MediaCard({
  imageUrl,
  imageHeight = 180,
  accentColor,
  completed = false,
  badgeText,
  children,
  className,
  style,
  ...props
}: MediaCardProps) {
  const themeColors = useThemeColors();
  const stripColor = accentColor;

  return (
    <ElevatedCard
      className={cn('overflow-hidden', className)}
      style={style}
      {...props}
    >
      {/* Image section */}
      <View style={{ height: imageHeight, position: 'relative' }}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <View className="w-full h-full bg-muted" />
        )}

        {/* Completed overlay */}
        {completed && (
          <View className="absolute inset-0 bg-scrim/40 items-center justify-center">
            <Text className="text-2xl">✓</Text>
          </View>
        )}

        {/* Bottom gradient fade */}
        <View
          className="absolute bottom-0 left-0 right-0 h-12"
          style={{
            backgroundColor: 'transparent',
            // Gradient approximation with overlapping views
          }}
        />

        {/* Accent color strip */}
        {stripColor && (
          <View
            className="absolute bottom-0 left-0 right-0"
            style={{ height: 4, backgroundColor: stripColor }}
          />
        )}

        {/* Badge pill */}
        {badgeText && (
          <View
            className="absolute bottom-2 left-3 rounded-chip px-2.5 py-1"
            style={{
              backgroundColor: stripColor
                ? getColorWithOpacity(stripColor, 80)
                : getColorWithOpacity(themeColors.scrim, 60),
            }}
          >
            <Text
              className="text-xs font-medium"
              style={{ color: themeColors.primaryForeground }}
            >
              {badgeText}
            </Text>
          </View>
        )}
      </View>

      {/* Content section */}
      {children && <View className="p-3">{children}</View>}
    </ElevatedCard>
  );
}

// ─── InsightCard ─────────────────────────────────────────────────────────────
// Synthesized/highlighted content with a primary left border + sparkle badge.

interface InsightCardProps extends ViewProps {
  /** Label text next to the sparkle badge */
  label?: string;
  /** Content inside the card */
  children?: React.ReactNode;
}

function InsightCard({
  label,
  children,
  className,
  style,
  ...props
}: InsightCardProps) {
  const themeColors = useThemeColors();
  return (
    <CardVariant
      variant="elevated"
      accentColor={themeColors.primary}
      accentWidth={3}
      tintColor={themeColors.primary}
      tintOpacity={10}
      className={cn('p-4', className)}
      style={style}
      {...props}
    >
      {label && (
        <View className="flex-row items-center gap-1.5 mb-2">
          <Sparkles size={14} color={themeColors.primary} />
          <Text className="text-xs font-semibold text-primary">{label}</Text>
        </View>
      )}
      {children}
    </CardVariant>
  );
}

// ─── ActionGridCard ──────────────────────────────────────────────────────────
// Compact navigation card for 2-column grids. Icon + title + chevron.

interface ActionGridCardProps extends ViewProps {
  /** Icon element (lucide-react-native icon) */
  icon: React.ReactNode;
  /** Background color for the icon circle (hex) */
  iconColor?: string;
  /** Card title */
  title: string;
  /** Optional 1-line description */
  description?: string;
  /** Press handler */
  onPress?: () => void;
}

function ActionGridCard({
  icon,
  iconColor,
  title,
  description,
  onPress,
  className,
  style,
  ...props
}: ActionGridCardProps) {
  const themeColors = useThemeColors();
  return (
    <Pressable onPress={onPress} style={{ width: '47%', flexGrow: 1 }}>
      <FilledCard className={cn('p-3', className)} style={style} {...props}>
        <View className="flex-row items-center gap-3">
          <View
            className="w-10 h-10 rounded-xl items-center justify-center"
            style={{
              backgroundColor: iconColor
                ? getColorWithOpacity(iconColor, 10)
                : themeColors.muted,
            }}
          >
            {icon}
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">
              {title}
            </Text>
            {description && (
              <Text
                className="text-xs text-muted-foreground mt-0.5"
                numberOfLines={1}
              >
                {description}
              </Text>
            )}
          </View>
        </View>
      </FilledCard>
    </Pressable>
  );
}

// ─── ListItemCard ────────────────────────────────────────────────────────────
// Compact row item for vertical lists (64-72px height).

interface ListItemCardProps extends ViewProps {
  /** Left icon or avatar element */
  icon?: React.ReactNode;
  /** Primary text */
  title: string;
  /** Secondary text below title */
  subtitle?: string;
  /** Right-aligned meta text or element */
  meta?: React.ReactNode;
  /** Show right chevron */
  chevron?: boolean;
  /** Left accent dot color (hex) */
  accentDot?: string;
  /** Press handler */
  onPress?: () => void;
}

function ListItemCard({
  icon,
  title,
  subtitle,
  meta,
  chevron = false,
  accentDot,
  onPress,
  className,
  style,
  ...props
}: ListItemCardProps) {
  const content = (
    <View
      className={cn('flex-row items-center py-2.5 px-3 gap-3', className)}
      style={style}
      {...props}
    >
      {/* Accent dot */}
      {accentDot && (
        <View
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: accentDot }}
        />
      )}

      {/* Icon/Avatar */}
      {icon && <View>{icon}</View>}

      {/* Text content */}
      <View className="flex-1">
        <Text
          className="text-sm font-semibold text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            className="text-xs text-muted-foreground mt-0.5"
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>

      {/* Meta / Chevron */}
      {meta && <View>{meta}</View>}
      {chevron && <ChevronRight size={16} className="text-muted-foreground" />}
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return content;
}

// ─── CelebrationCard ─────────────────────────────────────────────────────────
// Milestones, achievements. Warm tint bg + bold stat.

interface CelebrationCardProps extends ViewProps {
  /** Large emoji visual anchor */
  emoji?: string;
  /** Bold stat number/text */
  stat: string | number;
  /** Label below the stat */
  label: string;
  /** Additional content (e.g. progress dots) */
  children?: React.ReactNode;
}

function CelebrationCard({
  emoji,
  stat,
  label,
  children,
  className,
  style,
  ...props
}: CelebrationCardProps) {
  const themeColors = useThemeColors();
  return (
    <CardVariant
      variant="filled"
      className={cn('p-4 overflow-hidden', className)}
      style={[
        {
          backgroundColor: getColorWithOpacity(themeColors.warning, 10),
        },
        style as ViewStyle,
      ]}
      {...props}
    >
      <View className="items-center gap-2">
        {emoji && <Text className="text-4xl">{emoji}</Text>}
        <Text className="text-4xl font-bold text-foreground">{stat}</Text>
        <Text className="text-sm text-muted-foreground">{label}</Text>
      </View>
      {children}
    </CardVariant>
  );
}

// ─── CardGrid ────────────────────────────────────────────────────────────────
// 2-column grid wrapper for ActionGridCards or StatCards.

interface CardGridProps extends ViewProps {
  /** Number of columns (default 2) */
  columns?: number;
  /** Gap between items in px (default 12) */
  gap?: number;
  children?: React.ReactNode;
}

function CardGrid({
  columns = 2,
  gap = 12,
  children,
  className,
  style,
  ...props
}: CardGridProps) {
  return (
    <View
      className={cn('flex-row flex-wrap', className)}
      style={[{ gap }, style as ViewStyle]}
      {...props}
    >
      {children}
    </View>
  );
}

export type {
  ActionGridCardProps,
  CardGridProps,
  CelebrationCardProps,
  InsightCardProps,
  ListItemCardProps,
  MediaCardProps,
  StatCardProps,
};
export {
  ActionGridCard,
  CardGrid,
  CelebrationCard,
  InsightCard,
  ListItemCard,
  MediaCard,
  StatCard,
};
