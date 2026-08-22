/**
 * @module domains/today/__tests__/TodayScreen.moments.test
 *
 * Stream U3 — three feed-only milestone moments: the parent-side nanny-joined
 * card (the nanny already has JoinedHouseholdCard), first clock-in, and first
 * week approved. They never occupy PinnedSlot. This file copies the cardOrder
 * harness and stubs the three new cards as order markers so feed position and
 * the gates are observable without rendering MomentCard.
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
  useInboxItems: () => mockInboxItems(),
}));
mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
  useUncoveredToday: () => mockUncovered(),
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
// Renders a real `useQuery`; this file has no QueryClient and is about which
// MOMENT shows, not the invite card.
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
// D78's later-approval card renders a real `useQuery`; this file has no
// QueryClient and is about which MOMENT shows. Its own gates are covered in
// `TodayScreen.weekApproved.test.tsx`.
mock.module('@/src/domains/today/components/WeekApprovedCard', () => ({
  WeekApprovedCard: marker('week-approved'),
}));

const HOUSEHOLD_ID = 'household-moments-1';
const NANNY_USER_ID = 'nanny-user-1';
const VIEWER_ID = 'order-user-1';

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;

function memberJoined(
  daysAgo: number,
  opts: { userId?: string; role?: string; status?: string } = {}
) {
  return {
    user_id: opts.userId ?? VIEWER_ID,
    role: opts.role ?? 'nanny',
    status: opts.status ?? 'active',
    joined_at: new Date(
      Date.now() - daysAgo * 24 * 60 * 60 * 1000
    ).toISOString(),
  };
}

function approvedTimesheet(id: string, carerId = VIEWER_ID) {
  return {
    id,
    household_id: HOUSEHOLD_ID,
    carer_id: carerId,
    status: 'approved',
    total_minutes: 2400,
    week_start: '2026-08-10',
  };
}

let mockMembers: ReturnType<typeof memberJoined>[] = [];
let mockInboxItems: () => { items: { kind: string }[]; isLoading: boolean };
let mockTermsGate: ReturnType<typeof mock>;
let mockPendingOffer: ReturnType<typeof mock>;
let mockUncovered: () => { status: string; localDate: string };
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseOverdueClockOut: ReturnType<typeof mock>;
let mockIsCardDismissed: ReturnType<typeof mock>;
let mockDismissCard: ReturnType<typeof mock>;
let mockTimesheets: { data: unknown[]; isLoading: boolean };

beforeAll(async () => {
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));

  mock.module('expo-router', () => ({
    // `SettingsHeaderButton` in the header band reaches for the singleton.
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
    useRouter: () => ({ push: mock(), back: mock() }),
  }));
  mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
    useHouseholdIsLive: mock(() => false),
  }));
  mockUseOverdueClockOut = mock(() => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }));
  mock.module('@/src/domains/today/hooks/useOverdueClockOut', () => ({
    useOverdueClockOut: mockUseOverdueClockOut,
  }));
  mockTermsGate = mock(() => ({
    status: 'open',
    proposal: null,
    familyName: 'Moments Household',
  }));
  mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
    useTermsGate: mockTermsGate,
  }));
  mockPendingOffer = mock(() => ({
    offer: null,
    state: null,
    scheduledMinutesToday: 0,
    isBlocking: false,
    timeZone: 'UTC',
  }));
  mock.module('@/src/domains/inbox/hooks/usePendingOffer', () => ({
    usePendingOffer: mockPendingOffer,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mock(() => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'Moments Household',
        timezone: 'UTC',
        week_starts_on: 1,
        state: 'live',
      },
      householdId: HOUSEHOLD_ID,
      households: [
        { id: HOUSEHOLD_ID, name: 'Moments Household', timezone: 'UTC' },
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
  mock.module('@/src/hooks/queries/useRecentDepartures', () => ({
    useRecentDepartures: () => ({
      data: [],
      isSuccess: true,
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: mock(() => ({ data: [], isLoading: false })),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mock(() => ({
      data: mockMembers,
      isLoading: false,
    })),
  }));
  mockTimesheets = { data: [], isLoading: false };
  mock.module('@/src/hooks/queries/useHouseholdTimesheets', () => ({
    useHouseholdTimesheets: () => mockTimesheets,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: VIEWER_ID } } }),
  }));
  mockIsCardDismissed = mock(() => false);
  mockDismissCard = mock();
  mock.module('@/src/store/todayCardDismissalStore', () => ({
    // MemberLeftCard (112) reads the reactive accessor; every module
    // mock of this store has to carry it or the import fails.
    useCardDismissal: () => ({ isDismissed: () => false, dismiss: () => {} }),
    useTodayCardDismissalStore: (
      selector: (s: {
        isDismissed: typeof mockIsCardDismissed;
        dismiss: typeof mockDismissCard;
      }) => unknown
    ) =>
      selector({ isDismissed: mockIsCardDismissed, dismiss: mockDismissCard }),
  }));

  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

function renderScreen(role: 'nanny' | 'parent', isPastMember = false) {
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'onboarded',
    role,
    householdId: HOUSEHOLD_ID,
    isPastMember,
  }));
  const tree = render(<TodayScreen />);
  const slot = tree.getByTestId(SLOT);
  const names = (scope: typeof tree | ReturnType<typeof within>) =>
    scope
      .queryAllByTestId(ORDER_MARKER)
      .map(node => node.props.accessibilityLabel as string);
  const pinned = names(within(slot));
  const all = names(tree);
  return { tree, pinned, feed: all.slice(pinned.length), all };
}

beforeEach(() => {
  mockIsCardDismissed?.mockImplementation(() => false);
  mockMembers = [memberJoined(1)];
  mockInboxItems = () => ({ items: [], isLoading: false });
  mockUncovered = () => ({ status: 'covered', localDate: '2026-03-23' });
  mockTimesheets = { data: [], isLoading: false };
  mockUseOverdueClockOut?.mockImplementation(() => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }));
  mockTermsGate?.mockImplementation(() => ({
    status: 'open',
    proposal: null,
    familyName: 'Moments Household',
  }));
  mockPendingOffer?.mockImplementation(() => ({
    offer: null,
    state: null,
    scheduledMinutesToday: 0,
    isBlocking: false,
    timeZone: 'UTC',
  }));
});

describe('TodayScreen — milestone moments', () => {
  it('parent view shows today-nanny-joined-moment for a nanny who joined less than 7 days ago', () => {
    mockMembers = [memberJoined(1, { userId: NANNY_USER_ID, role: 'nanny' })];

    const { feed } = renderScreen('parent');

    expect(feed).toContain('nanny-joined');
  });

  it('parent view does not show it for a nanny who joined 8 days ago', () => {
    mockMembers = [memberJoined(8, { userId: NANNY_USER_ID, role: 'nanny' })];

    const { all } = renderScreen('parent');

    expect(all).not.toContain('nanny-joined');
  });

  it('parent view does not show the joined moment for a candidate nanny member', () => {
    mockMembers = [
      memberJoined(1, {
        userId: NANNY_USER_ID,
        role: 'nanny',
        status: 'candidate',
      }),
    ];

    const { all } = renderScreen('parent');

    expect(all).not.toContain('nanny-joined');
  });

  it('parent view does not show it once the key is already dismissed', () => {
    mockMembers = [memberJoined(1, { userId: NANNY_USER_ID, role: 'nanny' })];
    mockIsCardDismissed.mockImplementation(
      (key: string) => key === `nannyJoined:${HOUSEHOLD_ID}:${NANNY_USER_ID}`
    );

    const { all } = renderScreen('parent');

    expect(all).not.toContain('nanny-joined');
  });

  it('nanny view never shows the parent joined moment', () => {
    mockMembers = [memberJoined(1)];

    const { all } = renderScreen('nanny');

    expect(all).not.toContain('nanny-joined');
  });

  it('shows today-first-clock-in-moment for a nanny on the clock who joined recently and has not seen it', () => {
    mockUseOverdueClockOut.mockImplementation(() => ({
      overdue: false,
      clockInAt: '2026-08-10T08:00:00.000Z',
      shiftEndsAt: null,
    }));

    const { feed } = renderScreen('nanny');

    expect(feed).toContain('first-clock-in');
  });

  it('does not show the first clock-in moment when its key is already dismissed', () => {
    mockUseOverdueClockOut.mockImplementation(() => ({
      overdue: false,
      clockInAt: '2026-08-10T08:00:00.000Z',
      shiftEndsAt: null,
    }));
    mockIsCardDismissed.mockImplementation(
      (key: string) => key === `firstClockIn:${HOUSEHOLD_ID}`
    );

    const { all } = renderScreen('nanny');

    expect(all).not.toContain('first-clock-in');
  });

  it('shows today-first-week-approved-moment when exactly one of her timesheets is approved', () => {
    mockTimesheets = {
      data: [approvedTimesheet('ts-1')],
      isLoading: false,
    };

    const { feed } = renderScreen('nanny');

    expect(feed).toContain('first-week-approved');
  });

  it('does not show it when two of her timesheets are approved', () => {
    mockTimesheets = {
      data: [approvedTimesheet('ts-1'), approvedTimesheet('ts-2')],
      isLoading: false,
    };

    const { all } = renderScreen('nanny');

    expect(all).not.toContain('first-week-approved');
  });

  it('renders the moment cards after today-children and before needs-attention', () => {
    mockMembers = [memberJoined(1, { userId: NANNY_USER_ID, role: 'nanny' })];

    const parent = renderScreen('parent');
    expect(parent.tree.getByTestId('today-children')).toBeTruthy();
    expect(parent.feed.indexOf('nanny-joined')).toBeGreaterThan(-1);
    expect(parent.feed.indexOf('nanny-joined')).toBeLessThan(
      parent.feed.indexOf('needs-attention')
    );

    mockMembers = [memberJoined(1)];
    mockUseOverdueClockOut.mockImplementation(() => ({
      overdue: false,
      clockInAt: '2026-08-10T08:00:00.000Z',
      shiftEndsAt: null,
    }));
    mockTimesheets = {
      data: [approvedTimesheet('ts-1')],
      isLoading: false,
    };

    const nanny = renderScreen('nanny');
    expect(nanny.feed.indexOf('first-clock-in')).toBeGreaterThan(-1);
    expect(nanny.feed.indexOf('first-week-approved')).toBeGreaterThan(-1);
    expect(nanny.feed.indexOf('first-clock-in')).toBeLessThan(
      nanny.feed.indexOf('this-week')
    );
    expect(nanny.feed.indexOf('first-week-approved')).toBeLessThan(
      nanny.feed.indexOf('this-week')
    );
  });
});
