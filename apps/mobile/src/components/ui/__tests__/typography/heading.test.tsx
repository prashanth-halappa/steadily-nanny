/**
 * Heading Typography Component Tests
 *
 * Tests for H1, H2, H3, H4 heading components.
 * Uses dynamic imports after mocking reanimated to prevent module-load hang.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

// Declared at module level; assigned in beforeAll after mocks are registered.
let H1: any;
let H2: any;
let H3: any;
let H4: any;

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
  const mod = await import('../../typography/heading');
  H1 = mod.H1;
  H2 = mod.H2;
  H3 = mod.H3;
  H4 = mod.H4;
});

function getJsonChildren(
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null
): ReactTestRendererJSON['children'] | undefined {
  if (!tree) return undefined;
  if (Array.isArray(tree)) return tree[0]?.children ?? undefined;
  return tree.children ?? undefined;
}

describe('Heading Typography Components', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('H1', () => {
    it('should render without crashing', () => {
      const { root } = render(<H1>Heading 1</H1>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<H1>Heading 1</H1>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Heading 1');
    });

    it('should apply custom className', () => {
      const { root } = render(<H1 className="custom-class">Heading 1</H1>);
      expect(root).toBeTruthy();
    });

    it('should forward testID prop', () => {
      const { getByTestId } = render(<H1 testID="h1-test">Heading 1</H1>);
      expect(getByTestId('h1-test')).toBeTruthy();
    });
  });

  describe('H2', () => {
    it('should render without crashing', () => {
      const { root } = render(<H2>Heading 2</H2>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<H2>Heading 2</H2>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Heading 2');
    });

    it('should forward testID prop', () => {
      const { getByTestId } = render(<H2 testID="h2-test">Heading 2</H2>);
      expect(getByTestId('h2-test')).toBeTruthy();
    });
  });

  describe('H3', () => {
    it('should render without crashing', () => {
      const { root } = render(<H3>Heading 3</H3>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<H3>Heading 3</H3>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Heading 3');
    });
  });

  describe('H4', () => {
    it('should render without crashing', () => {
      const { root } = render(<H4>Heading 4</H4>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<H4>Heading 4</H4>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Heading 4');
    });
  });
});
