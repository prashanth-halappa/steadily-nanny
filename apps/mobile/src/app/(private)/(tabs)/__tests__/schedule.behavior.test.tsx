/**
 * @module app/(private)/(tabs)/__tests__/schedule.behavior.test
 *
 * Pattern B render test for ScheduleRoute — the role fork must not conflate
 * "role still loading" with "no membership yet" or "memberships query
 * errored": `useIsOnboarded().role` is null in all three situations, but
 * each needs its own affordance (loading spinner / empty state / error
 * state with retry). An errored memberships query reports
 * `status: 'loading'` PLUS `membershipsError: true` (see `useIsOnboarded`),
 * so the error check must be checked before, and win over, the loading
 * check — that ordering is what this file's error-state test guards. Also
 * covers the existing nanny/parent/helper forks once role is known.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

const mockRetryMemberships = mock(() => {});
const mockUseIsOnboarded = mock(
  (): {
    status: 'loading' | 'onboarded' | 'not-onboarded';
    role: 'nanny' | 'parent' | 'helper' | null;
    householdId: string | null;
    membershipsError: boolean;
    retryMemberships: () => void;
  } => ({
    status: 'loading',
    role: null,
    householdId: null,
    membershipsError: false,
    retryMemberships: mockRetryMemberships,
  })
);

mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: mockUseIsOnboarded,
}));

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
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

mock.module('@/src/components/ui/empty-state', () => {
  const React = require('react');
  return {
    EmptyState: (props: { title?: string; description?: string }) =>
      React.createElement('View', {
        testID: 'empty-state-mock',
        accessibilityLabel: `${props.title ?? ''}|${props.description ?? ''}`,
      }),
  };
});

mock.module('@/src/domains/schedule', () => {
  const React = require('react');
  return {
    SchedulePendingScreen: () =>
      React.createElement('View', { testID: 'schedule-pending-screen-mock' }),
    ScheduleShiftsScreen: ({ showBack }: { showBack?: boolean }) =>
      React.createElement('View', {
        testID: 'schedule-shifts-screen-mock',
        accessibilityLabel: showBack === false ? 'no-back' : 'with-back',
      }),
  };
});

let ScheduleRoute: typeof import('../schedule').default;

beforeAll(async () => {
  ScheduleRoute = (await import('../schedule')).default;
});

beforeEach(() => {
  mockUseIsOnboarded.mockReset();
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'loading' as const,
    role: null,
    householdId: null,
    membershipsError: false,
    retryMemberships: mockRetryMemberships,
  }));
  mockRetryMemberships.mockReset();
});

describe('ScheduleRoute — role fork (Wave A3 + role === null triage)', () => {
  it('shows loading UI while role resolution is in flight', () => {
    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-loading')).toBeTruthy();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();
    expect(queryByTestId('schedule-shifts-screen-mock')).toBeNull();
    expect(queryByTestId('empty-state-mock')).toBeNull();
    expect(queryByTestId('error-state-mock')).toBeNull();
  });

  it('shows an empty state, not a spinner, when the user genuinely has no membership', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'not-onboarded' as const,
      role: null,
      householdId: null,
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-empty')).toBeTruthy();
    expect(getByTestId('empty-state-mock')).toBeTruthy();
    expect(queryByTestId('schedule-tab-loading')).toBeNull();
    expect(queryByTestId('error-state-mock')).toBeNull();
  });

  it('shows an error state with retry when membershipsError is true, even though status reports loading (an errored memberships query reports status: "loading" — see useIsOnboarded — and must not be swallowed by the loading check)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'loading' as const,
      role: null,
      householdId: null,
      membershipsError: true,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-error')).toBeTruthy();
    expect(queryByTestId('empty-state-mock')).toBeNull();
    expect(queryByTestId('schedule-tab-loading')).toBeNull();

    fireEvent.press(getByTestId('error-state-mock'));
    expect(mockRetryMemberships).toHaveBeenCalledTimes(1);
  });

  it('routes nanny role to ScheduleShiftsScreen without back', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'nanny' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-shifts-screen-mock')).toBeTruthy();
    expect(
      getByTestId('schedule-shifts-screen-mock').props.accessibilityLabel
    ).toBe('no-back');
    expect(queryByTestId('schedule-tab-loading')).toBeNull();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();
  });

  it('routes parent role to SchedulePendingScreen', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'parent' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-pending-screen-mock')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-screen-mock')).toBeNull();
  });

  it('routes helper role to SchedulePendingScreen', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'helper' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-pending-screen-mock')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-screen-mock')).toBeNull();
  });
});
