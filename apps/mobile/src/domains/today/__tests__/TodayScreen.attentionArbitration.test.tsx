/**
 * @module domains/today/__tests__/TodayScreen.attentionArbitration.test
 *
 * "One T1 per screen", enforced at the only place that sees every
 * attention-capable card — `TodayScreen` itself. This is the guard the
 * audit asked for: it counts how many of REAL `NeedsAttentionCard` +
 * `TodayCoverage` (not opaque markers) are actually rendering
 * `tone="attention"`'s tinted background, so a FOURTH attention surface
 * added later without wiring into `resolveAttentionOwner` fails this test
 * instead of shipping stacked.
 *
 * Detection is the tinted-ground `backgroundColor` Card applies for
 * `tone="attention"`, not the accent bar — the bar was removed after user
 * feedback on device (it also had a genuine rendering defect: a 4px-wide
 * element can't carry a 20px corner radius). The tint alone still marks
 * which card, if any, currently owns the screen's one T1 slot.
 *
 * `ClockInCard` stays mocked to null here — its side of the arbitration
 * (overdue vs inbox) already has its own dedicated coverage in
 * `TodayScreen.t1Arbitration.test.tsx`; this file is about the NEW pair
 * (inbox vs coverage-gap) the follow-up audit found.
 *
 * Since the pinned slot landed, "who owns the tint" and "who owns the slot"
 * are the same question, so the newest case asserts both at once.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { within } from '@testing-library/react-native';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
// `renderWithProviders`, not bare `render`: the coverage surface now reads the
// day thread (to know whether the carer has said she's running late), and that
// hook needs a QueryClient.
import { renderWithProviders } from '@/src/test-utils';
import { palette } from '~/lib/design-tokens/palette';

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
  return { LoadingIndicator: () => React.createElement('View') };
});
mock.module('@/src/components/ui/empty-state', () => {
  const React = require('react');
  return { EmptyState: () => React.createElement('View') };
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
  // Both no-schedule cards render null on an ordinary day; stubbed so this
  // suite's subject is the only thing under test.
  WeeklyHoursNotSetCard: () => null,
  NoWeekYetCard: () => null,
  PendingScheduleCard: () => null,
  ThisWeeksShiftsCard: () => null,
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: () => null,
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: () => null,
}));
// The three merged week cards behind one block; irrelevant to arbitration.
mock.module('@/src/domains/today/components/ThisWeekCard', () => ({
  ThisWeekCard: () => null,
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
mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
  useWeekTimeEntries: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useShiftsRange', () => ({
  useShiftsRange: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useHouseholdTimesheets', () => ({
  useHouseholdTimesheets: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
  useHouseholdClosures: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
  useCreateParentCover: () => ({
    isPending: false,
    mutateAsync: mock(() => Promise.resolve({})),
  }),
}));
mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
  useHouseholdIsLive: () => false,
}));
mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
  useRestrictedAction: () => ({ disabled: false, reason: null }),
}));
mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock() }),
  // `src/lib/pushNotification.ts` imports the imperative `router`, and this
  // screen's graph now reaches it via the running-late mutation. Without it
  // the file fails at LOAD with "Export named 'router' not found".
  router: { push: mock(), back: mock(), replace: mock() },
}));

const HOUSEHOLD_ID = 'household-attn-1';
const CHANGE_REQUEST: InboxItem = {
  kind: 'change_request',
  id: 'cr-1',
  shiftId: 'shift-1',
  requestKind: 'time_change',
  requestedAt: '2026-08-08T09:00:00.000Z',
  requesterName: null,
  shiftStartsAt: null,
};
const UNCOVERED_STATE = {
  status: 'uncovered' as const,
  localDate: '2026-03-23',
  windows: [
    {
      childId: 'child-1',
      commitmentId: 'commit-1',
      startsAt: '2026-03-23T09:00:00.000Z',
      endsAt: '2026-03-23T12:00:00.000Z',
      cause: 'nothingScheduled' as const,
    },
  ],
};

let mockUseOverdueClockOut: ReturnType<typeof mock>;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockUseUncoveredToday: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseTermsGate: ReturnType<typeof mock>;
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

  mockUseInboxItems = mock(() => ({ items: [], isLoading: false }));
  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));

  mockUseUncoveredToday = mock(() => ({
    status: 'covered',
    localDate: '2026-03-23',
  }));
  mock.module('@/src/domains/today/hooks/useUncoveredToday', () => ({
    useUncoveredToday: mockUseUncoveredToday,
  }));

  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'Attn Household',
        timezone: 'UTC',
        week_starts_on: 1,
      },
      householdId: HOUSEHOLD_ID,
      households: [
        { id: HOUSEHOLD_ID, name: 'Attn Household', timezone: 'UTC' },
      ],
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
    }),
  }));
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'parent',
    householdId: HOUSEHOLD_ID,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  // A1's gate. Left REAL below it: `ClockInBlockedCard` is one of the
  // attention-capable cards this file counts, so stubbing it would defeat
  // the count.
  mockUseTermsGate = mock(() => ({
    status: 'open',
    proposal: null,
    familyName: 'Attn Household',
  }));
  mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
    useTermsGate: mockUseTermsGate,
  }));
  mock.module('@/src/hooks/queries/useRecentDepartures', () => ({
    useRecentDepartures: () => ({
      data: [],
      isSuccess: true,
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: () => ({ data: [], isLoading: false }),
  }));

  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

const ATTENTION_BG = palette.light.surfaceAttention.hex;

/** The attention-capable T1 cards this file exercises together. */
const ATTENTION_CANDIDATE_TEST_IDS = [
  'today-needs-attention-card',
  'today-coverage-gap-card',
  'today-clock-in-blocked-card',
];

