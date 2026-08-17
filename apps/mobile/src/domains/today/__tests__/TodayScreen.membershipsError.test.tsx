/**
 * @module domains/today/__tests__/TodayScreen.membershipsError.test
 *
 * C1 (D-B1, docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C) — the one screen that
 * used to have no `membershipsError` branch. On a failed memberships read
 * `useIsOnboarded` reports `role: null`, so `activeNanny` was false and the
 * clock-in card silently rendered as `null` — no error, no retry, the rest
 * of the feed rendering normally around the one missing thing she needed.
 * This pins the fix: an `ErrorState` with a working retry, in place of the
 * ordinary slot+feed body, mirroring `schedule.tsx`'s own branch.
 *
 * Hooks are mocked via `mock.module()` in `beforeAll`, before the dynamic
 * import — same template as `TodayScreen.feedSkeleton.test.tsx`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

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
  return {
    EmptyState: () =>
      React.createElement('View', { testID: 'empty-state-stub' }),
  };
});

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
  useInboxItems: () => ({ items: [], isLoading: false }),
}));
mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
  useUncoveredToday: () => ({ status: 'covered', localDate: '2026-03-23' }),
}));
mock.module('@/src/domains/today/hooks/useTodayCoverRows', () => ({
  useTodayCoverRows: () => ({ rows: [], isLoading: false }),
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: () => null,
}));
mock.module('@/src/domains/today/components/ClockInBlockedCard', () => ({
  ClockInBlockedCard: () => null,
}));
mock.module('@/src/domains/today/components/ThisWeekCard', () => ({
  ThisWeekCard: () => null,
}));
mock.module('@/src/domains/today/components/TodayCoverage', () => ({
  TodayCoverage: () => null,
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: () => null,
}));
mock.module(
  '@/src/domains/today/components/EmergencyContactPromptCard',
  () => ({
    EmergencyContactPromptCard: () => null,
  })
);
mock.module('@/src/domains/today/components/CrossFamilyStrip', () => ({
  CrossFamilyStrip: () => null,
}));
mock.module('@/src/domains/today/components/InviteWaitingCard', () => ({
  InviteWaitingCard: () => null,
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
mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock() }),
}));
mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
  useHouseholdIsLive: mock(() => false),
}));
mock.module('@/src/domains/today/hooks/useOverdueClockOut', () => ({
  useOverdueClockOut: () => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }),
}));
mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
  useTermsGate: () => ({ status: 'open', proposal: null, familyName: 'F' }),
}));
mock.module('@/src/domains/inbox/hooks/usePendingOffer', () => ({
  usePendingOffer: () => ({
    offer: null,
    state: null,
    scheduledMinutesToday: 0,
    isBlocking: false,
    timeZone: 'UTC',
  }),
}));

const HOUSEHOLD_ID = 'household-memberships-error-1';

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: mock(() => ({
    household: {
      id: HOUSEHOLD_ID,
      name: 'Error Household',
      timezone: 'UTC',
      week_starts_on: 1,
      state: 'live',
    },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID, name: 'Error Household' }],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
  })),
}));

const retryMembershipsMock = mock(() => {});
let onboardingMembershipsError = true;

mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: () => ({
    status: 'loading',
    role: null,
    householdId: HOUSEHOLD_ID,
    isPastMember: false,
    membershipsError: onboardingMembershipsError,
    retryMemberships: retryMembershipsMock,
  }),
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
    selector({ session: { user: { id: 'error-user-1' } } }),
}));
mock.module('@/src/store/todayCardDismissalStore', () => ({
  useTodayCardDismissalStore: (
    selector: (s: {
      isDismissed: () => boolean;
      dismiss: () => void;
    }) => unknown
  ) => selector({ isDismissed: () => false, dismiss: () => {} }),
}));

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;

beforeAll(async () => {
  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

beforeEach(() => {
  onboardingMembershipsError = true;
  retryMembershipsMock.mockClear();
});

describe('TodayScreen — membershipsError (C1)', () => {
  it('renders an ErrorState with a working retry instead of the ordinary feed', () => {
    const { getByTestId, queryByTestId } = render(<TodayScreen />);

    expect(getByTestId('today-tab-error')).toBeTruthy();
    expect(getByTestId('error-state')).toBeTruthy();
    // The ordinary body — and specifically the clock-in slot — never mounts,
    // rather than silently rendering null underneath a normal-looking feed.
    expect(queryByTestId('today-live-wash')).toBeNull();
  });

  it('calls retryMemberships when the retry button is pressed', () => {
    const { getByText } = render(<TodayScreen />);

    fireEvent.press(getByText('tryAgain'));
    expect(retryMembershipsMock).toHaveBeenCalledTimes(1);
  });

  it('renders the ordinary feed once memberships resolve', () => {
    onboardingMembershipsError = false;
    const { queryByTestId, getByTestId } = render(<TodayScreen />);

    expect(queryByTestId('today-tab-error')).toBeNull();
    expect(getByTestId('today-live-wash')).toBeTruthy();
  });
});
