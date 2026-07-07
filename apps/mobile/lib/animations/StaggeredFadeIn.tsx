/**
 * StaggeredFadeIn Animation Wrapper
 *
 * Wraps children in an Animated.View with a staggered fade-in-up entering
 * animation. Falls back to a plain View when the user has reduced motion enabled.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { useReducedMotion } from './useReducedMotion';

interface StaggeredFadeInProps {
  index: number;
  staggerDelay?: number;
  duration?: number;
  children: ReactNode;
  className?: string;
  testID?: string;
}

export function StaggeredFadeIn({
  index,
  staggerDelay = 60,
  duration = 250,
  children,
  className,
  testID,
}: StaggeredFadeInProps) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return (
      <View className={className} testID={testID}>
        {children}
      </View>
    );
  }

  // GUARDRAIL: className must NOT go on the Animated.View (it overflows its
  // parent and overflow-hidden won't clip it). Keep only entering/style on the
  // Animated.View and carry layout className on a plain inner View.
  return (
    <Animated.View
      entering={FadeInUp.delay(index * staggerDelay).duration(duration)}
      testID={testID}
    >
      <View className={className}>{children}</View>
    </Animated.View>
  );
}
