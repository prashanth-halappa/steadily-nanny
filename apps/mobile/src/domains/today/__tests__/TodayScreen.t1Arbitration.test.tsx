/**
 * @module domains/today/__tests__/TodayScreen.t1Arbitration.test
 *
 * "One T1 per screen" (cross-agent audit finding): `ClockInCard`'s overdue
 * state and `NeedsAttentionCard` are two independent claims on the same
 * attention. An overdue clock-out corrupts the pay record while unresolved,
 * so it wins.
 *
 * It used to win by DEMOTING the loser's tone. It now wins by POSITION: the
 * clock takes the pinned slot and the inbox card drops into the feed. That is
 * a stronger guarantee — a demoted card still occupied the same pixels at the
 * top of the screen, and the slot's occupant is the only thing that cannot be
 * pushed under the fold.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
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
    LoadingIndicator: () => React.createElement('View'),
  };
});
mock.module('@/src/components/ui/empty-state', () => {
  const React = require('react');
  return { EmptyState: () => React.createElement('View') };
});
mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock() }),
}));
mock.module('@/src/domains/household', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/domains/draft', () => ({
  JoinedHouseholdCard: () => null,
  SendMyTermsCard: () => null,
}));
mock.module('@/src/domains/schedule', () => ({
  PendingScheduleCard: () => null,
  ThisWeeksShiftsCard: () => null,
}));
mock.module('@/src/domains/today/components/ClockInCard', () => {
  const React = require('react');
  return {
    ClockInCard: () => React.createElement('View', { testID: 'clock-in-spy' }),
  };
});
mock.module('@/src/domains/today/components/ThisWeekCard', () => ({
  ThisWeekCard: () => null,
}));
mock.module('@/src/domains/today/components/TodayCoverage', () => ({
  TodayCoverage: () => null,
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: () => null,
}));
mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
  useHouseholdIsLive: () => false,
}));
// Feeds the hero illustration only; this file renders without a QueryClient
// and is about overdue-vs-inbox precedence.
mock.module('@/src/domains/today/hooks/useTodayCoverRows', () => ({
  useTodayCoverRows: () => ({ rows: [], isLoading: false }),
}));

const HOUSEHOLD_ID = 'household-t1-1';
const SLOT = 'today-pinned-slot';
let mockUseOverdueClockOut: ReturnType<typeof mock>;

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;

beforeAll(async () => {
  mockUseOverdueClockOut = mock(() => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }));
  mock.module('@/src/domains/today/hooks/useOverdueClockOut', () => ({
    useOverdueClockOut: mockUseOverdueClockOut,
  }));

  mock.module('@/src/domains/inbox', () => {
    const React = require('react');
    return {
      NeedsAttentionCard: () =>
        React.createElement('View', { testID: 'needs-attention-spy' }),
      TermsProposalCard: () => null,
      // Non-empty: this file is specifically about overdue-vs-inbox
      // precedence, so there has to be an inbox item for "not overdue" to
      // mean "inbox owns it" rather than "nothing owns it".
      useInboxItems: () => ({
        items: [{ kind: 'change_request' }],
        isLoading: false,
      }),
    };
  });
  mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
    useUncoveredToday: () => ({ status: 'covered', localDate: '2026-03-23' }),
  }));

  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'T1 Household',
        timezone: 'UTC',
        week_starts_on: 1,
      },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID, name: 'T1 Household', timezone: 'UTC' }],
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
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: 't1-user-1' } } }),
  }));
  mock.module('@/src/store/todayCardDismissalStore', () => ({
    useTodayCardDismissalStore: (
      selector: (s: {
        isDismissed: () => boolean;
        dismiss: () => void;
      }) => unknown
    ) => selector({ isDismissed: () => false, dismiss: () => {} }),
  }));

  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

describe('TodayScreen — one slot occupant (overdue clock-out vs inbox)', () => {
  it('pins the inbox card when nothing is overdue', () => {
    mockUseOverdueClockOut.mockReturnValue({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    });

    const { getByTestId } = render(<TodayScreen />);
    const slot = within(getByTestId(SLOT));

    expect(slot.getByTestId('needs-attention-spy')).toBeTruthy();
    expect(slot.queryByTestId('clock-in-spy')).toBeNull();
  });

  it('puts the inbox card OUTSIDE the slot when the clock-out is overdue — the overdue clock wins', () => {
    mockUseOverdueClockOut.mockReturnValue({
      overdue: true,
      clockInAt: '2026-08-06T08:00:00.000Z',
      shiftEndsAt: null,
    });

    const tree = render(<TodayScreen />);
    const slot = within(tree.getByTestId(SLOT));

    expect(slot.getByTestId('clock-in-spy')).toBeTruthy();
    expect(slot.queryByTestId('needs-attention-spy')).toBeNull();
    // It is still on screen, just in the feed at default tone — the
    // obligation does not disappear because something outranked it.
    expect(tree.getByTestId('needs-attention-spy')).toBeTruthy();
  });
});
