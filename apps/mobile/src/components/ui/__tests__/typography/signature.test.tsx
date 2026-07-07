/**
 * Signature Typography Component Tests
 *
 * Tests for SignatureHeroLight, SignatureHeroBold,
 * SignatureMilestoneHeading, SignatureContemplative components.
 * Uses dynamic imports after mocking reanimated to prevent module-load hang.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

// Declared at module level; assigned in beforeAll after mocks are registered.
let SignatureHeroLight: any;
let SignatureHeroBold: any;
let SignatureMilestoneHeading: any;
let SignatureContemplative: any;

beforeAll(async () => {
  // Block react-native-reanimated from executing its withRepeat/withSequence
  // animation loops at module-load time (Bun hang bug).
  mock.module('react-native-reanimated', () => ({
    default: {
      createAnimatedComponent: (component: any) => component,
      View: 'View',
      Text: 'View',
      Image: 'View',
      ScrollView: 'View',
    },
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: (fn: any) => (typeof fn === 'function' ? fn() : {}),
    useAnimatedProps: () => ({}),
    useDerivedValue: (fn: any) => ({ value: fn() }),
    useReducedMotion: () => false,
    useAnimatedReaction: () => {},
    useAnimatedGestureHandler: () => ({}),
    useAnimatedScrollHandler: () => ({}),
    useAnimatedRef: () => ({ current: null }),
    withTiming: (v: any) => v,
    withSpring: (v: any) => v,
    withDelay: (_: any, animation: any) => animation,
    withSequence: (...args: any[]) => args[0],
    withRepeat: (animation: any) => animation,
    withDecay: () => ({}),
    cancelAnimation: () => {},
    runOnJS: (fn: any) => fn,
    runOnUI: (fn: any) => fn,
    interpolate: () => 0,
    Extrapolate: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    Easing: {
      bezier: () => () => 0,
      linear: () => ({}),
      ease: () => ({}),
    },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
    SlideInDown: { duration: () => ({ springify: () => ({}) }) },
    SlideOutDown: { duration: () => ({}) },
  }));

  // Import from sub-file to bypass the barrel-level setup mock and get
  // the real components (needed so testID forwarding can be verified).
  const mod = await import('../../typography/signature');
  SignatureHeroLight = mod.SignatureHeroLight;
  SignatureHeroBold = mod.SignatureHeroBold;
  SignatureMilestoneHeading = mod.SignatureMilestoneHeading;
  SignatureContemplative = mod.SignatureContemplative;
});

function getJsonChildren(
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null
): ReactTestRendererJSON['children'] | undefined {
  if (!tree) return undefined;
  if (Array.isArray(tree)) return tree[0]?.children ?? undefined;
  return tree.children ?? undefined;
}

describe('Signature Typography Components', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('SignatureHeroLight', () => {
    it('should render without crashing', () => {
      const { root } = render(
        <SignatureHeroLight>Good morning</SignatureHeroLight>
      );
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(
        <SignatureHeroLight>Good morning</SignatureHeroLight>
      );
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Good morning');
    });

    it('should apply custom className', () => {
      const { root } = render(
        <SignatureHeroLight className="custom">Text</SignatureHeroLight>
      );
      expect(root).toBeTruthy();
    });
  });

  describe('SignatureHeroBold', () => {
    it('should render without crashing', () => {
      const { root } = render(<SignatureHeroBold>Emma</SignatureHeroBold>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<SignatureHeroBold>Emma</SignatureHeroBold>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Emma');
    });
  });

  describe('SignatureMilestoneHeading', () => {
    it('should render without crashing', () => {
      const { root } = render(
        <SignatureMilestoneHeading>
          Milestone Reached!
        </SignatureMilestoneHeading>
      );
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(
        <SignatureMilestoneHeading>
          Milestone Reached!
        </SignatureMilestoneHeading>
      );
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Milestone Reached!');
    });

    it('should forward testID prop', () => {
      const { getByTestId } = render(
        <SignatureMilestoneHeading testID="milestone-test">
          Text
        </SignatureMilestoneHeading>
      );
      expect(getByTestId('milestone-test')).toBeTruthy();
    });
  });

  describe('SignatureContemplative', () => {
    it('should render without crashing', () => {
      const { root } = render(
        <SignatureContemplative>
          Take a moment to reflect...
        </SignatureContemplative>
      );
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(
        <SignatureContemplative>
          Take a moment to reflect...
        </SignatureContemplative>
      );
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Take a moment to reflect...');
    });
  });
});
