/**
 * @module domains/today/__tests__/TodayScreen.coverRowsError
 *
 * False reassurance (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B):
 * `useTodayCoverRows`' loading/error state used to be invisible to the
 * header lead line — `rows` fell through to `[]` on both "still loading"
 * and "the read failed", and `resolveTodayLead` reads an empty `rows` as
 * mood `quiet`, printing "Nothing scheduled today." on a household with a
 * confirmed shift on the books, every cold start and every dropped
 * connection alike. This pins: the lead line renders ONLY once
 * `coverRows.status === 'ready'`, and an error gets a visible retry instead
 * of silence.
 *
 * Mocks follow the same template as `TodayScreen.membershipsError.test.tsx`.
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

const retryCoverRowsMock = mock(() => {});
let coverRowsStatus: 'loading' | 'error' | 'ready' = 'ready';

mock.module('@/src/domains/today/hooks/useTodayCoverRows', () => ({
  useTodayCoverRows: () => ({
    rows: [],
    isLoading: coverRowsStatus === 'loading',
    status: coverRowsStatus,
    retry: retryCoverRowsMock,
  }),
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

const HOUSEHOLD_ID = 'household-cover-rows-error-1';

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: mock(() => ({
    household: {
      id: HOUSEHOLD_ID,
      name: 'Cover Rows Household',
      timezone: 'UTC',
      week_starts_on: 1,
      state: 'live',
    },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID, name: 'Cover Rows Household' }],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
  })),
}));
mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: () => ({
    status: 'onboarded',
    role: 'parent',
    householdId: HOUSEHOLD_ID,
    isPastMember: false,
    membershipsError: false,
    retryMemberships: mock(),
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
    selector({ session: { user: { id: 'cover-rows-user-1' } } }),
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
  coverRowsStatus = 'ready';
  retryCoverRowsMock.mockClear();
});

describe('TodayScreen — a loading or failed cover-rows read never says "Nothing scheduled today"', () => {
  it('renders the lead line once cover rows are ready', () => {
    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId('today-lead')).toBeTruthy();
  });

  it('renders no lead line while cover rows are still loading', () => {
    coverRowsStatus = 'loading';
    const { queryByTestId } = render(<TodayScreen />);
    expect(queryByTestId('today-lead')).toBeNull();
  });

  it('renders no lead line, and a visible retry, when cover rows failed', () => {
    coverRowsStatus = 'error';
    const { queryByTestId, getByTestId } = render(<TodayScreen />);

    expect(queryByTestId('today-lead')).toBeNull();
    expect(getByTestId('today-cover-rows-retry')).toBeTruthy();
  });

  it('wires the retry button to coverRows.retry()', () => {
    coverRowsStatus = 'error';
    const { getByTestId } = render(<TodayScreen />);

    fireEvent.press(getByTestId('today-cover-rows-retry-button'));
    expect(retryCoverRowsMock).toHaveBeenCalledTimes(1);
  });
});
