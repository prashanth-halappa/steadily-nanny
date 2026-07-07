/**
 * Signature Easing Functions
 *
 * Custom easing curves that give the app a distinctive, organic animation
 * personality — warm, natural motion instead of stock linear/ease curves.
 *
 * Usage:
 *   import { easingSignature } from '@/lib/animations/easing';
 *   withTiming(value, {
 *     duration: easingSignature.growthBloom.duration,
 *     easing: easingSignature.growthBloom.easing,
 *   });
 */

import { Easing } from 'react-native-reanimated';

/**
 * Growth Bloom: Slow start, gentle overshoot (like a flower opening).
 * Best for: Card entrances, list items, organic growth animations.
 */
export const growthBloom = {
  bezier: [0.34, 1.56, 0.64, 1] as const,
  duration: 600,
  easing: Easing.bezier(0.34, 1.56, 0.64, 1),
};

/**
 * Gentle Rise: Upward movement with a soft landing.
 * Best for: Empty states, gentle entrances, contemplative moments.
 */
export const gentleRise = {
  bezier: [0.25, 0.46, 0.45, 0.94] as const,
  duration: 400,
  easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
};

/**
 * Celebration Pop: Enthusiastic but not jarring.
 * Best for: Milestones, achievements, celebratory moments.
 */
export const celebrationPop = {
  bezier: [0.68, -0.55, 0.265, 1.55] as const,
  duration: 500,
  easing: Easing.bezier(0.68, -0.55, 0.265, 1.55),
};

/**
 * Contemplative Fade: Slow, thoughtful (for reading/reflection).
 * Best for: Text reveals, modal entrances, reflective content.
 */
export const contemplativeFade = {
  bezier: [0.4, 0.0, 0.2, 1] as const,
  duration: 800,
  easing: Easing.bezier(0.4, 0.0, 0.2, 1),
};

/**
 * Main export object for easy access.
 */
export const easingSignature = {
  growthBloom,
  gentleRise,
  celebrationPop,
  contemplativeFade,
};
