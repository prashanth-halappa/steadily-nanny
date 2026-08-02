/**
 * LoadingIndicator — Living Splash Screen
 *
 * A full-screen loading view that mirrors the app splash (a large logo) but
 * replaces any static tagline with breathing/pulsing animations and rotating
 * loading micro-copy, creating a seamless continuation as the splash fades out.
 *
 * ── GOLDEN-FIX / CANONICAL REFERENCE ─────────────────────────────────────────
 * This component is the canonical example of the Animated.View styling rule:
 *
 *   NEVER put a NativeWind `className` on a Reanimated `Animated.View`.
 *   A parent's `overflow-hidden` will NOT clip it, and the animated style may
 *   not apply reliably. ALWAYS use an inline `style={{ ... }}` (or the animated
 *   style object) instead. Below, the breathing logo layer is an Animated.View
 *   styled entirely via inline `style` — do the same in your own animated views.
 *
 * `useThemeColors()` is the sanctioned way to get theme-aware colors for these
 * inline styles (and for the LinearGradient color array).
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Image, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { contemplativeFade } from '@/lib/animations/easing';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { LoadingDots } from './loading-dots';
import { RotatingMicroCopy } from './rotating-micro-copy';

interface LoadingIndicatorProps {
  /** Optional name interpolated into any `{name}` token in the micro-copy. */
  name?: string;
  /** Override the rotating loading messages. */
  messages?: string[];
  /** Whether to show the rotating micro-copy text (default: true) */
  showMicroCopy?: boolean;
  /** Test identifier */
  testID?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LOGO_WIDTH = Math.min(SCREEN_WIDTH * 0.6, 320);

export function LoadingIndicator(props?: LoadingIndicatorProps) {
  const { name, messages, showMicroCopy = true, testID } = props ?? {};
  const { t } = useTranslation('common');

  const themeColors = useThemeColors();
  const reducedMotion = useReducedMotion();

  // Breathing logo animation — scale 1.0 ↔ 1.03, 4s cycle.
  const logoScale = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      logoScale.value = 1;
      return;
    }

    logoScale.value = withRepeat(
      withSequence(
        withTiming(1.03, { duration: 2000, easing: contemplativeFade.easing }),
        withTiming(1, { duration: 2000, easing: contemplativeFade.easing })
      ),
      -1
    );
  }, [reducedMotion, logoScale]);

  // Inline animated style (NOT a className) — see the golden-fix note above.
  const logoAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));

  return (
    <View
      testID={testID ?? 'loading-indicator-container'}
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={t('a11y.loadingContent')}
    >
      {/* Theme-aware gradient background */}
      <LinearGradient
        colors={[themeColors.background, themeColors.muted]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0.3 }}
        end={{ x: 0.5, y: 1 }}
      />

      <View style={styles.content}>
        {/* Breathing logo — Animated.View styled via INLINE style only. */}
        <Animated.View style={logoAnimatedStyle}>
          <Image
            source={require('@/assets/splash.png')}
            style={[styles.logo, { width: LOGO_WIDTH }]}
            resizeMode="contain"
            testID="loading-indicator-icon"
          />
        </Animated.View>

        {/* Accent-colored loading dots */}
        <View style={styles.dotsContainer}>
          <LoadingDots dotSize={8} testID="loading-indicator-dots" />
        </View>

        {/* Rotating micro-copy */}
        {showMicroCopy && (
          <View style={styles.copyContainer}>
            <RotatingMicroCopy
              name={name}
              messages={messages}
              testID="loading-indicator-micro-copy"
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 20,
    marginTop: -60,
  },
  logo: {
    height: 160,
  },
  dotsContainer: {
    marginTop: 32,
  },
  copyContainer: {
    marginTop: 24,
    paddingHorizontal: 40,
  },
});

export type { LoadingIndicatorProps };
