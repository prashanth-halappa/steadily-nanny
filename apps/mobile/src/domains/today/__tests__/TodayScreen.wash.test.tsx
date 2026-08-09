/**
 * @module domains/today/__tests__/TodayScreen.wash.test
 *
 * Wave C1 — Daylight live wash. Asserts the apricot gradient mounts iff
 * `useHouseholdIsLive` is true, stays non-interactive (`pointerEvents="none"`),
 * and sits inside the screen (not the tab bar). Hooks are mocked via
 * `mock.module()` in `beforeAll` before the dynamic import, per
 * docs/09-TESTING.md / HoursScreen.test.tsx.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

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
mock.module('@/src/domains/household', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/domains/schedule', () => ({
  PendingScheduleCard: () => null,
  ThisWeeksShiftsCard: () => null,
}));
mock.module('@/src/domains/inbox', () => ({
  NeedsAttentionCard: () => null,
  useInboxItems: () => ({ items: [], isLoading: false }),
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
mock.module('@/src/domains/today/components/CoverCard', () => ({
  CoverCard: () => null,
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: () => null,
}));
mock.module('@/src/domains/today/components/NannyLiveStatusCard', () => ({
  NannyLiveStatusCard: () => null,
}));
mock.module('@/src/domains/today/components/TodayCalmCard', () => ({
  TodayCalmCard: () => null,
}));
mock.module('@/src/domains/today/hooks/useOverdueClockOut', () => ({
  useOverdueClockOut: () => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }),
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
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: mockUseChildren,
  }));

  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

beforeEach(() => {
  mockUseHouseholdIsLive.mockImplementation(() => false);
});

describe('TodayScreen — live wash (Wave C1)', () => {
  it('does not render the wash when nobody is on the clock', () => {
    mockUseHouseholdIsLive.mockImplementation(() => false);
    const { queryByTestId } = render(<TodayScreen />);
    expect(queryByTestId('today-live-wash')).toBeNull();
  });

  it('renders the wash when useHouseholdIsLive is true', () => {
    mockUseHouseholdIsLive.mockImplementation(() => true);
    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId('today-live-wash')).toBeTruthy();
  });

  it('marks the wash pointerEvents="none" so scroll content stays interactive', () => {
    mockUseHouseholdIsLive.mockImplementation(() => true);
    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId('today-live-wash').props.pointerEvents).toBe('none');
  });
});
