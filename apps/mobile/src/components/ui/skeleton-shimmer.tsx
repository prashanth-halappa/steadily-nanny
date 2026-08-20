/**
 * SkeletonShimmer - Reusable shimmer primitive for skeleton loading states
 *
 * Replaces cold gray pulse animations with a warm, branded shimmer effect.
 * `00-FOUNDATIONS.md` §8.8: the shimmer CROSSFADES `skeletonBase` →
 * `skeletonHighlight` over a 1200ms period with `easing.inOut` — it does not
 * dim the base colour with opacity, which is the cold grey pulse this system
 * replaced. Both tokens come from `useThemeColors()` so the pair stays
 * theme-resolved rather than hardcoding a literal that would be wrong in one
 * of them.
 *
 * Respects reduced motion: it settles on the base colour rather than freezing
 * mid-crossfade.
 *
 * NO ACCENT BAR. An earlier version took a `dimensionColor` prop and drew a 2dp
 * top border with it. That is the accent bar `01-LAWS.md` §6 removed — Rule D's
 * inset hairline inside a group card is the single exception, and a skeleton is
 * not that. The prop had no production caller, so it was deleted rather than
 * restyled.
 */

import { useEffect } from 'react';
import type { DimensionValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';

/** `00-FOUNDATIONS.md` §8.8 — one full base→highlight→base cycle. */
const SHIMMER_PERIOD_MS = 1200;

interface SkeletonShimmerProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  testID?: string;
}

export function SkeletonShimmer({
  width,
  height,
  borderRadius = 4,
  testID = 'skeleton-shimmer',
}: SkeletonShimmerProps) {
  const reducedMotion = useReducedMotion();
  const themeColors = useThemeColors();
  const base = themeColors.skeleton.base;
  const highlight = themeColors.skeleton.highlight;
  const tint = useSharedValue(base);

  useEffect(() => {
    if (reducedMotion) {
      tint.value = base;
      return;
    }

    const shimmerEasing = Easing.inOut(Easing.ease);
    const halfPeriod = SHIMMER_PERIOD_MS / 2;
    tint.value = withRepeat(
      withSequence(
        withTiming(highlight, { duration: halfPeriod, easing: shimmerEasing }),
        withTiming(base, { duration: halfPeriod, easing: shimmerEasing })
      ),
      -1 // infinite repeats
    );
  }, [reducedMotion, tint, base, highlight]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: tint.value,
  }));

  const resolvedWidth: DimensionValue =
    typeof width === 'number' ? width : (width as DimensionValue);

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="none"
      style={[
        animatedStyle,
        {
          width: resolvedWidth,
          height,
          borderRadius,
        },
      ]}
    />
  );
}
