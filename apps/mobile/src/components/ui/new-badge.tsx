import React from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { cn } from '@/lib/utils';
import { Small } from '@/src/components/ui/typography';

interface NewBadgeProps {
  size?: 'sm' | 'md';
  /** Badge label (default: "New") */
  label?: string;
}

export function NewBadge({ size = 'sm', label = 'New' }: NewBadgeProps) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    if (!reducedMotion) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 500 }),
          withTiming(1, { duration: 500 })
        ),
        3, // Pulse 3 times then stop
        false
      );
    }
  }, [reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const sizeClasses =
    size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs';

  return (
    <Animated.View style={animatedStyle}>
      <View className={cn('bg-primary rounded-full', sizeClasses)}>
        <Small className="text-primary-foreground">{label}</Small>
      </View>
    </Animated.View>
  );
}
