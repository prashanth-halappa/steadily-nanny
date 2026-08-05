/**
 * @module components/custom/AnimatedSplash
 *
 * Splash overlay — absolutely positioned above the app so cold-start work runs
 * underneath it (an overlay, not a blocker). Held until auth + onboarding are
 * decidable so a signed-in user never sees a role-fork flash under a 400ms
 * timer; capped at SAFETY_TIMEOUT_MS so a hung API cannot trap the splash.
 *
 * Must render inside QueryClientProvider (uses useIsOnboarded).
 *
 * NOTE: styled with an inline `style`, never a NativeWind `className` — this is a
 * Reanimated Animated.View (className would overflow its parent).
 */
import { useEffect } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useAuthStore } from '@/src/store/auth';

const splashLogo = require('@/assets/splash.png');

// Module-level flag survives expo-router remounts so the splash doesn't replay.
let hasCompletedSplash = false;

/** Hard cap — never block the UI forever if memberships hang. */
const SAFETY_TIMEOUT_MS = 4000;

export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const { background } = useThemeColors();
  const isInitialized = useAuthStore(s => s.isInitialized);
  const session = useAuthStore(s => s.session);
  const onboarding = useIsOnboarded();

  // Signed out: ready once auth has initialized.
  // Signed in: ready once onboarding is no longer 'loading', or memberships
  // errored (Index shows the retryable ErrorState — splash must get out of
  // the way). membershipsError keeps status 'loading', so check it explicitly.
  const routingDecidable =
    isInitialized &&
    (!session ||
      onboarding.status !== 'loading' ||
      onboarding.membershipsError);

  useEffect(() => {
    if (hasCompletedSplash) {
      onFinish();
      return;
    }
    if (!routingDecidable) return;
    hasCompletedSplash = true;
    onFinish();
  }, [routingDecidable, onFinish]);

  useEffect(() => {
    if (hasCompletedSplash) return;
    const timeout = setTimeout(() => {
      if (hasCompletedSplash) return;
      hasCompletedSplash = true;
      onFinish();
    }, SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [onFinish]);

  if (hasCompletedSplash) return null;

  return (
    <Animated.View
      testID="animated-splash"
      exiting={FadeOut.duration(200)}
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Image
        source={splashLogo}
        accessibilityElementsHidden
        style={{ width: 200, height: 200 }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

/** Test-only — reset the module latch between cases. */
export function __resetAnimatedSplashForTests() {
  hasCompletedSplash = false;
}
