/**
 * @module app/__tests__/index.behavior.test
 *
 * Render test for the entry router (`src/app/index.tsx`).
 *
 * Lives here, NOT colocated next to `index.tsx`, because expo-router treats
 * any file under `src/app/` as a route (GOLDEN-FIXES.md #8).
 *
 * The defect this locks down: with the API unreachable, `useIsOnboarded()`
 * cannot tell "the memberships request failed" from "this user has no
 * memberships", and the entry router branched on `status`/`role` alone — so a
 * nanny holding two active memberships was replaced into the "Who are you?"
 * role fork. The hook now reports `status: 'loading' + membershipsError: true`;
 * this file asserts the router honours it (no navigation, retryable error UI)
 * and that the once-per-identity latch still lets a recovered status re-route.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

type SetupRoleValue = 'parent' | 'nanny' | 'helper';

interface OnboardingMockState {
  status: 'loading' | 'onboarded' | 'not-onboarded';
  role: SetupRoleValue | null;
  householdId: string | null;
  membershipsError: boolean;
}

const SIGNED_IN_SESSION = { user: { id: 'user-1' } };

let onboardingState: OnboardingMockState;
let authState: { isInitialized: boolean; session: unknown };
let hasToken: boolean;
let setupProgressState: {
  role: SetupRoleValue | null;
  path: 'create' | 'join' | null;
  currentStep: string;
};

let mockReplace: ReturnType<typeof mock>;
let mockRetryMemberships: ReturnType<typeof mock>;
let mockConsumePendingLink: ReturnType<typeof mock>;

let Index: typeof import('../index').default;

beforeAll(async () => {
  mockReplace = mock();
  mockRetryMemberships = mock();
  mockConsumePendingLink = mock((): string | null => null);

  // The preload's expo-router mock hands back a FRESH replace mock per
  // useRouter() call, so it can't be asserted on. Re-mock with a stable one.
  mock.module('expo-router', () => ({
    useRouter: () => ({ replace: mockReplace }),
  }));

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      ...onboardingState,
      retryMemberships: mockRetryMemberships,
    }),
  }));

  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (state: typeof authState) => unknown) =>
      selector(authState),
  }));

  mock.module('@/src/api/client', () => ({
    hasAuthToken: () => hasToken,
  }));

  mock.module('@/src/store/pendingDeepLinkStore', () => ({
    usePendingDeepLinkStore: {
      getState: () => ({ consumePendingLink: mockConsumePendingLink }),
    },
  }));

  mock.module('@/src/store/setupProgress', () => ({
    useSetupProgressStore: {
      getState: () => setupProgressState,
    },
  }));

  mock.module('@/src/components/ui/loading-indicator', () => {
    const React = require('react');
    return {
      LoadingIndicator: () =>
        React.createElement('View', { testID: 'loading-indicator-mock' }),
    };
  });

  mock.module('@/src/components/custom/ErrorState', () => {
    const React = require('react');
    return {
      ErrorState: (props: { variant?: string; onRetry?: () => void }) =>
        React.createElement('View', {
          testID: 'error-state-mock',
          accessibilityLabel: props.variant ?? 'no-variant',
          onPress: props.onRetry,
        }),
    };
  });

  Index = (await import('../index')).default;
});

beforeEach(() => {
  onboardingState = {
    status: 'loading',
    role: null,
    householdId: null,
    membershipsError: false,
  };
  authState = { isInitialized: true, session: SIGNED_IN_SESSION };
  hasToken = true;
  setupProgressState = { role: null, path: null, currentStep: 'ROLE' };
  mockReplace.mockReset();
  mockRetryMemberships.mockReset();
  mockConsumePendingLink.mockReset();
  mockConsumePendingLink.mockImplementation(() => null);
});

describe('Index entry router — memberships failure must not route', () => {
  it('renders a retryable error and navigates NOWHERE when memberships errored', () => {
    onboardingState = {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: true,
    };

    const { getByTestId, queryByTestId } = render(<Index />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('index-error')).toBeTruthy();
    expect(getByTestId('error-state-mock').props.accessibilityLabel).toBe(
      'network'
    );
    expect(queryByTestId('loading-indicator-mock')).toBeNull();
  });

  it('retries the memberships query exactly once when retry is pressed', () => {
    onboardingState = {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: true,
    };

    const { getByTestId } = render(<Index />);
    fireEvent.press(getByTestId('error-state-mock'));

    expect(mockRetryMemberships).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('routes to home once the memberships query recovers after an error', () => {
    onboardingState = {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: true,
    };

    const { rerender, queryByTestId } = render(<Index />);
    expect(mockReplace).not.toHaveBeenCalled();

    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };
    rerender(<Index />);

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
    expect(queryByTestId('index-error')).toBeNull();
  });

  it('routes to home when a not-onboarded verdict is later corrected to onboarded', () => {
    // The latch defect in isolation: the first decision is recorded against the
    // bare user id, so a corrected status can never re-route the same user.
    onboardingState = {
      status: 'not-onboarded',
      role: null,
      householdId: null,
      membershipsError: false,
    };

    const { rerender } = render(<Index />);
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/role');

    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };
    rerender(<Index />);

    expect(mockReplace).toHaveBeenLastCalledWith('/(private)/(tabs)/home');
    expect(mockReplace).toHaveBeenCalledTimes(2);
  });
});

describe('Index entry router — the branches that must keep working', () => {
  it('shows the spinner and routes nowhere while onboarding status is loading', () => {
    const { getByTestId, queryByTestId } = render(<Index />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('loading-indicator-mock')).toBeTruthy();
    expect(queryByTestId('index-error')).toBeNull();
  });

  it('routes a genuinely new user with no role to the role fork', () => {
    onboardingState = {
      status: 'not-onboarded',
      role: null,
      householdId: null,
      membershipsError: false,
    };

    const { getByTestId, queryByTestId } = render(<Index />);

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/role');
    expect(getByTestId('loading-indicator-mock')).toBeTruthy();
    expect(queryByTestId('index-error')).toBeNull();
  });

  // D-33 moved this landing spot from CHILDREN to HOUSEHOLD. The router no
  // longer carries its own `PARENT ? CHILDREN : ROLE` ternary — that was one
  // of three drifted copies of the role -> step mapping — and asks
  // `entryStepFor(role, path)` instead. HouseholdScreen adopts the household
  // this parent already owns and pre-fills its name rather than minting a
  // second, so landing there costs one tap and buys a name they never got to
  // type.
  it('resumes a not-onboarded parent at the household step', () => {
    onboardingState = {
      status: 'not-onboarded',
      role: 'parent',
      householdId: 'h1',
      membershipsError: false,
    };

    render(<Index />);

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/household');
  });

  it('routes to /welcome with no session and no auth token', () => {
    authState = { isInitialized: true, session: null };
    hasToken = false;

    const { getByTestId, queryByTestId } = render(<Index />);

    expect(mockReplace).toHaveBeenCalledWith('/welcome');
    expect(getByTestId('loading-indicator-mock')).toBeTruthy();
    expect(queryByTestId('index-error')).toBeNull();
  });

  it('resumes an onboarded parent at the persisted wizard step', () => {
    onboardingState = {
      status: 'onboarded',
      role: 'parent',
      householdId: 'h1',
      membershipsError: false,
    };
    setupProgressState = {
      role: 'parent',
      path: 'create',
      currentStep: 'INVITE',
    };

    render(<Index />);

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/invite');
  });

  it('routes an onboarded user home when the wizard is on its final step', () => {
    onboardingState = {
      status: 'onboarded',
      role: 'parent',
      householdId: 'h1',
      membershipsError: false,
    };
    setupProgressState = {
      role: 'parent',
      path: 'create',
      currentStep: 'CALENDAR_PERMISSION',
    };

    render(<Index />);

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });
});
