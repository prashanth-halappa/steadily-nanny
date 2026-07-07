/**
 * MaybeStagger Component Tests
 *
 * Verifies the conditional stagger wrapper:
 * - shouldStagger=true  -> renders StaggeredFadeIn with correct index
 * - shouldStagger=false -> renders Fragment (no wrapper View)
 * - Children always rendered regardless of shouldStagger
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
import { MaybeStagger } from '../MaybeStagger';

describe('MaybeStagger', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  it('should render StaggeredFadeIn when shouldStagger=true', () => {
    const { getByText, toJSON } = render(
      <MaybeStagger index={2} shouldStagger={true}>
        <Text>Staggered Child</Text>
      </MaybeStagger>
    );

    // Children are always rendered
    expect(getByText('Staggered Child')).toBeTruthy();

    // Should have a wrapper View (from StaggeredFadeIn's Animated.View mock -> View)
    const tree = toJSON();
    expect(tree).toBeTruthy();
    // The tree should be a View (from StaggeredFadeIn) wrapping the Text
    expect(tree).toHaveProperty('type', 'View');
  });

  it('should render Fragment (no wrapper) when shouldStagger=false', () => {
    const { getByText, toJSON } = render(
      <MaybeStagger index={2} shouldStagger={false}>
        <Text>Plain Child</Text>
      </MaybeStagger>
    );

    // Children are always rendered
    expect(getByText('Plain Child')).toBeTruthy();

    // Fragment renders no wrapper — the tree root is the Text element itself
    const tree = toJSON();
    expect(tree).toBeTruthy();
    expect(tree).toHaveProperty('type', 'Text');
  });

  it('should always render children regardless of shouldStagger', () => {
    const { getByText: getByTextTrue } = render(
      <MaybeStagger index={0} shouldStagger={true}>
        <Text>Always Visible</Text>
      </MaybeStagger>
    );
    expect(getByTextTrue('Always Visible')).toBeTruthy();

    const { getByText: getByTextFalse } = render(
      <MaybeStagger index={0} shouldStagger={false}>
        <Text>Always Visible</Text>
      </MaybeStagger>
    );
    expect(getByTextFalse('Always Visible')).toBeTruthy();
  });

  it('should pass index to StaggeredFadeIn when shouldStagger=true', () => {
    // Spy on FadeInUp.delay to verify the index is passed through
    const delaySpy = mock(() => ({
      duration: mock(() => 'mocked-animation'),
    }));

    const { FadeInUp } = require('react-native-reanimated');
    const originalDelay = FadeInUp.delay;
    FadeInUp.delay = delaySpy;

    render(
      <MaybeStagger index={5} shouldStagger={true}>
        <Text>Indexed Child</Text>
      </MaybeStagger>
    );

    // Default staggerDelay is 60, so delay should be called with 5 * 60 = 300
    expect(delaySpy).toHaveBeenCalledWith(300);

    // Restore original
    FadeInUp.delay = originalDelay;
  });
});