function hasAttentionBackground(style: unknown): boolean {
  const styles = Array.isArray(style) ? style.flat() : [style];
  return styles.some(
    s =>
      !!s &&
      typeof s === 'object' &&
      (s as { backgroundColor?: string }).backgroundColor === ATTENTION_BG
  );
}

function countAttentionCards(
  queryByTestId: (id: string) => { props: { style?: unknown } } | null
): number {
  return ATTENTION_CANDIDATE_TEST_IDS.filter(id => {
    const el = queryByTestId(id);
    return !!el && hasAttentionBackground(el.props.style);
  }).length;
}

describe('TodayScreen — one T1 per screen (attention arbitration)', () => {
  // The whole guarantee in one case: the gap owns the slot, the inbox card
  // is still on screen (in the feed, at default tone), and exactly ONE
  // attention ground exists anywhere.
  it('parent + coverage gap + inbox item: coverage in the slot, inbox outside it, one attention ground', () => {
    mockUseInboxItems.mockReturnValue({
      items: [CHANGE_REQUEST],
      isLoading: false,
    });
    mockUseUncoveredToday.mockReturnValue(UNCOVERED_STATE);
    mockUseOverdueClockOut.mockReturnValue({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    });

    const tree = renderWithProviders(<TodayScreen />);
    const slot = within(tree.getByTestId('today-pinned-slot'));

    expect(slot.getByTestId('today-coverage-gap-card')).toBeTruthy();
    expect(slot.queryByTestId('today-needs-attention-card')).toBeNull();
    expect(tree.getByTestId('today-needs-attention-card')).toBeTruthy();
    expect(countAttentionCards(tree.queryByTestId)).toBe(1);
  });

  it('parent + inbox item + uncovered care today: exactly one attention surface (uncovered wins)', () => {
    mockUseInboxItems.mockReturnValue({
      items: [CHANGE_REQUEST],
      isLoading: false,
    });
    mockUseUncoveredToday.mockReturnValue(UNCOVERED_STATE);
    mockUseOverdueClockOut.mockReturnValue({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    });

    const { queryByTestId } = renderWithProviders(<TodayScreen />);

    expect(countAttentionCards(queryByTestId)).toBe(1);
    expect(queryByTestId('today-coverage-gap-card')).toBeTruthy();
  });

  it('inbox item alone, no uncovered care: exactly one attention surface (the inbox owns it)', () => {
    mockUseInboxItems.mockReturnValue({
      items: [CHANGE_REQUEST],
      isLoading: false,
    });
    mockUseUncoveredToday.mockReturnValue({
      status: 'covered',
      localDate: '2026-03-23',
    });
    mockUseOverdueClockOut.mockReturnValue({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    });

    const { queryByTestId } = renderWithProviders(<TodayScreen />);

    expect(countAttentionCards(queryByTestId)).toBe(1);
  });

  // A read that failed is not an obligation. The slot says "we couldn't load
  // this" and hands him a retry; nothing on the screen goes loud, because
  // nothing on the screen knows anything to be loud about.
  it('parent + failed uncovered read: retry in the slot, zero attention grounds', () => {
    mockUseInboxItems.mockReturnValue({ items: [], isLoading: false });
    mockUseUncoveredToday.mockReturnValue({
      status: 'error',
      retry: mock(),
    });
    mockUseOverdueClockOut.mockReturnValue({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    });

    const tree = renderWithProviders(<TodayScreen />);
    const slot = within(tree.getByTestId('today-pinned-slot'));

    expect(slot.getByTestId('today-coverage-retry')).toBeTruthy();
    expect(countAttentionCards(tree.queryByTestId)).toBe(0);
  });

  it('nothing needs attention: zero attention surfaces', () => {
    mockUseInboxItems.mockReturnValue({ items: [], isLoading: false });
    mockUseUncoveredToday.mockReturnValue({
      status: 'covered',
      localDate: '2026-03-23',
    });
    mockUseOverdueClockOut.mockReturnValue({
      overdue: false,
      clockInAt: null,
      shiftEndsAt: null,
    });

    const { queryByTestId } = renderWithProviders(<TodayScreen />);

    expect(countAttentionCards(queryByTestId)).toBe(0);
  });

  // The block is the ladder's TOP rung, so it wins the slot outright. What
  // this case pins is the harder half: `NeedsAttentionCard` is still on the
  // screen (she has real pending work) and must go quiet, or a nanny who
  // cannot start work gets two loud cards competing to explain why.
  it('nanny + terms block + inbox item: the blocked card owns the only attention ground', () => {
    mockUseIsOnboarded.mockReturnValue({
      status: 'onboarded',
      role: 'nanny',
      householdId: HOUSEHOLD_ID,
    });
    mockUseTermsGate.mockReturnValue({
      status: 'blocked',
      variant: 'familySent',
      proposal: {
        id: 'proposal-attn-1',
        direction: 'parent',
        created_at: '2026-03-20T09:00:00.000Z',
      },
      familyName: 'Attn Household',
    });
    mockUseInboxItems.mockReturnValue({
      items: [CHANGE_REQUEST],
      isLoading: false,
    });
    mockUseUncoveredToday.mockReturnValue({
      status: 'covered',
      localDate: '2026-03-23',
    });

    const tree = renderWithProviders(<TodayScreen />);
    const slot = within(tree.getByTestId('today-pinned-slot'));

    expect(slot.getByTestId('today-clock-in-blocked-card')).toBeTruthy();
    expect(tree.getByTestId('today-needs-attention-card')).toBeTruthy();
    expect(countAttentionCards(tree.queryByTestId)).toBe(1);
  });
});
