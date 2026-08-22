/**
 * @module domains/today/__tests__/TodayScreen.empty.test
 *
 * §A empty state — Today tab with no household must render the full inline
 * EmptyState chrome and route honestly to join-household.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
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

const mockPush = mock(() => {});

mock.module('expo-router', () => ({
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  useRouter: () => ({ push: mockPush }),
}));
mock.module('@/src/domains/household', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/domains/draft', () => ({
  JoinedHouseholdCard: () => null,
  SendMyTermsCard: () => null,
  DraftHomeScreen: () => null,
}));
mock.module('@/src/domains/schedule', () => ({
  WeeklyHoursNotSetCard: () => null,
  NoWeekYetCard: () => null,
  PendingScheduleCard: () => null,
  ThisWeeksShiftsCard: () => null,
}));
mock.module('@/src/domains/inbox', () => ({
  NeedsAttentionCard: () => null,
  TermsProposalCard: () => null,
  PendingOfferCard: () => null,
  usePendingOffer: () => ({ item: null, state: null }),
  useInboxItems: () => ({ items: [], isLoading: false }),
}));
mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
  useTermsGate: () => ({ status: 'open', proposal: null, familyName: '' }),
}));
mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
  useUncoveredToday: () => ({ status: 'covered', localDate: '2026-03-23' }),
}));
mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
  useHouseholdIsLive: () => false,
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: () => null,
}));
mock.module('@/src/domains/today/components/AddMissedHoursCard', () => ({
  AddMissedHoursCard: () => null,
}));
mock.module('@/src/domains/today/components/TodayCoverage', () => ({
  TodayCoverage: () => null,
}));
mock.module('@/src/domains/today/components/NannyWeekLine', () => ({
  NannyWeekLine: () => null,
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: () => null,
}));
mock.module('@/src/domains/today/components/NannyJoinedMomentCard', () => ({
  NannyJoinedMomentCard: () => null,
}));
mock.module('@/src/domains/today/components/FirstClockInMomentCard', () => ({
  FirstClockInMomentCard: () => null,
}));
mock.module(
  '@/src/domains/today/components/FirstWeekApprovedMomentCard',
  () => ({
    FirstWeekApprovedMomentCard: () => null,
  })
);
mock.module('@/src/domains/today/hooks/useOverdueClockOut', () => ({
  useOverdueClockOut: () => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }),
}));
mock.module('@/src/domains/today/hooks/useTodayCoverRows', () => ({
  useTodayCoverRows: () => ({ rows: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: null,
    householdId: null,
    households: [],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
  }),
}));
mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: () => ({
    status: 'not-onboarded',
    role: null,
    householdId: null,
  }),
}));
mock.module('@/src/hooks/queries/useRecentDepartures', () => ({
  useRecentDepartures: () => ({ data: [], isSuccess: true, isLoading: false }),
}));
mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useHouseholdTimesheets', () => ({
  useHouseholdTimesheets: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: 'user-1' } } }),
}));
mock.module('@/src/store/todayCardDismissalStore', () => ({
  useTodayCardDismissalStore: (
    selector: (s: {
      isDismissed: () => boolean;
      dismiss: () => void;
    }) => unknown
  ) => selector({ isDismissed: () => false, dismiss: () => {} }),
  useCardDismissal: () => ({ isDismissed: () => false, dismiss: () => {} }),
}));

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;

beforeAll(async () => {
  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

beforeEach(() => {
  mockPush.mockReset();
});

describe('TodayScreen — no-household empty state (§A)', () => {
  it('renders illustration, title, body, and join action; action routes to join-household', () => {
    const { getByTestId } = renderWithProviders(<TodayScreen />);

    expect(getByTestId('today-empty')).toBeTruthy();
    expect(getByTestId('empty-state-image')).toBeTruthy();
    expect(getByTestId('empty-state-title').props.children).toBe('emptyTitle');
    expect(getByTestId('empty-state-description').props.children).toBe(
      'emptyDescription'
    );
    expect(getByTestId('empty-state-action').props.accessibilityLabel).toBe(
      'emptyActionLabel'
    );

    fireEvent.press(getByTestId('empty-state-action'));
    expect(mockPush).toHaveBeenCalledWith('/(private)/settings/join-household');
  });
});
