// LoadingDots component tests
// Tests the three-dot loading indicator with staggered pulse animation

import { describe, expect, it, mock } from 'bun:test';

// Mock the specific useReducedMotion subpath used by the component
mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));

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
import { LoadingDots } from '../loading-dots';

describe('LoadingDots', () => {
  it('should render without crashing', () => {
    const { root } = render(<LoadingDots />);
    expect(root).toBeTruthy();
  });

  it('should render three dots', () => {
    const { getByTestId } = render(<LoadingDots />);
    const container = getByTestId('loading-dots');
    expect(container.children).toHaveLength(3);
  });

  it('should use default testID "loading-dots"', () => {
    const { getByTestId } = render(<LoadingDots />);
    expect(getByTestId('loading-dots')).toBeTruthy();
  });

  it('should support custom testID', () => {
    const { getByTestId } = render(<LoadingDots testID="custom-dots" />);
    expect(getByTestId('custom-dots')).toBeTruthy();
  });

  it('should use custom dotSize prop for width and height', () => {
    const { toJSON } = render(<LoadingDots dotSize={12} />);
    const tree = toJSON() as any;

    // The container View has three Animated.View children (rendered as View by mock)
    expect(tree.children).toHaveLength(3);

    for (const dot of tree.children) {
      // Style is an array: [inline style object, animated style object]
      const inlineStyle = Array.isArray(dot.props.style)
        ? dot.props.style[0]
        : dot.props.style;
      expect(inlineStyle.width).toBe(12);
      expect(inlineStyle.height).toBe(12);
    }
  });
});
