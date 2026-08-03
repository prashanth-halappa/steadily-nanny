import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

// Module-level flag survives expo-router remounts so the splash doesn't replay.
let hasCompletedSplash = false;

/**
 * Splash overlay — absolutely positioned above the app so cold-start work runs
 * underneath it (an overlay, not a blocker). Fades out then calls `onFinish`.
 *
 * NOTE: styled with an inline `style`, never a NativeWind `className` — this is a
 * Reanimated Animated.View (className would overflow its parent).
 */
export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    if (hasCompletedSplash) {
      onFinish();
      return;
    }
    const timer = setTimeout(() => {
      hasCompletedSplash = true;
      onFinish();
    }, 400);
    return () => clearTimeout(timer);
  }, [onFinish]);

  if (hasCompletedSplash) return null;

  return (
    <Animated.View
      testID="animated-splash"
      exiting={FadeOut.duration(200)}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: '#F5F1F2' }]}
    />
  );
}
