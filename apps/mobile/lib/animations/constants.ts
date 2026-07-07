/**
 * Animation Constants
 *
 * Standard durations and easing curves for consistent animations
 * across the app. Use these instead of hardcoded values.
 */

/**
 * Animation durations in milliseconds
 *
 * Note: Signature animations (Growth Bloom, Gentle Rise, etc.) are now primary.
 * Legacy durations are kept for reference but Growth Bloom (600ms) should be preferred.
 */
export const ANIMATION_DURATION = {
  /** 150ms - Quick feedback animations (button press, hover) */
  fast: 150,
  /** 250ms - Standard transitions (expand/collapse, fade) */
  normal: 250,
  /** 350ms - Slower, more noticeable animations (screen transitions) */
  slow: 350,
  /** 400ms - Gentle Rise duration (upward movement) */
  gentleRise: 400,
  /** 500ms - Celebration Pop duration (enthusiastic bounce) */
  celebrationPop: 500,
  /** 600ms - Growth Bloom duration (organic growth, primary signature animation) */
  growthBloom: 600,
  /** 800ms - Contemplative Fade duration (slow, thoughtful) */
  contemplativeFade: 800,
} as const;

/**
 * Spring animation configurations
 * Provides natural, physics-based motion
 */
export const SPRING_CONFIG = {
  /** Light spring for subtle feedback */
  light: {
    damping: 15,
    stiffness: 200,
  },
  /** Medium spring for standard interactions */
  medium: {
    damping: 20,
    stiffness: 150,
  },
  /** Heavy spring for prominent animations */
  heavy: {
    damping: 25,
    stiffness: 100,
  },
} as const;

/**
 * Timing animation configurations
 * For non-spring animations
 */
export const TIMING_CONFIG = {
  /** Ease out - Fast start, slow end (good for entrances) */
  easeOut: {
    duration: ANIMATION_DURATION.normal,
  },
  /** Ease in out - Smooth acceleration and deceleration */
  easeInOut: {
    duration: ANIMATION_DURATION.normal,
  },
} as const;

/**
 * Scale values for press feedback
 */
export const PRESS_SCALE = {
  /** Subtle press (0.98) - For large elements */
  subtle: 0.98,
  /** Standard press (0.96) - For buttons */
  standard: 0.96,
  /** Prominent press (0.94) - For important actions */
  prominent: 0.94,
} as const;

/**
 * Opacity values for press feedback
 */
export const PRESS_OPACITY = {
  /** Subtle (0.9) */
  subtle: 0.9,
  /** Standard (0.8) */
  standard: 0.8,
} as const;
