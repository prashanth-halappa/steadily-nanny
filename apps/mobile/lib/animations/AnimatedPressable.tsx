/**
 * AnimatedPressable
 *
 * A Pressable component with built-in press animation and haptic feedback.
 * Respects reduced motion preferences.
 *
 * Usage:
 * <AnimatedPressable onPress={handlePress} haptic="light">
 *   <View>...</View>
 * </AnimatedPressable>
 */

import type { ComponentProps } from 'react';
import { type GestureResponderEvent, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { PRESS_SCALE } from './constants';
import { easingSignature } from './easing';
import { HAPTIC_PATTERNS } from './haptics';
import { useReducedMotion } from './useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface AnimatedPressableProps extends ComponentProps<typeof Pressable> {
  /** Haptic feedback intensity */
  haptic?: 'light' | 'medium' | 'heavy' | 'none';
  /** Scale intensity */
  scaleIntensity?: 'subtle' | 'standard' | 'prominent';
  /** Enable/disable animation */
  animated?: boolean;
}

export function AnimatedPressableComponent({
  children,
  onPress,
  onPressIn,
  onPressOut,
  haptic = 'light',
  scaleIntensity = 'subtle',
  animated = true,
  ...props
}: AnimatedPressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  // Determine scale value
  const scaleValue = {
    subtle: PRESS_SCALE.subtle,
    standard: PRESS_SCALE.standard,
    prominent: PRESS_SCALE.prominent,
  }[scaleIntensity];

  // Determine if animations should be active
  const shouldAnimate = animated && !reducedMotion;

  // Scale-only press affordance — no shadowOpacity/elevation (Ledger).
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (event: GestureResponderEvent) => {
    if (shouldAnimate) {
      // Press down with Growth Bloom easing
      scale.value = withTiming(scaleValue, {
        duration: 200,
        easing: easingSignature.growthBloom.easing,
      });
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    if (shouldAnimate) {
      // Gentle overshoot: 1.0 → 1.02 → 1.0 with Growth Bloom
      scale.value = withSequence(
        withTiming(1, {
          duration: 200,
          easing: easingSignature.growthBloom.easing,
        }),
        withTiming(1.02, {
          duration: 100,
          easing: easingSignature.growthBloom.easing,
        }),
        withTiming(1, {
          duration: 150,
          easing: easingSignature.growthBloom.easing,
        })
      );
    }
    onPressOut?.(event);
  };

  const handlePress = (event: GestureResponderEvent) => {
    // Trigger contextual haptic feedback
    if (haptic !== 'none') {
      switch (haptic) {
        case 'light':
          HAPTIC_PATTERNS.explore();
          break;
        case 'medium':
          HAPTIC_PATTERNS.achievement();
          break;
        case 'heavy':
          HAPTIC_PATTERNS.milestone();
          break;
      }
    }
    onPress?.(event);
  };

  return (
    <AnimatedPressable
      style={shouldAnimate ? animatedStyle : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}

export { AnimatedPressableComponent as AnimatedPressable };
