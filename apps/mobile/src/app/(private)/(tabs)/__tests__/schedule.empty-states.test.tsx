/**
 * @module app/(private)/(tabs)/__tests__/schedule.empty-states.test
 *
 * §A empty states — Schedule tab no-role and draft branches must render the
 * full inline EmptyState chrome (illustration, title, body, action) and route
 * honestly to join-household / Today draft home respectively.
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
    status: 'not-onboarded',
    role: null,
    householdId: null,
    membershipsError: false,
    retryMemberships: mockRetryMemberships,
  })
);

const mockUseActiveHousehold = mock(
  (): { household: { state: 'draft' | 'live' } | null } => ({
    household: null,
  })
);

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: mockUseActiveHousehold,
}));

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
    ErrorState: () =>
      React.createElement('View', { testID: 'error-state-mock' }),
  };
});

mock.module('@/src/components/ui/empty-state', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    EmptyState: (props: {
      title?: string;
      description?: string;
      image?: unknown;
      actionLabel?: string;
      action?: () => void;
    }) =>
      React.createElement(
        View,
        { testID: 'empty-state-mock' },
        props.image
          ? React.createElement(View, { testID: 'empty-state-image' })
          : null,
        props.title
          ? React.createElement(
              Text,
              { testID: 'empty-state-title' },
              props.title
            )
          : null,
        props.description
          ? React.createElement(
              Text,
              { testID: 'empty-state-description' },
              props.description
            )
          : null,
        props.action && props.actionLabel
          ? React.createElement(
              Pressable,
              {
                testID: 'empty-state-action',
                accessibilityLabel: props.actionLabel,
                onPress: props.action,
              },
              React.createElement(Text, null, props.actionLabel)
            )
          : null
      ),
  };
});

mock.module('@/src/domains/schedule', () => {
  const React = require('react');
  return {
    ScheduleShiftsScreen: () =>
      React.createElement('View', { testID: 'schedule-shifts-screen-mock' }),
    SchedulePatternBanner: () => null,
  };
});

mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
  useSchedulePatterns: () => ({ data: undefined }),
}));

const mockPush = mock(() => {});

mock.module('expo-router', () => ({
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  useRouter: () => ({ push: mockPush }),
}));

let ScheduleRoute: typeof import('../schedule').default;

beforeAll(async () => {
  ScheduleRoute = (await import('../schedule')).default;
});

beforeEach(() => {
  mockPush.mockReset();
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'not-onboarded' as const,
    role: null,
    householdId: null,
    membershipsError: false,
    retryMemberships: mockRetryMemberships,
  }));
  mockUseActiveHousehold.mockImplementation(() => ({ household: null }));
});

describe('ScheduleRoute — no-role empty state (§A)', () => {
  it('renders illustration, title, body, and join action; action routes to join-household', () => {
    const { getByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-empty')).toBeTruthy();
    expect(getByTestId('empty-state-image')).toBeTruthy();
    expect(getByTestId('empty-state-title').props.children).toBe(
      'tab.emptyTitle'
    );
    expect(getByTestId('empty-state-description').props.children).toBe(
      'tab.emptyDescription'
    );
    expect(getByTestId('empty-state-action').props.accessibilityLabel).toBe(
      'tab.emptyActionLabel'
    );

    fireEvent.press(getByTestId('empty-state-action'));
    expect(mockPush).toHaveBeenCalledWith('/(private)/settings/join-household');
  });
});

describe('ScheduleRoute — draft empty state (§A)', () => {
  beforeEach(() => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'nanny' as const,
      householdId: 'draft-1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseActiveHousehold.mockImplementation(() => ({
      household: { state: 'draft' as const },
    }));
  });

  it('renders illustration, title, body, and draft action; action routes to Today home', () => {
    const { getByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-draft-empty')).toBeTruthy();
    expect(getByTestId('empty-state-image')).toBeTruthy();
    expect(getByTestId('empty-state-title').props.children).toBe(
      'tab.draftEmptyTitle'
    );
    expect(getByTestId('empty-state-description').props.children).toBe(
      'tab.draftEmptyDescription'
    );
    expect(getByTestId('empty-state-action').props.accessibilityLabel).toBe(
      'tab.draftEmptyActionLabel'
    );

    fireEvent.press(getByTestId('empty-state-action'));
    expect(mockPush).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });
});
