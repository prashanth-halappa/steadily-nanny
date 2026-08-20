/**
 * LoadingButton Component
 *
 * A button with in-place loading dots and success checkmark transitions.
 * When isLoading, the label fades out and three small dots pulse.
 * When isSuccess, dots fade to a Check icon, then the label returns.
 * Respects reduced motion accessibility preferences.
 *
 * NOTE: the label/dots/check overlays are Reanimated Animated.Views styled via
 * INLINE style — never a NativeWind className (see loading-indicator.tsx for the
 * canonical explanation).
 */

import { Check } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
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
import { spacing } from '@/lib/design-tokens/spacing';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
// Import from the typography sub-file (not the barrel) so tests that mock the
// typography barrel still render the real button-styled label.
import { Button as ButtonText } from '@/src/components/ui/typography/utility';
import { Button, type ButtonProps } from './button';

const DOT_SIZE = 4;
const DOT_PULSE_DURATION = 600;
const DOT_STAGGER = 150;
const FADE_DURATION = 200;
const CHECK_SPRING_DURATION = 300;
const CHECK_HOLD_DURATION = 400;

interface LoadingButtonProps extends Omit<ButtonProps, 'children'> {
  /** Button label text */
  label: string;
  /** Show loading dots animation */
  isLoading?: boolean;
  /** Show success checkmark animation */
  isSuccess?: boolean;
  /** Button variant passed to underlying Button */
  variant?: ButtonProps['variant'];
  /** Test identifier */
  testID?: string;
}

/** Single animated dot for the loading state */
function LoadingDot({ delay, animate }: { delay: number; animate: boolean }) {
  const themeColors = useThemeColors();
  const scale = useSharedValue(1.0);

  useEffect(() => {
    if (animate) {
      scale.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1.6, { duration: DOT_PULSE_DURATION / 2 }),
            withTiming(1.0, { duration: DOT_PULSE_DURATION / 2 })
          ),
          -1
        )
      );
    } else {
      scale.value = 1.0;
    }
  }, [animate, delay, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: themeColors.primaryForeground,
          marginHorizontal: spacing.xs,
        },
        animatedStyle,
      ]}
    />
  );
}

export function LoadingButton({
  label,
  isLoading = false,
  isSuccess = false,
  variant = 'default',
  testID = 'loading-button',
  ...buttonProps
}: LoadingButtonProps) {
  const themeColors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const shouldAnimate = !reducedMotion;

  // Opacity for label text
  const labelOpacity = useSharedValue(1);
  // Opacity for loading dots
  const dotsOpacity = useSharedValue(0);
  // Opacity for success check icon
  const checkOpacity = useSharedValue(0);
  // Scale for success check icon
  const checkScale = useSharedValue(0);

  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      // Fade out label, fade in dots
      labelOpacity.value = withTiming(0, {
        duration: shouldAnimate ? FADE_DURATION : 0,
      });
      dotsOpacity.value = withTiming(1, {
        duration: shouldAnimate ? FADE_DURATION : 0,
      });
      checkOpacity.value = 0;
      checkScale.value = 0;
    } else if (isSuccess) {
      // Fade out dots, spring in check
      dotsOpacity.value = withTiming(0, {
        duration: shouldAnimate ? FADE_DURATION : 0,
      });
      checkOpacity.value = withTiming(1, {
        duration: shouldAnimate ? CHECK_SPRING_DURATION : 0,
      });
      checkScale.value = withTiming(1, {
        duration: shouldAnimate ? CHECK_SPRING_DURATION : 0,
      });
      labelOpacity.value = 0;

      // After hold duration, return to label
      successTimeoutRef.current = setTimeout(
        () => {
          checkOpacity.value = withTiming(0, {
            duration: shouldAnimate ? FADE_DURATION : 0,
          });
          checkScale.value = withTiming(0, {
            duration: shouldAnimate ? FADE_DURATION : 0,
          });
          labelOpacity.value = withTiming(1, {
            duration: shouldAnimate ? FADE_DURATION : 0,
          });
        },
        shouldAnimate ? CHECK_HOLD_DURATION : 0
      );
    } else {
      // Reset to default label state
      labelOpacity.value = withTiming(1, {
        duration: shouldAnimate ? FADE_DURATION : 0,
      });
      dotsOpacity.value = withTiming(0, {
        duration: shouldAnimate ? FADE_DURATION : 0,
      });
      checkOpacity.value = 0;
      checkScale.value = 0;
    }

    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, [
    isLoading,
    isSuccess,
    shouldAnimate,
    labelOpacity,
    dotsOpacity,
    checkOpacity,
    checkScale,
  ]);

  const labelAnimatedStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
  }));

  const dotsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: dotsOpacity.value,
  }));

  const checkAnimatedStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));

  return (
    <Button
      testID={testID}
      variant={variant}
      disabled={isLoading || buttonProps.disabled}
      {...buttonProps}
    >
      <View
        style={{
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 20,
        }}
      >
        {/* Label text */}
        <Animated.View style={labelAnimatedStyle} testID={`${testID}-label`}>
          <ButtonText>{label}</ButtonText>
        </Animated.View>

        {/* Loading dots (absolutely positioned over the label area) */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            },
            dotsAnimatedStyle,
          ]}
          testID={`${testID}-dots`}
        >
          {[0, 1, 2].map(index => (
            <LoadingDot
              key={index}
              delay={index * DOT_STAGGER}
              animate={shouldAnimate && isLoading}
            />
          ))}
        </Animated.View>

        {/* Success check icon (absolutely positioned) */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              alignItems: 'center',
              justifyContent: 'center',
            },
            checkAnimatedStyle,
          ]}
          testID={`${testID}-check`}
        >
          <Check size={18} color={themeColors.primaryForeground} />
        </Animated.View>
      </View>
    </Button>
  );
}

export type { LoadingButtonProps };
