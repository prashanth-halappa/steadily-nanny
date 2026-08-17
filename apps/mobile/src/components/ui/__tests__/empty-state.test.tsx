/**
 * The `default` variant's container is `flex-1`. Its parent — the animation's
 * Animated.View root — carried transform/opacity only, so it sized itself to
 * content while the child sized itself to a parent that had no height: the
 * container collapsed to ~0 and the centred 240px illustration painted ~half
 * its height ABOVE the box, over whatever sat above it (seen on Schedule →
 * Shifts, over the Agenda/Week switcher, with the title invisible).
 *
 * Every other call site in the app passes variant="inline", whose container is
 * NOT flex-1 — which is exactly why only this one screen looked broken. So the
 * root must take flex for `default` and must NOT take it for `inline`, or the
 * inline states inside ScrollViews and list ListEmptyComponents grow to fill.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { typography } from '@/lib/design-tokens/typography';
import { palette } from '~/lib/design-tokens/palette';
import { EmptyState } from '../empty-state';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

const TEST_IMAGE = { uri: 'https://example.com/empty.png' };

// StyleSheet.flatten is stubbed out by the react-native mock in bun.setup.ts.
function rootStyle(variant: 'default' | 'inline'): Record<string, unknown> {
  const tree = render(
    <EmptyState variant={variant} title="Nothing here" description="" />
  ).toJSON();
  const root = Array.isArray(tree) ? tree[0] : tree;
  const style = root?.props.style;
  return Object.assign({}, ...[style].flat().filter(Boolean));
}

function backgroundColor(style: unknown): string | undefined {
  const entries = Array.isArray(style) ? style : [style];
  const bg = entries.find(
    (s): s is ViewStyle => Boolean(s) && 'backgroundColor' in (s as object)
  );
  return bg?.backgroundColor as string | undefined;
}

function findNodes(
  node: ReactTestInstance | null,
  predicate: (node: ReactTestInstance) => boolean
): ReactTestInstance[] {
  if (!node) return [];
  const matches = predicate(node) ? [node] : [];
  const children = node.children ?? [];
  for (const child of children) {
    if (typeof child === 'object' && child !== null && 'type' in child) {
      matches.push(...findNodes(child as ReactTestInstance, predicate));
    }
  }
  return matches;
}

function textStyle(node: ReactTestInstance): TextStyle {
  const style = node.props.style;
  const entries = Array.isArray(style) ? style : [style];
  return Object.assign({}, ...entries.filter(Boolean)) as TextStyle;
}

describe('EmptyState animated root', () => {
  it('fills its parent for the full-screen default variant', () => {
    expect(rootStyle('default').flex).toBe(1);
  });

  it('stays content-sized for the inline variant', () => {
    expect(rootStyle('inline').flex).toBeUndefined();
  });
});

describe('EmptyState illustration ground', () => {
  it('places a chipPlum circle at 1.6× the default illustration width', () => {
    // 200 × 1.6 = 320. The default image was 240 (⇒ a 384 ground) until that
    // ground was found painting over the Schedule tab's view switcher.
    const { UNSAFE_root } = render(
      <EmptyState
        variant="default"
        image={TEST_IMAGE}
        title="Nothing here"
        description="No items yet"
      />
    );
    const grounds = findNodes(
      UNSAFE_root,
      node =>
        backgroundColor(node.props.style) === palette.light.chipPlum.hex &&
        node.props.style?.width === 320
    );
    expect(grounds.length).toBe(1);
    expect(grounds[0]?.props.style.height).toBe(320);
    expect(grounds[0]?.props.style.borderRadius).toBe(160);
  });

  it('places a chipPlum circle at 1.6× the inline illustration width', () => {
    const { UNSAFE_root } = render(
      <EmptyState
        variant="inline"
        image={TEST_IMAGE}
        title="Nothing here"
        description="No items yet"
      />
    );
    const grounds = findNodes(
      UNSAFE_root,
      node =>
        backgroundColor(node.props.style) === palette.light.chipPlum.hex &&
        node.props.style?.width === 256
    );
    expect(grounds.length).toBe(1);
    expect(grounds[0]?.props.style.height).toBe(256);
    expect(grounds[0]?.props.style.borderRadius).toBe(128);
  });
});

describe('EmptyState illustration footprint', () => {
  // THE REGRESSION THIS FILE EXISTS FOR. The ground is absolutely positioned
  // and RN does not clip, so a wrapper sized to the IMAGE let a 1.6× circle
  // paint 0.3x outside itself in every direction — over the Agenda/Week/Rhythm
  // switcher sitting directly above it on the Schedule tab. The wrapper must
  // report the ground's size, so layout can account for what actually paints.
  it.each([
    ['default' as const, 320],
    ['inline' as const, 256],
  ])('sizes the %s wrapper to the ground, not the image', (variant, ground) => {
    const { UNSAFE_root } = render(
      <EmptyState
        variant={variant}
        image={TEST_IMAGE}
        title="Nothing here"
        description="No items yet"
      />
    );
    const wrappers = findNodes(
      UNSAFE_root,
      node =>
        node.props.style?.width === ground &&
        node.props.style?.height === ground &&
        backgroundColor(node.props.style) === undefined
    );
    expect(wrappers.length).toBeGreaterThan(0);
  });
});

describe('EmptyState typography', () => {
  it('uses H3 for the title and Body for the description', () => {
    const { getByText } = render(
      <EmptyState title="Nothing here" description="No items yet" />
    );

    const titleNode = getByText('Nothing here');
    const descriptionNode = getByText('No items yet');

    expect(textStyle(titleNode).fontSize).toBe(typography.h3.size);
    expect(titleNode.props['aria-level']).toBe('3');
    expect(textStyle(descriptionNode).fontSize).toBe(typography.body.size);
    expect(descriptionNode.props.className).toContain('text-muted-foreground');
  });
});
