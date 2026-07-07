// LoadingButton component tests
// Tests the button with in-place loading dots and success checkmark transitions

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

import { fireEvent, render } from '@testing-library/react-native';
import { LoadingButton } from '../loading-button';

describe('LoadingButton', () => {
  it('should render label text when not loading', () => {
    const { getByTestId } = render(<LoadingButton label="Save" />);
    const labelView = getByTestId('loading-button-label');
    expect(labelView).toBeTruthy();
  });

  it('should show loading state when isLoading is true', () => {
    const { getByTestId } = render(<LoadingButton label="Save" isLoading />);
    const dotsView = getByTestId('loading-button-dots');
    expect(dotsView).toBeTruthy();
  });

  it('should show success state when isSuccess is true', () => {
    const { getByTestId } = render(<LoadingButton label="Save" isSuccess />);
    const checkView = getByTestId('loading-button-check');
    expect(checkView).toBeTruthy();
  });

  it('should have disabled prop when loading', () => {
    const { getByTestId } = render(<LoadingButton label="Save" isLoading />);
    const button = getByTestId('loading-button');
    // The Button component receives the disabled prop when isLoading is true
    expect(button.props.disabled).toBe(true);
  });

  it('should support custom testID', () => {
    const { getByTestId } = render(
      <LoadingButton label="Save" testID="custom-btn" />
    );
    expect(getByTestId('custom-btn')).toBeTruthy();
  });

  it('should fire onPress when not loading', () => {
    const onPress = mock(() => {});
    const { getByTestId } = render(
      <LoadingButton label="Save" onPress={onPress} />
    );
    const button = getByTestId('loading-button');
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
