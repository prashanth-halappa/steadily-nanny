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
 *
 * Also locks the paint gate: Stack (and therefore RoleScreen) must only
 * mount for a confirmed `not-onboarded` verdict — loading / onboarded show
 * a spinner so a transient mis-route never flashes "Who are you?".
 *
 * WS-F addition: the server `onboarded` predicate now flips true partway
 * through the wizard (first child added, or an invite redeemed) — well
 * before the wizard's true last step (calendar permission / notifications
 * for a helper). Once the local step machine has engaged
 * (`setupProgress.role` set), this layout must NOT auto-bounce — the
 * terminal screen's own CTA owns completion instead. See this file's
 * "wizard actively engaged" describe block below.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { useSetupProgressStore } from '@/src/store/setupProgress';

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

  mock.module('@/src/components/ui/loading-indicator', () => {
    const React = require('react');
    return {
      LoadingIndicator: () =>
        React.createElement('View', { testID: 'loading-indicator-mock' }),
    };
  });

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
  useSetupProgressStore.getState().reset();
});

describe('OnboardingLayout — already-onboarded bounce', () => {
  it('shows a spinner and does not mount the wizard while loading', () => {
    const { getByTestId, queryByTestId } = render(<OnboardingLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('onboarding-layout-loading')).toBeTruthy();
    expect(getByTestId('loading-indicator-mock')).toBeTruthy();
    expect(queryByTestId('onboarding-stack-mock')).toBeNull();
  });

  it('mounts the wizard Stack for a genuine not-onboarded user', () => {
    onboardingState = {
      status: 'not-onboarded',
      role: null,
      householdId: null,
      membershipsError: false,
    };

    const { getByTestId, queryByTestId } = render(<OnboardingLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('onboarding-stack-mock')).toBeTruthy();
    expect(queryByTestId('onboarding-layout-loading')).toBeNull();
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

    const { getByTestId, queryByTestId } = render(<OnboardingLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('onboarding-layout-loading')).toBeTruthy();
    expect(queryByTestId('onboarding-stack-mock')).toBeNull();
  });

  it('replaces to home and keeps the wizard unmounted once onboarded', () => {
    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };

    const { getByTestId, queryByTestId } = render(<OnboardingLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
    expect(getByTestId('onboarding-layout-loading')).toBeTruthy();
    expect(queryByTestId('onboarding-stack-mock')).toBeNull();
  });

  it('bounces home when a loading wizard later resolves to onboarded', () => {
    // The stranded-on-role-fork repro: Index already navigated here on a
    // transient not-onboarded / cleared-cache frame; memberships then succeed.
    const { rerender, getByTestId, queryByTestId } = render(
      <OnboardingLayout />
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('onboarding-layout-loading')).toBeTruthy();

    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };
    rerender(<OnboardingLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
    expect(queryByTestId('onboarding-stack-mock')).toBeNull();
  });
});

describe('OnboardingLayout — wizard actively engaged (WS-F)', () => {
  it('keeps the wizard mounted and does NOT auto-bounce once onboarded early, while the local step machine has engaged', () => {
    // Mirrors reality: a parent picks a role (setupProgress.role set),
    // then adds their first child — the server predicate flips to
    // `onboarded` right there, well before Invite/Notifications/Calendar.
    useSetupProgressStore.getState().setRole('parent');
    onboardingState = {
      status: 'onboarded',
      role: 'parent',
      householdId: 'h1',
      membershipsError: false,
    };

    const { getByTestId, queryByTestId } = render(<OnboardingLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('onboarding-stack-mock')).toBeTruthy();
    expect(queryByTestId('onboarding-layout-loading')).toBeNull();
  });

  it('still bounces home once onboarded if the local wizard was never engaged this session', () => {
    // role stays null (reset in beforeEach) — the original stranded-user
    // repro must keep working.
    onboardingState = {
      status: 'onboarded',
      role: 'nanny',
      householdId: 'h1',
      membershipsError: false,
    };

    const { queryByTestId } = render(<OnboardingLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
    expect(queryByTestId('onboarding-stack-mock')).toBeNull();
  });
});

describe('OnboardingLayout — mid-wizard loading latch (R7)', () => {
  it('keeps the Stack mounted across a transient loading frame after the wizard has painted', () => {
    // THE BUG: after household/children resolve, useIsOnboarded returns
    // `loading` for a frame (needsChildCount && children.isPending). That
    // must not unmount the Stack and wipe typed names/ages.
    useSetupProgressStore.getState().setRole('parent');
    onboardingState = {
      status: 'not-onboarded',
      role: 'parent',
      householdId: 'h1',
      membershipsError: false,
    };

    const { rerender, getByTestId, queryByTestId } = render(
      <OnboardingLayout />
    );
    expect(getByTestId('onboarding-stack-mock')).toBeTruthy();

    onboardingState = {
      status: 'loading',
      role: 'parent',
      householdId: 'h1',
      membershipsError: false,
    };
    rerender(<OnboardingLayout />);

    expect(getByTestId('onboarding-stack-mock')).toBeTruthy();
    expect(queryByTestId('onboarding-layout-loading')).toBeNull();
  });

  it('does not paint the wizard on cold start with stale persisted role while loading', () => {
    // Latch must be mount-scoped — NOT keyed off wizardEngaged. A cold
    // start with persisted role would otherwise flash "Who are you?".
    useSetupProgressStore.getState().setRole('parent');
    onboardingState = {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: false,
    };

    const { getByTestId, queryByTestId } = render(<OnboardingLayout />);

    expect(getByTestId('onboarding-layout-loading')).toBeTruthy();
    expect(queryByTestId('onboarding-stack-mock')).toBeNull();
  });

  it('drops the Stack when membershipsError arrives during loading after the wizard painted', () => {
    useSetupProgressStore.getState().setRole('parent');
    onboardingState = {
      status: 'not-onboarded',
      role: 'parent',
      householdId: 'h1',
      membershipsError: false,
    };

    const { rerender, getByTestId, queryByTestId } = render(
      <OnboardingLayout />
    );
    expect(getByTestId('onboarding-stack-mock')).toBeTruthy();

    onboardingState = {
      status: 'loading',
      role: 'parent',
      householdId: 'h1',
      membershipsError: true,
    };
    rerender(<OnboardingLayout />);

    expect(getByTestId('onboarding-layout-loading')).toBeTruthy();
    expect(queryByTestId('onboarding-stack-mock')).toBeNull();
  });
});
