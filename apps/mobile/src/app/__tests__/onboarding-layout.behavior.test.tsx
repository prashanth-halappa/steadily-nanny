/**
 * @module app/__tests__/onboarding-layout.behavior.test
 *
 * Render test for the onboarding stack's already-onboarded bounce
 * (`src/app/onboarding/_layout.tsx`).
 *
 * Lives here, NOT colocated next to the layout, because expo-router treats
 * any file under `src/app/` as a route (GOLDEN-FIXES.md #8).
 *
 * Locks down the gap D50 left open: Index can recover a corrected
 * `onboarded` status only while it stays mounted. Once it has replaced into
 * `/onboarding/*`, RoleScreen (and siblings) never re-check — so a nanny
 * with two active memberships stays on "Who are you?" even after
 * memberships succeed. This layout is the recovery path for that case.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

type SetupRoleValue = 'parent' | 'nanny' | 'helper';

interface OnboardingMockState {
  status: 'loading' | 'onboarded' | 'not-onboarded';
  role: SetupRoleValue | null;
  householdId: string | null;
  membershipsError: boolean;
}

let onboardingState: OnboardingMockState;
let mockReplace: ReturnType<typeof mock>;
let mockRetryMemberships: ReturnType<typeof mock>;

let OnboardingLayout: typeof import('../onboarding/_layout').default;

beforeAll(async () => {
  mockReplace = mock();
  mockRetryMemberships = mock();

  mock.module('expo-router', () => ({
    useRouter: () => ({ replace: mockReplace }),
    Stack: (props: { children?: unknown }) => {
      const React = require('react');
      return React.createElement('View', {
        testID: 'onboarding-stack-mock',
        children: props.children,
      });
    },
  }));

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      ...onboardingState,
      retryMemberships: mockRetryMemberships,
    }),
  }));

  OnboardingLayout = (await import('../onboarding/_layout')).default;
});

beforeEach(() => {
  onboardingState = {
    status: 'loading',
    role: null,
    householdId: null,
    membershipsError: false,
  };
  mockReplace.mockClear();
  mockRetryMemberships.mockClear();
});

describe('OnboardingLayout — already-onboarded bounce', () => {
  it('does not navigate while onboarding status is still loading', () => {
    const { getByTestId } = render(<OnboardingLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('onboarding-stack-mock')).toBeTruthy();
  });

  it('does not navigate for a genuine not-onboarded user', () => {
    onboardingState = {
      status: 'not-onboarded',
      role: null,
      householdId: null,
      membershipsError: false,
    };

    render(<OnboardingLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not navigate when memberships are in an unknown/error state', () => {
    // Mirror Index: unknown must fail toward WAIT, never toward ASSUME HOME
    // either — a failed query is not proof the user is onboarded.
    onboardingState = {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: true,
    };

    render(<OnboardingLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('replaces to home once status resolves to onboarded', () => {
    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };

    render(<OnboardingLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });

  it('bounces home when a loading wizard later resolves to onboarded', () => {
    // The stranded-on-role-fork repro: Index already navigated here on a
    // transient not-onboarded / cleared-cache frame; memberships then succeed.
    const { rerender } = render(<OnboardingLayout />);
    expect(mockReplace).not.toHaveBeenCalled();

    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };
    rerender(<OnboardingLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });
});
