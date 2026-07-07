import * as ProgressPrimitive from '@rn-primitives/progress';
import type * as React from 'react';
import { Platform, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { easingSignature } from '@/lib/animations/easing';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { cn } from '@/lib/utils';

function Progress({
  className,
  value,
  indicatorClassName,
  animated = true,
  ...props
}: ProgressPrimitive.RootProps & {
  ref?: React.RefObject<ProgressPrimitive.RootRef>;
  indicatorClassName?: string;
  animated?: boolean;
}) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        'relative h-4 w-full overflow-hidden rounded-full bg-secondary',
        className
      )}
      {...props}
    >
      <Indicator
        value={value}
        className={indicatorClassName}
        animated={animated}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };

function Indicator({
  value,
  className,
  animated = false,
}: {
  value: number | undefined | null;
  className?: string;
  animated?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const themeColors = useThemeColors();
  const progress = useDerivedValue(() => {
    const clampedValue = Math.max(0, Math.min(100, value ?? 0));
    return clampedValue;
  });

  const animatedProgress = useDerivedValue(() => {
    if (animated && !reducedMotion) {
      return withTiming(progress.value, {
        duration: easingSignature.growthBloom.duration,
        easing: easingSignature.growthBloom.easing,
      });
    }
    return progress.value;
  });

  const indicator = useAnimatedStyle(() => {
    const widthPercent = Math.max(0, Math.min(100, animatedProgress.value));
    return {
      width: `${widthPercent}%`,
    };
  });

  if (Platform.OS === 'web') {
    return (
      <View
        className={cn(
          'h-full w-full flex-1 bg-primary web:transition-all',
          className
        )}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      >
        <ProgressPrimitive.Indicator
          className={cn('h-full w-full', className)}
        />
      </View>
    );
  }

  // Don't use asChild with Animated.View - Reanimated components don't support it.
  // NativeWind `className` on an Animated.View overflows its parent (overflow-hidden
  // does NOT clip it), so keep ONLY the animated width on the Animated.View and apply
  // layout/color inline. The dynamic `bg-foreground` theme color comes from
  // useThemeColors() rather than a Tailwind class. Any forwarded caller `className`
  // is applied to an inner static <View> to preserve behavior.
  return (
    <Animated.View
      style={[
        indicator,
        { height: '100%', backgroundColor: themeColors.foreground },
      ]}
    >
      {className ? <View className={cn('h-full w-full', className)} /> : null}
    </Animated.View>
  );
}
