/**
 * @module domains/today/__tests__/TodayScreen.draft.test
 *
 * §S6 item 4 / D-36. `(tabs)/_layout.tsx` no longer redirects a draft
 * household out of the tab shell (`_layout.test.ts` pins that). Instead
 * `TodayScreen` renders `DraftHomeScreen` — self-contained, no props — as
 * its whole body when the active household is a draft, and renders the
 * ordinary slot+feed body otherwise. One early return, after every hook this
 * screen already calls (rules-of-hooks: the branch must not skip a hook).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
// `renderWithProviders`, not bare `render`: since the terms gate landed this
// screen's graph reaches hooks that need a QueryClient.
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
  return {
    EmptyState: () =>
      React.createElement('View', { testID: 'empty-state-stub' }),
  };
});
mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock() }),
}));
mock.module('@/src/domains/household', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/domains/draft', () => {
  const React = require('react');
  return {
    JoinedHouseholdCard: () => null,
    SendMyTermsCard: () => null,
    DraftHomeScreen: () =>
      React.createElement('View', { testID: 'draft-home-screen-stub' }),
  };
});
mock.module('@/src/domains/schedule', () => ({
  // Both no-schedule cards render null on an ordinary day; stubbed so this
  // suite's subject is the only thing under test.
  WeeklyHoursNotSetCard: () => null,
  NoWeekYetCard: () => null,
  PendingScheduleCard: () => null,
  ThisWeeksShiftsCard: () => null,
}));
mock.module('@/src/domains/inbox', () => ({
  NeedsAttentionCard: () => null,
  TermsProposalCard: () => null,
  // A1's parent-side card. A barrel mock must export everything the screen
  // imports from it, or the module fails to LOAD rather than failing an
  // assertion — which reads like a draft bug and is not one.
  PendingOfferCard: () => null,
  usePendingOffer: () => ({ item: null, state: null }),
  useInboxItems: () => ({ items: [], isLoading: false }),
}));
mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
  // A1's gate, open — this file is about the draft branch, and the real hook
  // needs a QueryClient this file deliberately does not build.
  useTermsGate: () => ({ status: 'open', proposal: null, familyName: '' }),
}));
mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
  useUncoveredToday: () => ({ status: 'covered', localDate: '2026-03-23' }),
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

const HOUSEHOLD_ID = 'household-draft-1';
let householdState: 'draft' | 'live' = 'draft';

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;

beforeAll(async () => {
  mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
    useHouseholdIsLive: () => false,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'Draft Household',
        timezone: 'UTC',
        week_starts_on: 1,
        state: householdState,
      },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID, name: 'Draft Household' }],
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      status: 'onboarded',
      role: 'nanny',
      householdId: HOUSEHOLD_ID,
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
      selector({ session: { user: { id: 'draft-user-1' } } }),
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

  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

beforeEach(() => {
  householdState = 'draft';
});

describe('TodayScreen — draft shell (D-36)', () => {
  it('renders DraftHomeScreen as its whole body when the active household is a draft', () => {
    householdState = 'draft';
    const { getByTestId, queryByTestId } = renderWithProviders(<TodayScreen />);
    expect(getByTestId('draft-home-screen-stub')).toBeTruthy();
    expect(queryByTestId('today-live-wash')).toBeNull();
  });

  it('renders the ordinary slot + feed body when the active household is live', () => {
    householdState = 'live';
    const { getByTestId, queryByTestId } = renderWithProviders(<TodayScreen />);
    expect(getByTestId('today-live-wash')).toBeTruthy();
    expect(queryByTestId('draft-home-screen-stub')).toBeNull();
  });
});
