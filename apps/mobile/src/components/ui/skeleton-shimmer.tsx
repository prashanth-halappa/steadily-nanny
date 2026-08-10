/**
 * SkeletonShimmer - Reusable shimmer primitive for skeleton loading states
 *
 * Replaces cold gray pulse animations with a warm, branded shimmer effect.
 * Uses Reanimated opacity animation cycling between 0.4 and 1.0 on the
 * skeleton base color (secondary). Respects reduced motion accessibility settings.
 *
 * Optional dimensionColor prop adds a subtle 2dp top border accent at 20% opacity
 * for category-aware skeleton placeholders.
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

interface SkeletonShimmerProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  dimensionColor?: string;
  testID?: string;
}

export function SkeletonShimmer({
  width,
  height,
  borderRadius = 4,
  dimensionColor,
  testID = 'skeleton-shimmer',
}: SkeletonShimmerProps) {
  const reducedMotion = useReducedMotion();
  const themeColors = useThemeColors();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }

    const shimmerEasing = Easing.inOut(Easing.ease);
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 600, easing: shimmerEasing }),
        withTiming(1.0, { duration: 600, easing: shimmerEasing })
      ),
      -1 // infinite repeats
    );
  }, [reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
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
          backgroundColor: themeColors.skeleton.base,
          ...(dimensionColor
            ? {
                borderTopWidth: 2,
                borderTopColor: `${dimensionColor}33`, // 20% opacity
              }
            : {}),
        },
      ]}
    />
  );
}
