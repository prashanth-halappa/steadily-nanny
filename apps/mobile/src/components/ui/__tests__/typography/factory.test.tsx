/**
 * Typography Factory — TextClassContext Resolution Tests
 *
 * Verifies createTypographyComponent's className precedence when nested
 * inside a container (e.g. Button) that publishes TextClassContext:
 * explicit `className` > context value > hardcoded DEFAULT_CLASS.
 * Regression coverage for P0-3 (Daylight UX audit): LoadingButton's label
 * ignored the context Button publishes, painting foreground-on-primary at
 * ~1.7:1 contrast.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

// Declared at module level; assigned in beforeAll after mocks are registered.
let createTypographyComponent: typeof import('../../typography/factory').createTypographyComponent;
let TextClassContext: typeof import('../../text').TextClassContext;

beforeAll(async () => {
  // Block react-native-reanimated from executing its withRepeat/withSequence
  // animation loops at module-load time (Bun hang bug).
  mock.module('react-native-reanimated', () => ({
    default: {
      createAnimatedComponent: (component: unknown) => component,
      View: 'View',
      Text: 'View',
      Image: 'View',
      ScrollView: 'View',
    },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: unknown) =>
      typeof fn === 'function' ? (fn as () => unknown)() : {},
    useAnimatedProps: () => ({}),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useReducedMotion: () => false,
    useAnimatedReaction: () => {},
    useAnimatedGestureHandler: () => ({}),
    useAnimatedScrollHandler: () => ({}),
    useAnimatedRef: () => ({ current: null }),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withDelay: (_: unknown, animation: unknown) => animation,
    withSequence: (...args: unknown[]) => args[0],
    withRepeat: (animation: unknown) => animation,
    withDecay: () => ({}),
    cancelAnimation: () => {},
    runOnJS: (fn: unknown) => fn,
    runOnUI: (fn: unknown) => fn,
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

  createTypographyComponent = (await import('../../typography/factory'))
    .createTypographyComponent;
  TextClassContext = (await import('../../text')).TextClassContext;
});

function getProps(
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null
): Record<string, unknown> | undefined {
  if (!tree) return undefined;
  if (Array.isArray(tree)) return tree[0]?.props;
  return tree.props;
}

const token = {
  size: 16,
  lineHeight: 24,
  weight: '600' as const,
  letterSpacing: 0,
};

describe('createTypographyComponent — TextClassContext resolution', () => {
  beforeEach(() => {
    cleanup();
  });

  it('applies the hardcoded default class when there is no context and no explicit className', () => {
    const Sample = createTypographyComponent(token, 'Sample');
    const { toJSON } = render(<Sample>label</Sample>);
    const className = getProps(toJSON())?.className;
    expect(className).toBe('text-foreground web:select-text');
  });

  it('lets a context value (e.g. published by Button) win over the hardcoded default', () => {
    const Sample = createTypographyComponent(token, 'Sample');
    const { toJSON } = render(
      <TextClassContext.Provider value="text-primary-foreground">
        <Sample>label</Sample>
      </TextClassContext.Provider>
    );
    const className = String(getProps(toJSON())?.className);
    const classes = className.split(' ');
    expect(classes).toContain('text-primary-foreground');
    expect(classes).not.toContain('text-foreground');
  });

  it('lets an explicit className win over a published context value', () => {
    const Sample = createTypographyComponent(token, 'Sample');
    const { toJSON } = render(
      <TextClassContext.Provider value="text-primary-foreground">
        <Sample className="text-destructive">label</Sample>
      </TextClassContext.Provider>
    );
    const className = String(getProps(toJSON())?.className);
    const classes = className.split(' ');
    expect(classes).toContain('text-destructive');
    expect(classes).not.toContain('text-primary-foreground');
    expect(classes).not.toContain('text-foreground');
  });

  it('lets an explicit className win over the hardcoded default with no context present', () => {
    const Sample = createTypographyComponent(token, 'Sample');
    const { toJSON } = render(
      <Sample className="text-muted-foreground">label</Sample>
    );
    const className = String(getProps(toJSON())?.className);
    const classes = className.split(' ');
    expect(classes).toContain('text-muted-foreground');
    expect(classes).not.toContain('text-foreground');
  });

  it('leaves a custom defaultClassName in place when no context is published', () => {
    const Sample = createTypographyComponent(token, 'Sample', {
      defaultClassName: 'text-muted-foreground web:select-text',
    });
    const { toJSON } = render(<Sample>label</Sample>);
    const className = getProps(toJSON())?.className;
    expect(className).toBe('text-muted-foreground web:select-text');
  });
});
