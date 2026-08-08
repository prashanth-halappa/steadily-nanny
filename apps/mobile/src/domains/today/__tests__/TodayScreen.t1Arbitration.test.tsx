/**
 * @module domains/today/__tests__/TodayScreen.t1Arbitration.test
 *
 * "One T1 per screen" (cross-agent audit finding): `ClockInCard`'s overdue
 * state and `NeedsAttentionCard` are two independent `tone="attention"`
 * triggers. An overdue clock-out corrupts the pay record while unresolved,
 * so it wins — `TodayScreen` demotes `NeedsAttentionCard` to default tone
 * whenever `useOverdueClockOut` says the current user's own clock-out is
 * overdue, reusing that single hook rather than a second overdue rule.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
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
mock.module('@/src/domains/household', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/domains/schedule', () => ({
  PendingScheduleCard: () => null,
  ThisWeeksShiftsCard: () => null,
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: () => null,
}));
mock.module('@/src/domains/today/components/AddMissedHoursCard', () => ({
  AddMissedHoursCard: () => null,
}));
mock.module('@/src/domains/today/components/CoverageGapBanner', () => ({
  CoverageGapBanner: () => null,
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
mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
  useHouseholdIsLive: () => false,
}));

const HOUSEHOLD_ID = 'household-t1-1';
let mockUseOverdueClockOut: ReturnType<typeof mock>;
let NeedsAttentionCardSpy: ReturnType<typeof mock>;

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

  NeedsAttentionCardSpy = mock((_props: { demoted?: boolean }) => {
    const React = require('react');
    return React.createElement('View', { testID: 'needs-attention-spy' });
  });
  mock.module('@/src/domains/inbox', () => ({
    NeedsAttentionCard: NeedsAttentionCardSpy,
    // Non-empty: this file is specifically about overdue-vs-inbox
    // precedence, so there has to be an inbox item for "not overdue" to
    // mean "inbox owns it" rather than "nothing owns it".
    useInboxItems: () => ({
      items: [{ kind: 'change_request' }],
      isLoading: false,
    }),
  }));
  mock.module('@/src/domains/today/hooks/useTodayCoverageGaps', () => ({
    useTodayCoverageGaps: () => ({ gaps: [] }),
  }));

  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: { id: HOUSEHOLD_ID, name: 'T1 Household', timezone: 'UTC' },
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

  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

describe('TodayScreen — one T1 per screen (overdue clock-out vs inbox)', () => {
  it('does not demote NeedsAttentionCard when nothing is overdue', () => {
    mockUseOverdueClockOut.mockReturnValue({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    });

    render(<TodayScreen />);

    const props = NeedsAttentionCardSpy.mock.calls[0]?.[0] as {
      demoted?: boolean;
    };
    expect(props.demoted).toBeFalsy();
  });

  it('demotes NeedsAttentionCard when the clock-out is overdue — the overdue clock wins', () => {
    mockUseOverdueClockOut.mockReturnValue({
      overdue: true,
      clockInAt: '2026-08-06T08:00:00.000Z',
      shiftEndsAt: null,
    });

    render(<TodayScreen />);

    const lastCall = NeedsAttentionCardSpy.mock.calls[
      NeedsAttentionCardSpy.mock.calls.length - 1
    ]?.[0] as { demoted?: boolean };
    expect(lastCall.demoted).toBe(true);
  });
});
