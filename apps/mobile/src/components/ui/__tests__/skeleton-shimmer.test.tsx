/**
 * SkeletonShimmer Component Tests
 *
 * Tests for the reusable shimmer primitive component.
 * Validates rendering, dimensions, border radius, and dimensionColor behavior.
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
import { SkeletonShimmer } from '../skeleton-shimmer';

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

  describe('Dimension color', () => {
    it('should apply dimensionColor as top border when provided', () => {
      const { getByTestId } = render(
        <SkeletonShimmer
          width={100}
          height={20}
          dimensionColor="#F5A623"
          testID="colored-shimmer"
        />
      );
      const element = getByTestId('colored-shimmer');
      const style = element.props.style;
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY))
        : style;
      expect(flatStyle.borderTopWidth).toBe(2);
      expect(flatStyle.borderTopColor).toBe('#F5A62333'); // 20% opacity
    });

    it('should not have top border when dimensionColor is not provided', () => {
      const { getByTestId } = render(
        <SkeletonShimmer width={100} height={20} testID="no-color-shimmer" />
      );
      const element = getByTestId('no-color-shimmer');
      const style = element.props.style;
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY))
        : style;
      expect(flatStyle.borderTopWidth).toBeUndefined();
    });
  });
});
