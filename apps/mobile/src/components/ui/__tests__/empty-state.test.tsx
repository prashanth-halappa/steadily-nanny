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
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { EmptyState } from '../empty-state';

// StyleSheet.flatten is stubbed out by the react-native mock in bun.setup.ts.
function rootStyle(variant: 'default' | 'inline'): Record<string, unknown> {
  const tree = render(
    <EmptyState variant={variant} title="Nothing here" description="" />
  ).toJSON();
  const root = Array.isArray(tree) ? tree[0] : tree;
  const style = root?.props.style;
  return Object.assign({}, ...[style].flat().filter(Boolean));
}

describe('EmptyState animated root', () => {
  it('fills its parent for the full-screen default variant', () => {
    expect(rootStyle('default').flex).toBe(1);
  });

  it('stays content-sized for the inline variant', () => {
    expect(rootStyle('inline').flex).toBeUndefined();
  });
});
