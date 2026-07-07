/**
 * Body Typography Component Tests
 *
 * Tests for Body, BodyLight, P, Lead, Large, Small, Muted components.
 * Uses dynamic imports after mocking reanimated to prevent module-load hang.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

// Declared at module level; assigned in beforeAll after mocks are registered.
let P: any;
let Body: any;
let BodyLight: any;
let Lead: any;
let Large: any;
let Small: any;
let Muted: any;

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

  const mod = await import('../../typography');
  P = mod.P;
  Body = mod.Body;
  BodyLight = mod.BodyLight;
  Lead = mod.Lead;
  Large = mod.Large;
  Small = mod.Small;
  Muted = mod.Muted;
});

function getJsonChildren(
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null
): ReactTestRendererJSON['children'] | undefined {
  if (!tree) return undefined;
  if (Array.isArray(tree)) return tree[0]?.children ?? undefined;
  return tree.children ?? undefined;
}

describe('Body Typography Components', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('P', () => {
    it('should render without crashing', () => {
      const { root } = render(<P>Paragraph text</P>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<P>Test content</P>);
      const tree = toJSON();
      expect(tree).toBeTruthy();
      expect(getJsonChildren(tree)).toContain('Test content');
    });

    it('should apply custom className', () => {
      const { root } = render(<P className="custom-class">Text</P>);
      expect(root).toBeTruthy();
    });
  });

  describe('Body', () => {
    it('should render without crashing', () => {
      const { root } = render(<Body>Body text</Body>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Body>Body content</Body>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Body content');
    });
  });

  describe('BodyLight', () => {
    it('should render without crashing', () => {
      const { root } = render(<BodyLight>Light body text</BodyLight>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<BodyLight>Light content</BodyLight>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Light content');
    });
  });

  describe('Lead', () => {
    it('should render without crashing', () => {
      const { root } = render(<Lead>Lead text</Lead>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Lead>Lead content</Lead>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Lead content');
    });
  });

  describe('Large', () => {
    it('should render without crashing', () => {
      const { root } = render(<Large>Large text</Large>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Large>Large content</Large>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Large content');
    });
  });

  describe('Small', () => {
    it('should render without crashing', () => {
      const { root } = render(<Small>Small text</Small>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Small>Small content</Small>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Small content');
    });
  });

  describe('Muted', () => {
    it('should render without crashing', () => {
      const { root } = render(<Muted>Muted text</Muted>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Muted>Muted content</Muted>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Muted content');
    });
  });
});
