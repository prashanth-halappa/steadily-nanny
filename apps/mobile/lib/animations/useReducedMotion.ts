/**
 * useReducedMotion Hook + Animation Degradation Map
 *
 * Detects if the user has requested reduced motion in system settings and
 * provides getAnimationConfig() for graceful animation degradation.
 *
 * Degradation rules:
 * - confetti -> static checkmark icon
 * - staggered entrance -> simultaneous render (no delay)
 * - slide transitions -> opacity-only fades
 * - spring animations -> linear timing (duration: 200ms)
 *
 * Usage:
 *   const reducedMotion = useReducedMotion();
 *   const config = getAnimationConfig(reducedMotion);
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Check initial preference
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      setReducedMotion(enabled);
    });

    // Listen for changes
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      enabled => {
        setReducedMotion(enabled);
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

/** Animation configuration returned by getAnimationConfig */
export interface AnimationConfig {
  /** Transition animation (spring vs linear timing) */
  transition: {
    type: 'spring' | 'timing';
    duration?: number;
    damping?: number;
    stiffness?: number;
  };
  /** Staggered entrance config */
  staggeredEntrance: {
    enabled: boolean;
    delayMs: number;
  };
  /** Celebration animation style */
  celebration: {
    type: 'confetti' | 'static';
  };
  /** Slide transition config */
  slideTransition: {
    enabled: boolean;
  };
}

/** Full animation config for normal motion */
const FULL_MOTION_CONFIG: AnimationConfig = {
  transition: {
    type: 'spring',
    damping: 15,
    stiffness: 150,
  },
  staggeredEntrance: {
    enabled: true,
    delayMs: 80,
  },
  celebration: {
    type: 'confetti',
  },
  slideTransition: {
    enabled: true,
  },
};

/** Reduced animation config for accessibility */
const REDUCED_MOTION_CONFIG: AnimationConfig = {
  transition: {
    type: 'timing',
    duration: 200,
  },
  staggeredEntrance: {
    enabled: false,
    delayMs: 0,
  },
  celebration: {
    type: 'static',
  },
  slideTransition: {
    enabled: false,
  },
};

/**
 * Returns the appropriate animation configuration based on the reduce motion preference.
 * When reduceMotion is true, returns degraded configs.
 */
export function getAnimationConfig(reduceMotion: boolean): AnimationConfig {
  return reduceMotion ? REDUCED_MOTION_CONFIG : FULL_MOTION_CONFIG;
}
