/**
 * ConfettiOverlay reduced-motion contract + barrel export.
 *
 * The overlay is already built; these tests pin that it now consults
 * `getAnimationConfig` (static → null, still completes) and that the
 * animations barrel re-exports it so later streams can import from one place.
 *
 * @module lib/animations/__tests__/celebrations.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { render } from '@testing-library/react-native';

let mockReducedMotion = false;
let ConfettiOverlay: typeof import('@/lib/animations/celebrations').ConfettiOverlay;

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

  const mod = await import('@/lib/animations/celebrations');
  ConfettiOverlay = mod.ConfettiOverlay;
});

describe('ConfettiOverlay', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  it('renders confetti-overlay when active and motion is allowed', () => {
    mockReducedMotion = false;
    const { getByTestId } = render(<ConfettiOverlay isActive />);
    expect(getByTestId('confetti-overlay')).toBeTruthy();
  });

  it('renders null and still calls onComplete when reduced motion is on', () => {
    mockReducedMotion = true;
    const onComplete = mock(() => {});
    const { queryByTestId } = render(
      <ConfettiOverlay isActive onComplete={onComplete} />
    );
    expect(queryByTestId('confetti-overlay')).toBeNull();
    expect(onComplete).toHaveBeenCalled();
  });

  it('is exported from the animations barrel', async () => {
    const barrelPath = join(__dirname, '../index.ts');
    const source = await Bun.file(barrelPath).text();
    expect(source).toContain("'./celebrations'");
  });
});
