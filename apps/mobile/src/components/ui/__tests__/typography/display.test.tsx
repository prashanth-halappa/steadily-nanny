/**
 * Display Typography Component Tests
 *
 * Tests for Display and DisplayLarge components.
 * Uses dynamic imports after mocking reanimated to prevent module-load hang.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

// Declared at module level; assigned in beforeAll after mocks are registered.
let Display: any;
let DisplayLarge: any;
let Timer: any;
let DayGroup: any;

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
  const mod = await import('../../typography/display');
  Display = mod.Display;
  DisplayLarge = mod.DisplayLarge;
  Timer = mod.Timer;
  DayGroup = mod.DayGroup;
});

function getJsonChildren(
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null
): ReactTestRendererJSON['children'] | undefined {
  if (!tree) return undefined;
  if (Array.isArray(tree)) return tree[0]?.children ?? undefined;
  return tree.children ?? undefined;
}

describe('Display Typography Components', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('DisplayLarge', () => {
    it('should render without crashing', () => {
      const { root } = render(<DisplayLarge>Large Display Text</DisplayLarge>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(
        <DisplayLarge>Large Display Text</DisplayLarge>
      );
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Large Display Text');
    });

    it('should apply custom className', () => {
      const { root } = render(
        <DisplayLarge className="custom-class">Text</DisplayLarge>
      );
      expect(root).toBeTruthy();
    });

    it('should forward testID prop', () => {
      const { getByTestId } = render(
        <DisplayLarge testID="display-large-test">Text</DisplayLarge>
      );
      expect(getByTestId('display-large-test')).toBeTruthy();
    });
  });

  describe('Display', () => {
    it('should render without crashing', () => {
      const { root } = render(<Display>Display Text</Display>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Display>Display Text</Display>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Display Text');
    });

    it('should forward testID prop', () => {
      const { getByTestId } = render(
        <Display testID="display-test">Text</Display>
      );
      expect(getByTestId('display-test')).toBeTruthy();
    });
  });

  describe('Timer', () => {
    it('should render without crashing', () => {
      const { root } = render(<Timer>01:23:45</Timer>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Timer>01:23:45</Timer>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('01:23:45');
    });

    it('should forward testID prop', () => {
      const { getByTestId } = render(
        <Timer testID="timer-test">00:00:01</Timer>
      );
      expect(getByTestId('timer-test')).toBeTruthy();
    });

    it('should apply tabular numerals by default', () => {
      const { getByText } = render(<Timer>12:34:56</Timer>);
      const node = getByText('12:34:56');
      const flatStyle = Array.isArray(node.props.style)
        ? Object.assign({}, ...node.props.style.filter(Boolean))
        : node.props.style;
      expect(flatStyle.fontVariant).toEqual(['tabular-nums']);
    });
  });

  describe('DayGroup', () => {
    it('should render without crashing', () => {
      const { root } = render(<DayGroup>Monday, Aug 2</DayGroup>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<DayGroup>Monday, Aug 2</DayGroup>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Monday, Aug 2');
    });

    it('should forward testID prop', () => {
      const { getByTestId } = render(
        <DayGroup testID="day-group-test">Tuesday</DayGroup>
      );
      expect(getByTestId('day-group-test')).toBeTruthy();
    });
  });
});
