/**
 * Apricot live/on-the-clock indicator dot.
 * `highlight` is reserved for this state — colour is not configurable.
 */

import { useEffect } from 'react';
import type { ViewProps } from 'react-native';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';

type LiveDotProps = Pick<ViewProps, 'testID'>;

function LiveDot({ testID }: LiveDotProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }

    scale.value = withRepeat(
      withSequence(
        withTiming(1.18, { duration: 700 }),
        withTiming(1, { duration: 700 })
      ),
      -1
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.72, { duration: 700 }),
        withTiming(1, { duration: 700 })
      ),
      -1
    );
  }, [opacity, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <View
        testID={testID}
        accessible={false}
        className="h-2.5 w-2.5 rounded-full bg-highlight"
      />
    </Animated.View>
  );
}

export type { LiveDotProps };
export { LiveDot };
