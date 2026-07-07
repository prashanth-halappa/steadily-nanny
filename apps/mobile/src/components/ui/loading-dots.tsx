/**
 * LoadingDots Component
 *
 * Three accent-colored dots with a staggered scale-pulse animation. Uses the
 * three generic category accent hues. Respects reduced motion accessibility
 * settings.
 *
 * NOTE: the dots are Reanimated Animated.Views — their color/size is applied via
 * INLINE style, never a NativeWind className (className on an Animated.View is
 * unreliable and won't be clipped by an `overflow-hidden` parent).
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';

interface LoadingDotsProps {
  /** Diameter of each dot in pixels (default: 6) */
  dotSize?: number;
  /** Duration of one full pulse cycle in ms (default: 900) */
  duration?: number;
  /** Stagger delay between dots in ms (default: 200) */
  stagger?: number;
  /** Test ID for the container view */
  testID?: string;
}

function Dot({
  color,
  size,
  delay,
  duration,
  animate,
}: {
  color: string;
  size: number;
  delay: number;
  duration: number;
  animate: boolean;
}) {
  const scale = useSharedValue(1.0);

  useEffect(() => {
    if (animate) {
      scale.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1.4, { duration: duration / 2 }),
            withTiming(1.0, { duration: duration / 2 })
          ),
          -1
        )
      );
    } else {
      scale.value = 1.0;
    }
  }, [animate, delay, duration, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          marginHorizontal: size * 0.5,
        },
        animatedStyle,
      ]}
    />
  );
}

export function LoadingDots({
  dotSize = 6,
  duration = 900,
  stagger = 200,
  testID = 'loading-dots',
}: LoadingDotsProps) {
  const reducedMotion = useReducedMotion();
  const themeColors = useThemeColors();
  const shouldAnimate = !reducedMotion;

  const dotColors = [
    themeColors.category.accent1,
    themeColors.category.accent2,
    themeColors.category.accent3,
  ];

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {dotColors.map((color, index) => (
        <Dot
          // biome-ignore lint/suspicious/noArrayIndexKey: stable order, no reordering
          key={index}
          color={color}
          size={dotSize}
          delay={index * stagger}
          duration={duration}
          animate={shouldAnimate}
        />
      ))}
    </View>
  );
}
