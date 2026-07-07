import * as SwitchPrimitives from '@rn-primitives/switch';
import type * as React from 'react';
import { Platform } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { useColorScheme } from '@/lib/useColorScheme';
import { cn } from '@/lib/utils';

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
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-md shadow-foreground/5 ring-0 transition-transform',
          props.checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </SwitchPrimitives.Root>
  );
}

// Convert hex colors to RGB for animation interpolation
// Light mode: primary = #3B6FF5 (59, 111, 245), input = #F4F5F7 (244, 245, 247)
// Dark mode: primary = #6B92F7 (107, 146, 247), input = #1E2128 (30, 33, 40)
const RGB_COLORS = {
  light: {
    primary: 'rgb(59, 111, 245)', // colors.primary.DEFAULT #3B6FF5
    input: 'rgb(244, 245, 247)', // colors.input #F4F5F7
  },
  dark: {
    primary: 'rgb(107, 146, 247)', // colors.primary.light #6B92F7
    input: 'rgb(55, 55, 60)', // dark mode input background — deliberately lighter than --input token for toggle track visibility
  },
} as const;

function SwitchNative({
  className,
  ...props
}: SwitchPrimitives.RootProps & {
  ref?: React.RefObject<SwitchPrimitives.RootRef>;
}) {
  const { colorScheme } = useColorScheme();
  const translateX = useDerivedValue(() => (props.checked ? 18 : 0));
  const animatedRootStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: interpolateColor(
        translateX.value,
        [0, 18],
        [RGB_COLORS[colorScheme].input, RGB_COLORS[colorScheme].primary]
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
          height: 32,
          width: 46,
          borderRadius: 999,
          opacity: props.disabled ? 0.6 : 1,
        },
        animatedRootStyle,
      ]}
    >
      <SwitchPrimitives.Root
        className={cn(
          'flex-row h-8 w-[46px] shrink-0 items-center rounded-full border-2 border-transparent',
          props.checked ? 'bg-primary' : 'bg-input',
          className
        )}
        {...props}
      >
        <Animated.View style={animatedThumbStyle}>
          <SwitchPrimitives.Thumb
            className={
              'h-7 w-7 rounded-full bg-background shadow-md shadow-foreground/25 ring-0'
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
