/**
 * @module components/custom/__tests__/AnimatedSplash.test
 *
 * Holds the splash until auth + onboarding are decidable (not a fixed 400ms),
 * so a signed-in cold start never reveals a role-fork flash underneath.
 */
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from 'bun:test';
import { act, render } from '@testing-library/react-native';

type SetupRoleValue = 'parent' | 'nanny' | 'helper';

interface OnboardingMockState {
  status: 'loading' | 'onboarded' | 'not-onboarded';
  role: SetupRoleValue | null;
  householdId: string | null;
  membershipsError: boolean;
}

let onboardingState: OnboardingMockState;
let authState: {
  isInitialized: boolean;
  session: { user: { id: string } } | null;
};
let mockOnFinish: ReturnType<typeof mock>;

let AnimatedSplash: typeof import('../AnimatedSplash').AnimatedSplash;
let resetSplash: typeof import('../AnimatedSplash').__resetAnimatedSplashForTests;

beforeAll(async () => {
  mock.module('react-native-reanimated', () => {
    const React = require('react');
    const { View } = require('react-native');
    return {
      default: {
        View: (props: Record<string, unknown>) =>
          React.createElement(View, props),
      },
      FadeOut: { duration: () => ({}) },
    };
  });

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => onboardingState,
  }));

  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: typeof authState) => unknown) =>
      selector(authState),
  }));

  const mod = await import('../AnimatedSplash');
  AnimatedSplash = mod.AnimatedSplash;
  resetSplash = mod.__resetAnimatedSplashForTests;
});

beforeEach(() => {
  resetSplash();
  jest.useFakeTimers();
  onboardingState = {
    status: 'loading',
    role: null,
    householdId: null,
    membershipsError: false,
  };
  authState = {
    isInitialized: false,
    session: { user: { id: 'u1' } },
  };
  mockOnFinish = mock();
});

describe('AnimatedSplash', () => {
  it('stays visible while auth is not initialized', () => {
    const { getByTestId } = render(<AnimatedSplash onFinish={mockOnFinish} />);

    expect(getByTestId('animated-splash')).toBeTruthy();
    expect(mockOnFinish).not.toHaveBeenCalled();
  });

  it('stays visible while a signed-in user is still loading onboarding', () => {
    authState = {
      isInitialized: true,
      session: { user: { id: 'u1' } },
    };

    const { getByTestId } = render(<AnimatedSplash onFinish={mockOnFinish} />);

    expect(getByTestId('animated-splash')).toBeTruthy();
    expect(mockOnFinish).not.toHaveBeenCalled();
  });

  it('finishes once a signed-in user resolves onboarded', () => {
    authState = {
      isInitialized: true,
      session: { user: { id: 'u1' } },
    };
    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };

    render(<AnimatedSplash onFinish={mockOnFinish} />);

    expect(mockOnFinish).toHaveBeenCalled();
  });

  it('finishes for a signed-out user once auth is initialized', () => {
    authState = { isInitialized: true, session: null };

    render(<AnimatedSplash onFinish={mockOnFinish} />);

    expect(mockOnFinish).toHaveBeenCalled();
  });

  it('finishes on membershipsError so Index can show the retry UI', () => {
    authState = {
      isInitialized: true,
      session: { user: { id: 'u1' } },
    };
    onboardingState = {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: true,
    };

    render(<AnimatedSplash onFinish={mockOnFinish} />);

    expect(mockOnFinish).toHaveBeenCalled();
  });

  it('safety-timeout finishes even if onboarding never resolves', () => {
    authState = {
      isInitialized: true,
      session: { user: { id: 'u1' } },
    };

    render(<AnimatedSplash onFinish={mockOnFinish} />);
    expect(mockOnFinish).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(mockOnFinish).toHaveBeenCalled();
  });
});
