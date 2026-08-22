/**
 * @module domains/today/__tests__/TodayScreen.departures.test
 *
 * Parent-side departure cards in the FEED (never the pinned slot — a
 * parent's slot is effectively always today's coverage). This file copies the
 * `TodayScreen.moments.test.tsx` harness and stubs `MemberLeftCard` as an
 * order marker, so the three gates are observable without rendering the card.
 *
 * The gates, and why each one is here:
 *  - `ended_at` inside 7 days, mirroring `JOINED_CARD_MAX_AGE_MS`. Without it
 *    the dismissal store — empty on every install — makes a departure from
 *    last spring news on a fresh device.
 *  - `ended_by !== me`. The person who acted is never told about their own
 *    action; a parent who removed a nanny thirty seconds ago does not need
 *    the app to report it back to them.
 *  - the query has SETTLED. A card rendered off `data ?? []` while the read
 *    is in flight is a card whose dismissal key can be burnt before the
 *    answer arrives.
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

const ORDER_MARKER = 'today-card-order-marker';
const SLOT = 'today-pinned-slot';
function marker(name: string) {
  const React = require('react');
  return () =>
    React.createElement('View', {
      testID: ORDER_MARKER,
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
mock.module('@/src/domains/today/components/TodayCoverage', () => {
  const React = require('react');
  return {
    TodayCoverage: ({ footer }: { footer?: unknown }) =>
      React.createElement(
        'View',
        { testID: ORDER_MARKER, accessibilityLabel: 'today-coverage' },
        footer
      ),
  };
});
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
  NannyJoinedMomentCard: marker('nanny-joined'),
}));
mock.module('@/src/domains/today/components/FirstClockInMomentCard', () => ({
  FirstClockInMomentCard: marker('first-clock-in'),
}));
mock.module(
  '@/src/domains/today/components/FirstWeekApprovedMomentCard',
  () => ({
    FirstWeekApprovedMomentCard: marker('first-week-approved'),
  })
);
mock.module('@/src/domains/today/components/WeekApprovedCard', () => ({
  WeekApprovedCard: marker('week-approved'),
}));
mock.module('@/src/domains/today/components/MemberLeftCard', () => {
  const React = require('react');
  return {
    MemberLeftCard: ({ name }: { name: string }) =>
      React.createElement('View', {
        testID: ORDER_MARKER,
        accessibilityLabel: `member-left:${name}`,
      }),
  };
});

const HOUSEHOLD_ID = 'household-departures-1';
const VIEWER_ID = 'parent-user-1';
const OTHER_PARENT_ID = 'parent-user-2';
const DEPARTED_ID = 'nanny-user-9';

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;

function departure(
  daysAgo: number | null,
  opts: { endedBy?: string | null; userId?: string; name?: string } = {}
) {
  return {
    id: `member-${opts.userId ?? DEPARTED_ID}`,
    household_id: HOUSEHOLD_ID,
    user_id: opts.userId ?? DEPARTED_ID,
    role: 'nanny',
    status: 'removed',
    display_name_override: null,
    profile_name: opts.name ?? 'Amara',
    ended_reason: 'left',
    ended_at:
      daysAgo === null
        ? null
        : new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    ended_by: opts.endedBy === undefined ? DEPARTED_ID : opts.endedBy,
    joined_at: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

let mockDepartures: {
  data: unknown[] | undefined;
  isSuccess: boolean;
  isLoading: boolean;
};
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseRecentDepartures: ReturnType<typeof mock>;
let mockDismissCard: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'parent',
    householdId: HOUSEHOLD_ID,
  }));

  mock.module('expo-router', () => ({
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
    useRouter: () => ({ push: mock(), back: mock() }),
  }));
  mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
    useHouseholdIsLive: mock(() => false),
  }));
  mock.module('@/src/domains/today/hooks/useOverdueClockOut', () => ({
    useOverdueClockOut: mock(() => ({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    })),
  }));
  mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
    useTermsGate: mock(() => ({
      status: 'open',
      proposal: null,
      familyName: 'Departures Household',
    })),
  }));
  mock.module('@/src/domains/inbox/hooks/usePendingOffer', () => ({
    usePendingOffer: mock(() => ({
      offer: null,
      state: null,
      scheduledMinutesToday: 0,
      isBlocking: false,
      timeZone: 'UTC',
    })),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mock(() => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'Departures Household',
        timezone: 'UTC',
        week_starts_on: 1,
        state: 'live',
      },
      householdId: HOUSEHOLD_ID,
      households: [
        { id: HOUSEHOLD_ID, name: 'Departures Household', timezone: 'UTC' },
      ],
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
    })),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: mock(() => ({ data: [], isLoading: false })),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mock(() => ({ data: [], isLoading: false })),
  }));
  mock.module('@/src/hooks/queries/useHouseholdTimesheets', () => ({
    useHouseholdTimesheets: () => ({ data: [], isLoading: false }),
  }));
  mockUseRecentDepartures = mock(() => mockDepartures);
  mock.module('@/src/hooks/queries/useRecentDepartures', () => ({
    useRecentDepartures: mockUseRecentDepartures,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: VIEWER_ID } } }),
  }));
  mockDismissCard = mock();
  mock.module('@/src/store/todayCardDismissalStore', () => ({
    useTodayCardDismissalStore: (
      selector: (s: {
        isDismissed: (key: string) => boolean;
        dismiss: typeof mockDismissCard;
      }) => unknown
    ) => selector({ isDismissed: () => false, dismiss: mockDismissCard }),
  }));

  TodayScreen = (await import('../components/TodayScreen')).TodayScreen;
});

beforeEach(() => {
  mockDepartures = { data: [], isSuccess: true, isLoading: false };
  mockDismissCard?.mockClear();
  mockUseRecentDepartures?.mockClear();
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'onboarded',
    role: 'parent',
    householdId: HOUSEHOLD_ID,
  }));
});

function renderScreen() {
  const tree = render(<TodayScreen />);
  const names = (scope: typeof tree | ReturnType<typeof within>) =>
    scope
      .queryAllByTestId(ORDER_MARKER)
      .map(node => node.props.accessibilityLabel as string);
  const pinned = names(within(tree.getByTestId(SLOT)));
  const all = names(tree);
  return { tree, pinned, feed: all.slice(pinned.length), all };
}

describe('TodayScreen — recent departures', () => {
  it('shows a departure card in the FEED, never the pinned slot', () => {
    mockDepartures = {
      data: [departure(1)],
      isSuccess: true,
      isLoading: false,
    };

    const { feed, pinned } = renderScreen();

    expect(feed).toContain('member-left:Amara');
    expect(pinned).not.toContain('member-left:Amara');
  });

  it('does not report a departure the viewer carried out themselves', () => {
    mockDepartures = {
      data: [departure(1, { endedBy: VIEWER_ID })],
      isSuccess: true,
      isLoading: false,
    };

    const { all } = renderScreen();

    expect(all).not.toContain('member-left:Amara');
  });

  it('still reports one another parent carried out', () => {
    mockDepartures = {
      data: [departure(1, { endedBy: OTHER_PARENT_ID })],
      isSuccess: true,
      isLoading: false,
    };

    const { feed } = renderScreen();

    expect(feed).toContain('member-left:Amara');
  });

  it('does not report a departure older than seven days', () => {
    mockDepartures = {
      data: [departure(8)],
      isSuccess: true,
      isLoading: false,
    };

    const { all } = renderScreen();

    expect(all).not.toContain('member-left:Amara');
  });

  it('does not report one with no ended_at at all — null is "too old to report"', () => {
    mockDepartures = {
      data: [departure(null)],
      isSuccess: true,
      isLoading: false,
    };

    const { all } = renderScreen();

    expect(all).not.toContain('member-left:Amara');
  });

  it('renders nothing and burns no dismissal key while the read is in flight', () => {
    mockDepartures = { data: undefined, isSuccess: false, isLoading: true };

    const { all } = renderScreen();

    expect(all).not.toContain('member-left:Amara');
    const burnt = mockDismissCard.mock.calls.filter((call: unknown[]) =>
      String(call[0]).startsWith('memberLeft:')
    );
    expect(burnt).toEqual([]);
  });

  it('stacks two departures, one card each', () => {
    mockDepartures = {
      data: [
        departure(1),
        departure(2, { userId: 'helper-user-3', name: 'Rosa' }),
      ],
      isSuccess: true,
      isLoading: false,
    };

    const { feed } = renderScreen();

    expect(feed).toContain('member-left:Amara');
    expect(feed).toContain('member-left:Rosa');
  });

  it('never fetches departures for a carer — the read is parent-only', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'nanny',
      householdId: HOUSEHOLD_ID,
    }));
    mockDepartures = {
      data: [departure(1)],
      isSuccess: true,
      isLoading: false,
    };

    const { all } = renderScreen();

    expect(all).not.toContain('member-left:Amara');
    // Gating the render alone would still put the request on the wire; the
    // hook must be handed `undefined` so React Query never enables it.
    for (const call of mockUseRecentDepartures.mock.calls) {
      expect(call[0]).toBeUndefined();
    }
  });
});
