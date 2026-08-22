/**
 * @module domains/today/__tests__/TodayScreen.wash.test
 *
 * Daylight v2 §4.3 — the screen wash is now ALWAYS mounted and only changes
 * register: plum brand by default, apricot while someone is on the clock. The
 * v1 behaviour it replaces (mount iff live) left every screen flat warm grey
 * for the other sixteen hours of the day, so "absent when not live" is exactly
 * the regression this file now guards against rather than pins.
 *
 * The three claims: it is always there, its colours swap with liveness (and
 * the live stops are byte-identical to v1's — the live signature does not
 * change), and it never eats a touch. Hooks are mocked via `mock.module()` in
 * `beforeAll` before the dynamic import, per docs/09-TESTING.md.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { screenWash } from '@/lib/design-tokens';

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

// EmptyState / LoadingIndicator pull splash assets and sheets — stub markers.
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

// Keep the tree light — wash wiring is the only subject under test.
mock.module('expo-router', () => ({
  // `SettingsHeaderButton` in the header band reaches for the singleton.
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  useRouter: () => ({ push: mock(), back: mock() }),
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
  PendingOfferCard: () => null,
  useInboxItems: () => ({ items: [], isLoading: false }),
}));
mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
  useUncoveredToday: () => ({ status: 'covered', localDate: '2026-03-23' }),
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: () => null,
}));
mock.module('@/src/domains/today/components/TodayCoverage', () => ({
  TodayCoverage: () => null,
}));
mock.module('@/src/domains/today/components/ThisWeekCard', () => ({
  ThisWeekCard: () => null,
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: () => null,
}));
// P5/S10 — self-contained, unscoped; real hooks need a QueryClient this file
// deliberately does not build.
mock.module('@/src/domains/today/components/CrossFamilyStrip', () => ({
  CrossFamilyStrip: () => null,
}));
mock.module(
  '@/src/domains/today/components/EmergencyContactPromptCard',
  () => ({
    EmergencyContactPromptCard: () => null,
  })
);
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
mock.module('@/src/domains/inbox/hooks/usePendingOffer', () => ({
  // A7's offer, absent — this file is about the live wash, and the real hook
  // needs a QueryClient this file deliberately does not build.
  usePendingOffer: () => ({
    offer: null,
    state: null,
    scheduledMinutesToday: 0,
    isBlocking: false,
    timeZone: 'UTC',
  }),
}));
mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
  // A1's gate, open — this file is about a different arbitration, and the
  // real hook needs a QueryClient this file deliberately does not build.
  useTermsGate: () => ({ status: 'open', proposal: null, familyName: '' }),
}));
mock.module('@/src/domains/today/hooks/useOverdueClockOut', () => ({
  useOverdueClockOut: () => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }),
}));
// The hero illustration reads these rows; this file renders without a
// QueryClient, and the wash is the only subject under test.
mock.module('@/src/domains/today/hooks/useTodayCoverRows', () => ({
  useTodayCoverRows: () => ({ rows: [], isLoading: false }),
}));

const HOUSEHOLD_ID = 'household-wash-1';

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;
let mockUseHouseholdIsLive: ReturnType<typeof mock>;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseChildren: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseHouseholdIsLive = mock(() => false);
  mockUseActiveHousehold = mock(() => ({
    household: {
      id: HOUSEHOLD_ID,
      name: 'Wash Household',
      timezone: 'UTC',
      week_starts_on: 1,
    },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID, name: 'Wash Household', timezone: 'UTC' }],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
  }));
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseChildren = mock(() => ({ data: [], isLoading: false }));

  mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
    useHouseholdIsLive: mockUseHouseholdIsLive,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useRecentDepartures', () => ({
    useRecentDepartures: () => ({
      data: [],
      isSuccess: true,
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: mockUseChildren,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mock(() => ({ data: [], isLoading: false })),
  }));
  mock.module('@/src/hooks/queries/useHouseholdTimesheets', () => ({
    useHouseholdTimesheets: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: 'wash-user-1' } } }),
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
  mockUseHouseholdIsLive.mockImplementation(() => false);
});

const BRAND_WASH = screenWash(false, 'brand');
const LIVE_WASH = screenWash(false, 'live');

describe('TodayScreen — screen wash (Daylight v2)', () => {
  it('is mounted on an ordinary, nobody-on-the-clock day', () => {
    mockUseHouseholdIsLive.mockImplementation(() => false);
    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId('today-live-wash')).toBeTruthy();
  });

  it('wears the brand register when nobody is on the clock', () => {
    mockUseHouseholdIsLive.mockImplementation(() => false);
    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId('today-live-wash').props.colors).toEqual(
      BRAND_WASH.colors
    );
  });

  it('swaps to the apricot live register when useHouseholdIsLive is true', () => {
    mockUseHouseholdIsLive.mockImplementation(() => true);
    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId('today-live-wash').props.colors).toEqual(
      LIVE_WASH.colors
    );
  });

  it('the two registers are genuinely different colours, not one alias', () => {
    expect(BRAND_WASH.colors).not.toEqual(LIVE_WASH.colors);
  });

  it('marks the wash pointerEvents="none" in both registers', () => {
    for (const live of [false, true]) {
      mockUseHouseholdIsLive.mockImplementation(() => live);
      const { getByTestId } = render(<TodayScreen />);
      expect(getByTestId('today-live-wash').props.pointerEvents).toBe('none');
    }
  });
});
