/**
 * useSheetDragToDismiss
 *
 * Shared pan-down gesture for bottom sheets. Returns a Reanimated translateY
 * style and a Gesture.Pan() handler. Used by BottomSheetBase.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Keyboard } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const DISMISS_THRESHOLD = 80;
const DISMISS_VELOCITY = 500;

interface UseSheetDragToDismissOptions {
  visible: boolean;
  onDismiss: () => void;
  screenHeight: number;
  reduceMotion: boolean;
}

export function useSheetDragToDismiss({
  visible,
  onDismiss,
  screenHeight,
  reduceMotion,
}: UseSheetDragToDismissOptions) {
  const translateY = useSharedValue(0);
  const reduceMotionShared = useSharedValue(reduceMotion);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    reduceMotionShared.value = reduceMotion;
  }, [reduceMotion, reduceMotionShared]);

  useEffect(() => {
    if (visible) {
      translateY.value = 0;
    }
  }, [visible, translateY]);

  const finishDismiss = useCallback(() => {
    onDismissRef.current();
  }, []);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .onStart(() => {
          runOnJS(dismissKeyboard)();
        })
        .onUpdate(event => {
          translateY.value = Math.max(0, event.translationY);
        })
        .onEnd(event => {
          const shouldDismiss =
            translateY.value > DISMISS_THRESHOLD ||
            event.velocityY > DISMISS_VELOCITY;

          if (shouldDismiss) {
            translateY.value = withTiming(
              screenHeight,
              { duration: reduceMotionShared.value ? 100 : 200 },
              finished => {
                if (finished) {
                  runOnJS(finishDismiss)();
                }
              }
            );
            return;
          }

          if (reduceMotionShared.value) {
            translateY.value = withTiming(0, { duration: 100 });
          } else {
            translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
          }
        }),
    [
      dismissKeyboard,
      finishDismiss,
      reduceMotionShared,
      screenHeight,
      translateY,
    ]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return { panGesture, animatedStyle };
}
