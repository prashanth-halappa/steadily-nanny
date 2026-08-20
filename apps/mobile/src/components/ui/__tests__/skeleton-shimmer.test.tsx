/**
 * SkeletonShimmer Component Tests
 *
 * Tests for the reusable shimmer primitive component.
 * Validates rendering, dimensions, border radius, and the 00-FOUNDATIONS 8.8
 * shimmer contract (crossfade base -> highlight, no accent border).
 */

import { describe, expect, it, mock } from 'bun:test';

// Mock the nativewind color-scheme wrapper. nativewind's setColorScheme calls
// react-native-css-interop's StyleSheet.getFlag, which is unavailable under the
// bun test css-interop mock and crashes render(). Mocking this wrapper lets the
// real useThemeColors hook return the real light palette.
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

import { render } from '@testing-library/react-native';
import { palette } from '@/lib/design-tokens/palette';
import { SkeletonShimmer } from '../skeleton-shimmer';

const source = await Bun.file(
  new URL('../skeleton-shimmer.tsx', import.meta.url).pathname
).text();

// A docblock naming a removed prop is documentation, not a usage -- the repo's
// own design guards skip comment lines for exactly this reason
// (`design-guards/mechanical.test.ts`'s `isCommentLine`).
const code = source
  .split('\n')
  .filter(line => {
    const t = line.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  })
  .join('\n');

function flatStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY).filter(Boolean))
    : ((style ?? {}) as Record<string, unknown>);
}

describe('SkeletonShimmer', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { root } = render(<SkeletonShimmer width={100} height={20} />);
      expect(root).toBeTruthy();
    });

    it('should use default testID of skeleton-shimmer', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width={100} height={20} />
      );
      expect(getByTestId('skeleton-shimmer')).toBeTruthy();
    });

    it('should support custom testID', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width={100} height={20} testID="custom-skeleton" />
      );
      expect(getByTestId('custom-skeleton')).toBeTruthy();
    });
  });

  describe('Dimensions', () => {
    it('should apply numeric width and height', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width={120} height={24} testID="sized-shimmer" />
      );
      const element = getByTestId('sized-shimmer');
      const style = element.props.style;
      // Reanimated wraps styles; flatten and check the static style object
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY))
        : style;
      expect(flatStyle.width).toBe(120);
      expect(flatStyle.height).toBe(24);
    });

    it('should apply string width', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width="90%" height={16} testID="pct-shimmer" />
      );
      const element = getByTestId('pct-shimmer');
      const style = element.props.style;
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY))
        : style;
      expect(flatStyle.width).toBe('90%');
    });
  });

  describe('Border radius', () => {
    it('should use default borderRadius of 4', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width={100} height={20} testID="default-radius" />
      );
      const element = getByTestId('default-radius');
      const style = element.props.style;
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY))
        : style;
      expect(flatStyle.borderRadius).toBe(4);
    });

    it('should apply custom borderRadius', () => {
      const { getByTestId } = render(
        <SkeletonShimmer
          width={80}
          height={22}
          borderRadius={999}
          testID="pill-shimmer"
        />
      );
      const element = getByTestId('pill-shimmer');
      const style = element.props.style;
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY))
        : style;
      expect(flatStyle.borderRadius).toBe(999);
    });
  });

  // 01-LAWS.md 6: the ban on card borders and accent bars stands, with Rule D's
  // inset hairline as the single exception. A 2dp top border on a skeleton is
  // the accent bar the system removed, and `dimensionColor` had no production
  // caller -- so the prop is gone rather than restyled.
  describe('No accent bar (01-LAWS 6)', () => {
    it('never draws a top border', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width={100} height={20} testID="no-accent" />
      );
      const flat = flatStyle(getByTestId('no-accent'));
      expect(flat.borderTopWidth).toBeUndefined();
      expect(flat.borderTopColor).toBeUndefined();
    });

    it('exposes no dimensionColor prop', () => {
      expect(code).not.toContain('dimensionColor');
      expect(code).not.toContain('borderTopWidth');
    });
  });

  // 00-FOUNDATIONS.md 8.8: "skeletonBase #EDE5EA (secondary) ->
  // skeletonHighlight #FFFFFF. Shimmer period 1200ms, easing.inOut."
  // Opacity-dimming the base colour is the cold grey pulse that spec replaced.
  describe('Shimmer crossfades colour (00-FOUNDATIONS 8.8)', () => {
    it('animates backgroundColor rather than opacity', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width={100} height={20} testID="crossfade" />
      );
      const flat = flatStyle(getByTestId('crossfade'));
      expect(flat.backgroundColor).toBe(palette.light.skeletonBase.hex);
      expect(flat.opacity).toBeUndefined();
    });

    // The reanimated mock collapses withTiming to its target and runs the
    // worklet once, so the period and the highlight target are only observable
    // in source -- the same reason widgets and weekReceiptHtml are pinned this
    // way (docs/09-TESTING.md 5, Pattern A).
    it('crossfades to the highlight token over the 1200ms period', () => {
      expect(code).toContain('skeleton.highlight');
      expect(code).toContain('SHIMMER_PERIOD_MS = 1200');
      expect(code).not.toContain('0.3');
    });
  });
});
