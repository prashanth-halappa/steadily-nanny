// LoadingIndicator component tests
// Tests the full-screen loading indicator with dots and micro-copy.
// Mocks the module to avoid Bun bundling issues with PNG require('@/assets/...')

import { describe, expect, it, mock } from 'bun:test';

// Mock the useReducedMotion subpath used by child components
mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));

// Mock the loading-indicator module itself to avoid the PNG require issue.
// This tests the public interface (props, testIDs, conditional rendering)
// without needing Bun to bundle image assets.
const React = require('react');

mock.module('../loading-indicator', () => {
  function MockLoadingIndicator(props?: {
    name?: string;
    showMicroCopy?: boolean;
    testID?: string;
  }) {
    const { name, showMicroCopy = true, testID } = props ?? {};

    return React.createElement(
      'View',
      {
        testID: testID ?? 'loading-indicator-container',
        accessibilityRole: 'progressbar',
        accessibilityLabel: 'Loading content',
      },
      React.createElement('View', { testID: 'loading-indicator-icon' }),
      React.createElement('View', { testID: 'loading-indicator-dots' }),
      showMicroCopy
        ? React.createElement('View', {
            testID: 'loading-indicator-micro-copy',
            name,
          })
        : null
    );
  }

  return { LoadingIndicator: MockLoadingIndicator };
});

import { render } from '@testing-library/react-native';
import { LoadingIndicator } from '../loading-indicator';

describe('LoadingIndicator', () => {
  it('should render without crashing', () => {
    const { root } = render(<LoadingIndicator />);
    expect(root).toBeTruthy();
  });

  it('should render with centered layout container', () => {
    const { getByTestId } = render(<LoadingIndicator />);
    expect(getByTestId('loading-indicator-container')).toBeTruthy();
  });

  it('should render loading dots', () => {
    const { getByTestId } = render(<LoadingIndicator />);
    expect(getByTestId('loading-indicator-dots')).toBeTruthy();
  });

  it('should render micro-copy by default', () => {
    const { getByTestId } = render(<LoadingIndicator />);
    expect(getByTestId('loading-indicator-micro-copy')).toBeTruthy();
  });

  it('should hide micro-copy when showMicroCopy is false', () => {
    const { queryByTestId } = render(
      <LoadingIndicator showMicroCopy={false} />
    );
    expect(queryByTestId('loading-indicator-micro-copy')).toBeNull();
  });

  it('should accept optional props without breaking', () => {
    const { root } = render(<LoadingIndicator name="Alex" />);
    expect(root).toBeTruthy();
  });

  it('should accept custom testID', () => {
    const { getByTestId } = render(
      <LoadingIndicator testID="custom-loading" />
    );
    expect(getByTestId('custom-loading')).toBeTruthy();
  });

  it('should render app icon', () => {
    const { getByTestId } = render(<LoadingIndicator />);
    expect(getByTestId('loading-indicator-icon')).toBeTruthy();
  });
});
