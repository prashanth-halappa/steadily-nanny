/**
 * Utility Typography Component Tests
 *
 * Tests for Caption, Label, MetadataLabel, Button, ButtonSmall,
 * BlockQuote, Code, Achievement, Encouragement components.
 * Uses dynamic imports after mocking reanimated to prevent module-load hang.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

// Declared at module level; assigned in beforeAll after mocks are registered.
let Caption: any;
let Label: any;
let MetadataLabel: any;
let ButtonText: any;
let ButtonSmall: any;
let BlockQuote: any;
let Code: any;
let Achievement: any;
let Encouragement: any;

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
  Caption = mod.Caption;
  Label = mod.Label;
  MetadataLabel = mod.MetadataLabel;
  ButtonText = mod.Button;
  ButtonSmall = mod.ButtonSmall;
  BlockQuote = mod.BlockQuote;
  Code = mod.Code;
  Achievement = mod.Achievement;
  Encouragement = mod.Encouragement;
});

function getJsonChildren(
  tree: ReactTestRendererJSON | ReactTestRendererJSON[] | null
): ReactTestRendererJSON['children'] | undefined {
  if (!tree) return undefined;
  if (Array.isArray(tree)) return tree[0]?.children ?? undefined;
  return tree.children ?? undefined;
}

describe('Utility Typography Components', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('Caption', () => {
    it('should render without crashing', () => {
      const { root } = render(<Caption>Caption text</Caption>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Caption>Caption text</Caption>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Caption text');
    });
  });

  describe('Label', () => {
    it('should render without crashing', () => {
      const { root } = render(<Label>Label text</Label>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Label>Label text</Label>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Label text');
    });
  });

  describe('MetadataLabel', () => {
    it('should render without crashing', () => {
      const { root } = render(<MetadataLabel>Metadata</MetadataLabel>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<MetadataLabel>Metadata</MetadataLabel>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Metadata');
    });
  });

  describe('Button (text)', () => {
    it('should render without crashing', () => {
      const { root } = render(<ButtonText>Button Text</ButtonText>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<ButtonText>Button Text</ButtonText>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Button Text');
    });
  });

  describe('ButtonSmall', () => {
    it('should render without crashing', () => {
      const { root } = render(<ButtonSmall>Small Button</ButtonSmall>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<ButtonSmall>Small Button</ButtonSmall>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Small Button');
    });
  });

  describe('BlockQuote', () => {
    it('should render without crashing', () => {
      const { root } = render(<BlockQuote>Quote text</BlockQuote>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<BlockQuote>Quote text</BlockQuote>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Quote text');
    });
  });

  describe('Code', () => {
    it('should render without crashing', () => {
      const { root } = render(<Code>code snippet</Code>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Code>code snippet</Code>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('code snippet');
    });
  });

  describe('Achievement', () => {
    it('should render without crashing', () => {
      const { root } = render(<Achievement>Achievement unlocked!</Achievement>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(
        <Achievement>Achievement unlocked!</Achievement>
      );
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Achievement unlocked!');
    });
  });

  describe('Encouragement', () => {
    it('should render without crashing', () => {
      const { root } = render(<Encouragement>Keep going!</Encouragement>);
      expect(root).toBeTruthy();
    });

    it('should render children', () => {
      const { toJSON } = render(<Encouragement>Keep going!</Encouragement>);
      const tree = toJSON();
      expect(getJsonChildren(tree)).toContain('Keep going!');
    });
  });
});
