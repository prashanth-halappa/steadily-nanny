/**
 * useMilestone — one owner for haptic + easing + confetti per delight tier.
 *
 * @module lib/animations/__tests__/useMilestone.test
 */
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { renderHook } from '@testing-library/react-native';
import { easingSignature } from '@/lib/animations/easing';
import { HAPTIC_PATTERNS } from '@/lib/animations/haptics';

let mockReducedMotion = false;
let useMilestone: typeof import('@/lib/animations/useMilestone').useMilestone;

beforeAll(async () => {
  mock.module('@/lib/animations/useReducedMotion', () => ({
    useReducedMotion: () => mockReducedMotion,
    getAnimationConfig: (reduce: boolean) => ({
      transition: reduce
        ? { type: 'timing' as const, duration: 200 }
        : { type: 'spring' as const, damping: 15, stiffness: 150 },
      staggeredEntrance: {
        enabled: !reduce,
        delayMs: reduce ? 0 : 80,
      },
      celebration: { type: reduce ? 'static' : 'confetti' },
      slideTransition: { enabled: !reduce },
    }),
  }));

  const mod = await import('@/lib/animations/useMilestone');
  useMilestone = mod.useMilestone;
});

describe('useMilestone', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  it.each([
    ['silent', { easing: null, showConfetti: false }],
    [
      'acknowledged',
      { easing: easingSignature.gentleRise, showConfetti: false },
    ],
    ['receipt', { easing: easingSignature.gentleRise, showConfetti: false }],
    ['moment', { easing: easingSignature.celebrationPop, showConfetti: true }],
  ] as const)('returns the %s shape', (tier, expected) => {
    const { result } = renderHook(() => useMilestone(tier, `shape-${tier}`));
    expect(result.current).toEqual(expected);
  });

  it('fires its haptic exactly once per key across remounts', () => {
    const milestone = spyOn(HAPTIC_PATTERNS, 'milestone');
    const { unmount } = renderHook(() => useMilestone('moment', 'remount-key'));
    unmount();
    renderHook(() => useMilestone('moment', 'remount-key'));
    expect(milestone).toHaveBeenCalledTimes(1);
    milestone.mockRestore();
  });

  it('showConfetti is false under reduced motion even for the moment tier', () => {
    mockReducedMotion = true;
    const { result } = renderHook(() =>
      useMilestone('moment', 'reduced-motion-key')
    );
    expect(result.current.showConfetti).toBe(false);
  });

  it('fires nothing when the key is null', () => {
    const milestone = spyOn(HAPTIC_PATTERNS, 'milestone');
    const achievement = spyOn(HAPTIC_PATTERNS, 'achievement');
    const encouragement = spyOn(HAPTIC_PATTERNS, 'encouragement');
    renderHook(() => useMilestone('moment', null));
    expect(milestone).not.toHaveBeenCalled();
    expect(achievement).not.toHaveBeenCalled();
    expect(encouragement).not.toHaveBeenCalled();
    milestone.mockRestore();
    achievement.mockRestore();
    encouragement.mockRestore();
  });
});
