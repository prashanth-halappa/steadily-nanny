import * as SwitchPrimitives from '@rn-primitives/switch';
import type * as React from 'react';
import { Platform } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { cn } from '@/lib/utils';
import { CHIP_BORDER_RADIUS } from '@/src/components/ui/badge';

function SwitchWeb({
  className,
  ...props
}: SwitchPrimitives.RootProps & {
  ref?: React.RefObject<SwitchPrimitives.RootRef>;
}) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        'peer flex-row h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed',
        props.checked ? 'bg-primary' : 'bg-input',
        props.disabled && 'opacity-60',
        className
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background border border-border ring-0 transition-transform',
          props.checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </SwitchPrimitives.Root>
  );
}

function SwitchNative({
  className,
  ...props
}: SwitchPrimitives.RootProps & {
  ref?: React.RefObject<SwitchPrimitives.RootRef>;
}) {
  const themeColors = useThemeColors();
  const trackOff = themeColors.input;
  const trackOn = themeColors.primary;
  const translateX = useDerivedValue(() => (props.checked ? 20 : 0));
  const animatedRootStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: interpolateColor(
        translateX.value,
        [0, 20],
        [trackOff, trackOn]
      ),
    };
  });
  const animatedThumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: withTiming(translateX.value, { duration: 200 }) },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          height: 44,
          width: 56,
          borderRadius: CHIP_BORDER_RADIUS,
          opacity: props.disabled ? 0.6 : 1,
        },
        animatedRootStyle,
      ]}
    >
      <SwitchPrimitives.Root
        className={cn(
          'flex-row h-11 w-14 shrink-0 items-center rounded-full border-2 border-transparent',
          props.checked ? 'bg-primary' : 'bg-input',
          className
        )}
        {...props}
      >
        <Animated.View style={animatedThumbStyle}>
          <SwitchPrimitives.Thumb
            className={
              'h-7 w-7 rounded-full border border-border bg-background ring-0'
            }
          />
        </Animated.View>
      </SwitchPrimitives.Root>
    </Animated.View>
  );
}

const Switch = Platform.select({
  web: SwitchWeb,
  default: SwitchNative,
});

export { Switch };
