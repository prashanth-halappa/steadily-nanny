/**
 * Milestone delight hook — one haptic, one easing, optional confetti per tier.
 *
 * Later streams call this instead of reaching for ConfettiOverlay or
 * HAPTIC_PATTERNS directly, so a given key fires its haptic exactly once.
 *
 * @module lib/animations/useMilestone
 */

import { useEffect } from 'react';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { easingSignature } from './easing';
import { HAPTIC_PATTERNS } from './haptics';

export const MILESTONE_TIERS = {
  silent: { haptic: null, easing: null, confetti: false },
  acknowledged: {
    haptic: 'encouragement',
    easing: 'gentleRise',
    confetti: false,
  },
  receipt: { haptic: 'achievement', easing: 'gentleRise', confetti: false },
  moment: { haptic: 'milestone', easing: 'celebrationPop', confetti: true },
} as const;

export type MilestoneTier = keyof typeof MILESTONE_TIERS;

type EasingSignature = (typeof easingSignature)[keyof typeof easingSignature];

interface MilestoneResult {
  easing: EasingSignature | null;
  showConfetti: boolean;
}

const firedKeys = new Set<string>();

export function useMilestone(
  tier: MilestoneTier,
  key: string | null
): MilestoneResult {
  const reducedMotion = useReducedMotion();
  const config = MILESTONE_TIERS[tier];

  useEffect(() => {
    if (key === null || tier === 'silent') return;
    if (firedKeys.has(key)) return;
    firedKeys.add(key);
    const hapticName = config.haptic;
    if (hapticName) {
      void HAPTIC_PATTERNS[hapticName]();
    }
  }, [config.haptic, key, tier]);

  const easing = config.easing === null ? null : easingSignature[config.easing];

  return {
    easing,
    showConfetti: config.confetti && !reducedMotion,
  };
}
