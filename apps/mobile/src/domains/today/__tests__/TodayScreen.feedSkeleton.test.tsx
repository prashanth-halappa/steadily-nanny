/**
 * @module domains/today/__tests__/TodayScreen.feedSkeleton.test
 *
 * P4.2 — the household resolves (wave one) before the household-scoped
 * queries that fill the feed do (wave two: children, household members).
 * Until now the feed rendered live off `data ?? []` the instant `household`
 * existed, so it looked blank — no chips, no cards — for exactly as long as
 * wave two took. This pins that a skeleton stands in for that window instead,
 * the same idea `HoursWeekSkeleton` already uses on the Hours tab.
 *
 * Hooks are mocked via `mock.module()` in `beforeAll` before the dynamic
 * import, per docs/09-TESTING.md / TodayScreen.cardOrder.test.tsx.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, within } from '@testing-library/react-native';

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

function marker(name: string) {
  const React = require('react');
  return () =>
    React.createElement('View', {
      testID: 'today-card-order-marker',
      accessibilityLabel: name,
    });
}

mock.module('@/src/domains/household', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/domains/draft', () => ({
  JoinedHouseholdCard: marker('joined-household'),
  SendMyTermsCard: marker('send-my-terms'),
  DraftHomeScreen: () => null,
}));
mock.module('@/src/domains/schedule', () => ({
  // Both no-schedule cards render null on an ordinary day; stubbed so this
  // suite's subject is the only thing under test.
  WeeklyHoursNotSetCard: () => null,
  NoWeekYetCard: () => null,
  PendingScheduleCard: marker('pending-schedule'),
  ThisWeeksShiftsCard: () => null,
}));
mock.module('@/src/domains/inbox', () => ({
  NeedsAttentionCard: marker('needs-attention'),
  TermsProposalCard: marker('terms-proposal'),
  PendingOfferCard: marker('pending-offer'),
  useInboxItems: () => ({ items: [], isLoading: false }),
}));
mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
  useUncoveredToday: () => ({ status: 'covered', localDate: '2026-03-23' }),
}));
mock.module('@/src/domains/today/hooks/useTodayCoverRows', () => ({
  useTodayCoverRows: () => ({ rows: [], isLoading: false }),
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: marker('clock-in'),
}));
mock.module('@/src/domains/today/components/ClockInBlockedCard', () => ({
  ClockInBlockedCard: marker('clock-in-blocked'),
}));
mock.module('@/src/domains/today/components/ThisWeekCard', () => ({
  ThisWeekCard: marker('this-week'),
}));
mock.module('@/src/domains/today/components/TodayCoverage', () => ({
  TodayCoverage: marker('today-coverage'),
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: marker('handoff-chips'),
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
  // `SettingsHeaderButton` in the header band reaches for the singleton.
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
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

const HOUSEHOLD_ID = 'household-feed-skeleton-1';

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: mock(() => ({
    household: {
      id: HOUSEHOLD_ID,
      name: 'Skeleton Household',
      timezone: 'UTC',
      week_starts_on: 1,
      state: 'live',
    },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID, name: 'Skeleton Household' }],
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
  }),
}));

let mockUseChildren: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;

mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: (...args: unknown[]) => mockUseChildren(...args),
}));
mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: (...args: unknown[]) => mockUseHouseholdMembers(...args),
}));
mock.module('@/src/hooks/queries/useHouseholdTimesheets', () => ({
  useHouseholdTimesheets: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: 'skeleton-user-1' } } }),
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
  mockUseChildren = mock(() => ({ data: [], isLoading: false }));
  mockUseHouseholdMembers = mock(() => ({ data: [], isLoading: false }));
});

describe('TodayScreen — feed skeleton (P4.2)', () => {
  it('shows a feed skeleton, not the blank live feed, while wave-two queries are still loading', () => {
    mockUseChildren.mockImplementation(() => ({ data: [], isLoading: true }));

    const tree = render(<TodayScreen />);

    expect(tree.queryByTestId('today-feed-skeleton')).not.toBeNull();
    // The FEED is what the skeleton stands in for. The pinned slot sits
    // outside it and keeps its occupant throughout — hers is the clock, his
    // is the coverage surface, and neither waits on wave two.
    const pinned = within(
      tree.getByTestId('today-pinned-slot')
    ).queryAllByTestId('today-card-order-marker');
    expect(tree.queryAllByTestId('today-card-order-marker')).toHaveLength(
      pinned.length
    );
  });

  it('replaces the skeleton with the real feed once wave-two queries resolve', () => {
    mockUseChildren.mockImplementation(() => ({ data: [], isLoading: false }));
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [],
      isLoading: false,
    }));

    const tree = render(<TodayScreen />);

    expect(tree.queryByTestId('today-feed-skeleton')).toBeNull();
    expect(
      tree.queryAllByTestId('today-card-order-marker').length
    ).toBeGreaterThan(0);
  });
});
