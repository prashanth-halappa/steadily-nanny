/**
 * Celebration Animation Utilities
 *
 * Simple, self-contained celebration effects built on Reanimated shared values
 * (no external confetti libraries). Provides a confetti overlay plus haptic
 * helpers for milestones and achievements.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  type ThemeColors,
  useThemeColors,
} from '@/lib/design-tokens/useThemeColors';

import { HAPTIC_PATTERNS } from './haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/** Number of confetti particles */
const PARTICLE_COUNT = 20;

/** Confetti particle colors — Daylight semantic palette (theme-aware). */
function confettiColorsFromTheme(colors: ThemeColors): readonly string[] {
  return [
    colors.primary,
    colors.success,
    colors.category.accent1,
    colors.category.accent2,
    colors.category.accent3,
    colors.warning,
    colors.highlight,
  ];
}

/** Confetti particle shapes */
type ParticleShape = 'square' | 'circle';

/** Particle configuration */
interface ParticleConfig {
  id: number;
  x: number;
  color: string;
  size: number;
  shape: ParticleShape;
  delay: number;
  duration: number;
  rotation: number;
}

/**
 * Generate random particle configurations.
 */
function generateParticles(palette: readonly string[]): ParticleConfig[] {
  const defaultColor = palette[0];
  if (!defaultColor) return [];

  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    x: Math.random() * SCREEN_WIDTH,
    color: palette[Math.floor(Math.random() * palette.length)] ?? defaultColor,
    size: 6 + Math.random() * 8,
    shape: (Math.random() > 0.5 ? 'square' : 'circle') as ParticleShape,
    delay: Math.random() * 400,
    duration: 1200 + Math.random() * 800,
    rotation: Math.random() * 360,
  }));
}

/**
 * Individual confetti particle component.
 */
function ConfettiParticle({
  config,
  isActive,
}: {
  config: ParticleConfig;
  isActive: boolean;
}) {
  const translateY = useSharedValue(-50);
  const opacity = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      opacity.value = withDelay(
        config.delay,
        withSequence(
          withTiming(1, { duration: 100 }),
          withDelay(config.duration - 400, withTiming(0, { duration: 300 }))
        )
      );
      translateY.value = withDelay(
        config.delay,
        withTiming(SCREEN_HEIGHT + 50, {
          duration: config.duration,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        })
      );
      rotate.value = withDelay(
        config.delay,
        withTiming(config.rotation + 720, {
          duration: config.duration,
          easing: Easing.linear,
        })
      );
    } else {
      cancelAnimation(translateY);
      cancelAnimation(opacity);
      cancelAnimation(rotate);
      translateY.value = -50;
      opacity.value = 0;
      rotate.value = 0;
    }
  }, [isActive, config, translateY, opacity, rotate]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return React.createElement(Animated.View, {
    style: [
      {
        position: 'absolute',
        left: config.x,
        top: -50,
        width: config.size,
        height: config.size,
        backgroundColor: config.color,
        borderRadius: config.shape === 'circle' ? config.size / 2 : 0,
      },
      animatedStyle,
    ],
  });
}

interface ConfettiOverlayProps {
  /** Whether confetti is currently active */
  isActive: boolean;
  /** Optional callback when animation completes */
  onComplete?: () => void;
}

/**
 * ConfettiOverlay — Renders animated confetti particles falling from top.
 *
 * Usage:
 * ```tsx
 * const [showConfetti, setShowConfetti] = useState(false);
 * <ConfettiOverlay isActive={showConfetti} onComplete={() => setShowConfetti(false)} />
 * ```
 */
export function ConfettiOverlay({
  isActive,
  onComplete,
}: ConfettiOverlayProps) {
  const themeColors = useThemeColors();
  const confettiPalette = useMemo(
    () => confettiColorsFromTheme(themeColors),
    [themeColors]
  );
  const particles = useMemo(
    () => generateParticles(confettiPalette),
    [confettiPalette]
  );

  useEffect(() => {
    if (isActive && onComplete) {
      // Auto-complete after the longest particle finishes
      const maxDuration = Math.max(...particles.map(p => p.delay + p.duration));
      const timer = setTimeout(onComplete, maxDuration + 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isActive, onComplete, particles]);

  if (!isActive) return null;

  return React.createElement(
    View,
    {
      style: StyleSheet.absoluteFill,
      pointerEvents: 'none',
      testID: 'confetti-overlay',
    },
    particles.map(config =>
      React.createElement(ConfettiParticle, {
        key: config.id,
        config,
        isActive,
      })
    )
  );
}

/**
 * Trigger confetti with haptic feedback.
 * Use with the ConfettiOverlay component.
 */
export function triggerConfetti(): void {
  HAPTIC_PATTERNS.celebration();
}

/**
 * Trigger a milestone celebration haptic, scaled by magnitude.
 * Use alongside ConfettiOverlay for the full effect.
 *
 * @param magnitude - Larger values yield a stronger pattern.
 */
export function triggerStreakMilestone(magnitude: number): void {
  if (magnitude >= 30) {
    HAPTIC_PATTERNS.milestone();
  } else if (magnitude >= 7) {
    HAPTIC_PATTERNS.achievement();
  } else {
    HAPTIC_PATTERNS.celebration();
  }
}

/**
 * Trigger an achievement celebration haptic.
 */
export function triggerAchievement(): void {
  HAPTIC_PATTERNS.achievement();
}

/**
 * Hook for managing confetti state.
 *
 * Usage:
 * ```tsx
 * const { isActive, trigger, reset } = useConfetti();
 * ```
 */
export function useConfetti() {
  const [isActive, setIsActive] = React.useState(false);

  const trigger = useCallback(() => {
    triggerConfetti();
    setIsActive(true);
  }, []);

  const reset = useCallback(() => {
    setIsActive(false);
  }, []);

  return { isActive, trigger, reset };
}
