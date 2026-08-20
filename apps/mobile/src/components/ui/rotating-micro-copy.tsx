/**
 * RotatingMicroCopy
 *
 * Cycles through short loading messages with a cross-fade animation. Messages
 * are shuffled on mount (Fisher-Yates). Pass your own `messages` to customize.
 * Respects reduced motion accessibility preferences.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

const FADE_DURATION_MS = 400;
const DEFAULT_INTERVAL_MS = 3000;

const DEFAULT_MESSAGE_KEYS = [
  'microCopy.gettingReady',
  'microCopy.justAMoment',
  'microCopy.loadingExperience',
  'microCopy.almostThere',
  'microCopy.settingUp',
  'microCopy.oneSecond',
] as const;

interface RotatingMicroCopyProps {
  /** Rotation interval in milliseconds. Default 3000. */
  interval?: number;
  /** Override the rotating message set. Falls back to a generic default set. */
  messages?: string[];
  /** Optional name interpolated into any message containing the `{name}` token. */
  name?: string;
  /** Test ID for testing. Default 'rotating-micro-copy'. */
  testID?: string;
}

/**
 * Fisher-Yates (Knuth) shuffle — returns a new shuffled copy.
 */
function fisherYatesShuffle<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j] as T;
    shuffled[j] = temp as T;
  }
  return shuffled;
}

export function RotatingMicroCopy({
  interval = DEFAULT_INTERVAL_MS,
  messages: messagesProp,
  name,
  testID = 'rotating-micro-copy',
}: RotatingMicroCopyProps) {
  const { t } = useTranslation('common');
  const reducedMotion = useReducedMotion();
  const colors = useThemeColors();
  const opacity = useSharedValue(1);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Build the message list once on mount.
  const messages = useMemo(() => {
    const base = messagesProp?.length
      ? messagesProp
      : DEFAULT_MESSAGE_KEYS.map(key => t(key));
    const interpolated = name ? base.map(m => m.replace('{name}', name)) : base;
    return fisherYatesShuffle(interpolated);
  }, [messagesProp, name, t]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Tracks the trailing cross-fade setTimeout scheduled below, so it can be
  // cleared on cleanup — without this it leaks: if the component unmounts
  // (or the interval effect re-runs) mid-fade, the timeout still fires later
  // and calls setCurrentIndex on a stale/unmounted instance.
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Advance to the next message with a cross-fade.
  const advanceMessage = useCallback(() => {
    if (messagesRef.current.length <= 1) return;

    if (reducedMotion) {
      // Instant swap — no animation.
      setCurrentIndex(prev => (prev + 1) % messagesRef.current.length);
      return;
    }

    // Fade out.
    opacity.value = withTiming(0, { duration: FADE_DURATION_MS });

    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
    }

    // After fade-out completes, swap text and fade back in.
    fadeTimeoutRef.current = setTimeout(() => {
      setCurrentIndex(prev => (prev + 1) % messagesRef.current.length);
      opacity.value = withTiming(1, { duration: FADE_DURATION_MS });
      fadeTimeoutRef.current = null;
    }, FADE_DURATION_MS);
  }, [opacity, reducedMotion]);

  // Set up the rotation interval.
  useEffect(() => {
    if (messages.length <= 1) return;

    const id = setInterval(advanceMessage, interval);
    return () => {
      clearInterval(id);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    };
  }, [interval, advanceMessage, messages.length]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.Text
      testID={testID}
      style={[
        animatedStyle,
        {
          color: colors.mutedForeground,
          textAlign: 'center',
          fontSize: 14,
          lineHeight: 21,
          fontWeight: '400',
        },
      ]}
    >
      {messages[currentIndex]}
    </Animated.Text>
  );
}

export type { RotatingMicroCopyProps };
