/**
 * StaggeredFadeIn Component Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Track reduced motion state for tests
let mockReducedMotion = false;

mock.module('../useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

// Mock react-native-reanimated
mock.module('react-native-reanimated', () => {
  const { View } = require('react-native');
  const FadeInUp = {
    delay: (_d: number) => ({
      duration: (_dur: number) => 'mocked-animation',
      delay: (_d2: number) => ({
        duration: (_dur2: number) => 'mocked-animation',
      }),
    }),
    duration: (_dur: number) => 'mocked-animation',
  };
  return {
    default: { View },
    FadeInUp,
  };
});

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { StaggeredFadeIn } from '../StaggeredFadeIn';

describe('StaggeredFadeIn', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  it('should render children correctly', () => {
    const { getByText } = render(
      <StaggeredFadeIn index={0}>
        <Text>Hello World</Text>
      </StaggeredFadeIn>
    );

    expect(getByText('Hello World')).toBeTruthy();
  });

  it('should pass testID to the wrapper', () => {
    const { getByTestId } = render(
      <StaggeredFadeIn index={0} testID="staggered-item">
        <Text>Content</Text>
      </StaggeredFadeIn>
    );

    expect(getByTestId('staggered-item')).toBeTruthy();
  });

  it('should fall back to plain View when reduced motion is enabled', () => {
    mockReducedMotion = true;

    const { toJSON, getByTestId, getByText } = render(
      <StaggeredFadeIn index={0} testID="static-item">
        <Text>Static Content</Text>
      </StaggeredFadeIn>
    );

    const tree = toJSON();
    expect(tree).toBeTruthy();
    expect(getByTestId('static-item')).toBeTruthy();
    expect(getByText('Static Content')).toBeTruthy();
  });

  it('should use correct delay calculation (index * staggerDelay)', () => {
    const delaySpy = mock(() => ({
      duration: mock(() => 'mocked-animation'),
    }));

    // Re-mock with spy to capture delay values
    const { FadeInUp } = require('react-native-reanimated');
    const originalDelay = FadeInUp.delay;
    FadeInUp.delay = delaySpy;

    render(
      <StaggeredFadeIn index={3} staggerDelay={100} duration={300}>
        <Text>Delayed Item</Text>
      </StaggeredFadeIn>
    );

    expect(delaySpy).toHaveBeenCalledWith(300); // 3 * 100
    const result = delaySpy.mock.results[0] as
      | { type: string; value: { duration: ReturnType<typeof mock> } }
      | undefined;
    expect(result?.value.duration).toHaveBeenCalledWith(300);

    // Restore original
    FadeInUp.delay = originalDelay;
  });
});
