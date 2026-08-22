/**
 * @module domains/today/__tests__/TodayScreen.cardOrder.test
 *
 * Today is ONE CONTROL PLUS A FEED, and this file pins both halves.
 *
 * It used to pin only the second: eleven cards in one ScrollView, with sort
 * ORDER as the only thing keeping the most important control on screen. That
 * failed measurably — the respond CTA landed at y 881–929 with the viewport
 * ending at 873 (iPhone 17 Pro Max), so a nanny with a week waiting saw no
 * call to action at all, and a tap at the CTA's reported centre hit the Hours
 * tab button underneath. A test can pin an order; nothing can pin pixels.
 *
 * `PinnedSlot` is the fix and is left REAL here: it sits outside the
 * ScrollView, in normal flow, holding EXACTLY ONE item. So the first
 * assertion of this file is a count, not an index — and the feed order below
 * it is the second.
 *
 * Hooks are mocked via `mock.module()` in `beforeAll` before the dynamic
 * import, per docs/09-TESTING.md / TodayScreen.wash.test.tsx.
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

/**
 * Every card renders the same testID with its name on `accessibilityLabel`, so
 * `getAllByTestId` returns them in tree order and the names read out directly.
 */
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
  PendingScheduleCard: marker('pending-schedule'),
  ThisWeeksShiftsCard: () => null,
  WeeklyHoursNotSetCard: marker('weekly-hours-not-set'),
  NoWeekYetCard: marker('no-week-yet'),
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
// Feeds the hero illustration only; this file renders without a QueryClient
// and is about the slot and the feed's ORDER.
mock.module('@/src/domains/today/hooks/useTodayCoverRows', () => ({
  useTodayCoverRows: () => ({ rows: [], isLoading: false }),
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: marker('clock-in'),
}));
mock.module('@/src/domains/today/components/ClockInBlockedCard', () => ({
  ClockInBlockedCard: marker('clock-in-blocked'),
}));
// The three merged cards are one block now — its own file's tests cover which
// children it gathers; here it is a single position in the feed.
mock.module('@/src/domains/today/components/ThisWeekCard', () => ({
  ThisWeekCard: marker('this-week'),
}));
mock.module('@/src/domains/today/components/TodayCoverage', () => {
  const React = require('react');
  return {
    // Renders its `footer` so the parent-side handoff fold is observable as a
    // position, not just a prop.
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
// S9 — self-contained, no ORDER_MARKER of its own (it never competes for the
// slot); its own file owns render-condition tests. Real hooks need a
// QueryClient this file deliberately does not build.
mock.module(
  '@/src/domains/today/components/EmergencyContactPromptCard',
  () => ({
    EmergencyContactPromptCard: () => null,
  })
);
// P5/S10 — self-contained, unscoped, no ORDER_MARKER (it renders above the
// header, outside anything this file is pinning). Its own file owns its
// render-condition tests; real hooks need a QueryClient this file
// deliberately does not build.
mock.module('@/src/domains/today/components/CrossFamilyStrip', () => ({
  CrossFamilyStrip: () => null,
}));
// Renders a real `useQuery`; this file has no QueryClient and is about ORDER.
mock.module('@/src/domains/today/components/InviteWaitingCard', () => ({
  InviteWaitingCard: marker('invite-waiting'),
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

const HOUSEHOLD_ID = 'household-order-1';

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;
/**
 * The signed-in nanny's membership row. `joined_at` is what gates §8.1's
 * arrival card, so tests move it rather than the dismissal flag.
 */
function memberJoined(daysAgo: number) {
  return {
    user_id: 'order-user-1',
    role: 'nanny',
    status: 'active',
    joined_at: new Date(
      Date.now() - daysAgo * 24 * 60 * 60 * 1000
    ).toISOString(),
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

beforeAll(async () => {
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock(), back: mock() }),
    // `SettingsHeaderButton` in the hero band reaches for the singleton.
    router: { push: mock(), back: mock() },
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
    familyName: 'Order Household',
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
        name: 'Order Household',
        timezone: 'UTC',
        week_starts_on: 1,
        state: 'live',
      },
      householdId: HOUSEHOLD_ID,
      households: [
        { id: HOUSEHOLD_ID, name: 'Order Household', timezone: 'UTC' },
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
  mock.module('@/src/hooks/queries/useHouseholdTimesheets', () => ({
    useHouseholdTimesheets: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: 'order-user-1' } } }),
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
  // The slot renders BEFORE the ScrollView, so everything after it is feed.
  return { tree, pinned, feed: all.slice(pinned.length), all };
}

beforeEach(() => {
  mockIsCardDismissed?.mockImplementation(() => false);
  // Freshly joined by default — the case §8.1's card exists for.
  mockMembers = [memberJoined(1)];
  mockInboxItems = () => ({ items: [], isLoading: false });
  mockUncovered = () => ({ status: 'covered', localDate: '2026-03-23' });
  mockUseOverdueClockOut?.mockImplementation(() => ({
    overdue: false,
    clockInAt: null,
    shiftEndsAt: null,
  }));
  mockTermsGate?.mockImplementation(() => ({
    status: 'open',
    proposal: null,
    familyName: 'Order Household',
  }));
  mockPendingOffer?.mockImplementation(() => ({
    offer: null,
    state: null,
    scheduledMinutesToday: 0,
    isBlocking: false,
    timeZone: 'UTC',
  }));
});

/** A live offer THIS viewer sent, with or without today's consequence. */
function sentOffer(isBlocking: boolean) {
  mockPendingOffer.mockImplementation(() => ({
    offer: {
      kind: 'terms_proposal_sent',
      id: 'prop-sent-1',
      householdId: HOUSEHOLD_ID,
      carerId: 'carer-1',
      carerDisplayName: 'Marisol',
      proposedAt: '2026-08-01T09:00:00.000Z',
      viewedAt: null,
      direction: 'parent',
    },
    state: {
      variant: isBlocking ? 'blocking' : 'stale',
      opened: false,
      days: 20,
    },
    scheduledMinutesToday: isBlocking ? 360 : 0,
    isBlocking,
    timeZone: 'UTC',
  }));
  mockInboxItems = () => ({
    items: [{ kind: 'terms_proposal_sent' }],
    isLoading: false,
  });
}

describe('TodayScreen — A7, the parent who is the bottleneck', () => {
  it('pins the pending-offer card when her shift today cannot be recorded', () => {
    sentOffer(true);

    const { pinned, feed } = renderScreen('parent');

    expect(pinned).toEqual(['pending-offer']);
    expect(feed).not.toContain('pending-offer');
  });

  // THE RULE, at the screen level: a 20-day-old offer with no shift today
  // stays in the feed. Age changes copy, never position and never tone.
  it('leaves a stale offer with no shift today in the feed, off the slot', () => {
    sentOffer(false);

    const { pinned, feed } = renderScreen('parent');

    // The slot falls back to his ordinary-day occupant, not to nothing.
    expect(pinned).not.toContain('pending-offer');
    expect(feed).toContain('pending-offer');
  });

  it('lets her own terms block outrank his sent offer', () => {
    sentOffer(true);
    blockTerms();

    const { pinned } = renderScreen('nanny');

    expect(pinned).toEqual(['clock-in-blocked']);
  });

  it('beats an overdue clock-out — the block prevents every record, not one', () => {
    sentOffer(true);
    mockUseOverdueClockOut.mockImplementation(() => ({
      overdue: true,
      clockInAt: '2026-08-10T08:00:00.000Z',
      shiftEndsAt: '2026-08-10T16:00:00.000Z',
    }));

    const { pinned } = renderScreen('parent');

    expect(pinned).toEqual(['pending-offer']);
  });
});

/** A1's gate, closed: the arrangement query settled with nothing. */
function blockTerms(variant = 'familySent') {
  mockTermsGate.mockImplementation(() => ({
    status: 'blocked',
    variant,
    proposal: {
      id: 'proposal-1',
      direction: 'parent',
      created_at: '2026-08-12T09:00:00.000Z',
    },
    familyName: 'Order Household',
  }));
}

describe('TodayScreen — A1, the clock-in hard block', () => {
  it('gives the blocked card the slot, above everything the ladder can name', () => {
    blockTerms();
    mockInboxItems = () => ({
      items: [{ kind: 'change_request' }],
      isLoading: false,
    });
    mockUseOverdueClockOut.mockImplementation(() => ({
      overdue: true,
      clockInAt: '2026-08-10T08:00:00.000Z',
      shiftEndsAt: '2026-08-10T16:00:00.000Z',
    }));

    const { pinned } = renderScreen('nanny');

    expect(pinned).toEqual(['clock-in-blocked']);
  });

  // The blocked card IS the review CTA. A clock-in button she cannot use and
  // a second card about the same unanswered proposal are both noise on the
  // one screen where she needs a single, obvious next step.
  it('mounts neither the clock nor the terms-proposal card ANYWHERE while blocked', () => {
    blockTerms();
    mockInboxItems = () => ({
      items: [{ kind: 'terms_proposal' }],
      isLoading: false,
    });

    const { all } = renderScreen('nanny');

    expect(all).not.toContain('clock-in');
    expect(all).not.toContain('terms-proposal');
    expect(all.filter(n => n === 'clock-in-blocked')).toHaveLength(1);
  });

  it('never blocks a parent — the gate is hers alone', () => {
    blockTerms();

    const { pinned, all } = renderScreen('parent');

    expect(pinned).not.toContain('clock-in-blocked');
    expect(all).not.toContain('clock-in-blocked');
  });

  it('never blocks a household she was removed from', () => {
    blockTerms();

    const { all } = renderScreen('nanny', true);

    expect(all).not.toContain('clock-in-blocked');
  });

  it('gives the clock back the slot the moment terms are agreed', () => {
    const { pinned, all } = renderScreen('nanny');

    expect(pinned).toEqual(['clock-in']);
    expect(all).not.toContain('clock-in-blocked');
  });

  // A gate still resolving is not a work stoppage — see useTermsGate.
  it('does not block while the gate is still loading', () => {
    mockTermsGate.mockImplementation(() => ({
      status: 'loading',
      proposal: null,
      familyName: 'Order Household',
    }));

    const { pinned } = renderScreen('nanny');

    expect(pinned).toEqual(['clock-in']);
  });
});

describe('TodayScreen — the pinned slot holds exactly one thing', () => {
  it("an active nanny's ordinary day pins the clock, and only the clock", () => {
    const { pinned, feed } = renderScreen('nanny');

    expect(pinned).toEqual(['clock-in']);
    expect(feed).not.toContain('clock-in');
    expect(feed).toContain('this-week');
    expect(feed).toContain('handoff-chips');
  });

  it('an inbox item takes the slot from the clock, which drops into the feed', () => {
    mockInboxItems = () => ({
      items: [{ kind: 'change_request' }],
      isLoading: false,
    });

    const { pinned, feed } = renderScreen('nanny');

    expect(pinned).toEqual(['needs-attention']);
    expect(feed).not.toContain('needs-attention');
    expect(feed).toContain('clock-in');
    expect(feed.indexOf('clock-in')).toBeLessThan(feed.indexOf('this-week'));
  });

  it('a running clock beats the inbox — the timer is what is happening now', () => {
    mockInboxItems = () => ({
      items: [{ kind: 'change_request' }],
      isLoading: false,
    });
    mockUseOverdueClockOut.mockImplementation(() => ({
      overdue: false,
      clockInAt: '2026-08-10T08:00:00.000Z',
      shiftEndsAt: null,
    }));

    const { pinned, feed } = renderScreen('nanny');

    expect(pinned).toEqual(['clock-in']);
    expect(feed).toContain('needs-attention');
  });

  it('a terms proposal takes the slot on its own rung', () => {
    mockInboxItems = () => ({
      items: [{ kind: 'terms_proposal' }],
      isLoading: false,
    });

    const { pinned, feed } = renderScreen('parent');

    expect(pinned).toEqual(['terms-proposal']);
    expect(feed).not.toContain('terms-proposal');
  });

  // The parent's slot was the one that stood empty on an ordinary day, which
  // put "who has my children today" below the fold behind the week card.
  // It is his clock: the routine answer earns the slot exactly as hers does.
  it("a parent's ordinary day pins the coverage surface, handoff folded in as its footer", () => {
    const { pinned, feed, tree } = renderScreen('parent');

    expect(pinned).toEqual(['today-coverage', 'handoff-chips']);
    expect(feed).not.toContain('today-coverage');
    // Through the surface's `footer`, so there is exactly one of it and it is
    // not also standing alone down in the feed.
    expect(feed).not.toContain('handoff-chips');
    expect(tree.getByTestId(SLOT).props.style).toBeDefined();
  });

  it('an inbox item takes the slot from routine coverage, which drops to the feed with its footer', () => {
    mockInboxItems = () => ({
      items: [{ kind: 'change_request' }],
      isLoading: false,
    });

    const { pinned, feed } = renderScreen('parent');

    expect(pinned).toEqual(['needs-attention']);
    expect(feed).toContain('today-coverage');
    // The fold travels with the surface — never left behind in the slot, and
    // never duplicated into its own feed row.
    expect(feed.filter(n => n === 'handoff-chips')).toHaveLength(1);
    expect(feed.indexOf('today-coverage')).toBeLessThan(
      feed.indexOf('handoff-chips')
    );
  });

  it("a parent's coverage gap pins the coverage surface, and the handoff stands alone below", () => {
    mockUncovered = () => ({ status: 'uncovered', localDate: '2026-03-23' });

    const { pinned, feed } = renderScreen('parent');

    expect(pinned).toEqual(['today-coverage']);
    expect(feed).not.toContain('today-coverage');
    // The slot carries no footer, so the chips have to be their own row.
    expect(feed).toContain('handoff-chips');
  });

  it("a nanny's ladder is never owned by a card she cannot see", () => {
    mockUncovered = () => ({ status: 'uncovered', localDate: '2026-03-23' });

    const { pinned, feed } = renderScreen('nanny');

    expect(pinned).toEqual(['clock-in']);
    expect(feed).not.toContain('today-coverage');
  });
});

describe('TodayScreen — feed order beneath the slot', () => {
  it('keeps the one-time and attention cards above the routine ones', () => {
    mockInboxItems = () => ({
      items: [{ kind: 'change_request' }],
      isLoading: false,
    });

    // On the clock, so the slot holds the timer and BOTH attention cards
    // stay in the feed — the only arrangement where the whole order is
    // observable at once.
    mockUseOverdueClockOut.mockImplementation(() => ({
      overdue: false,
      clockInAt: '2026-08-10T08:00:00.000Z',
      shiftEndsAt: null,
    }));

    const { feed } = renderScreen('nanny');

    expect(feed.indexOf('joined-household')).toBeLessThan(
      feed.indexOf('needs-attention')
    );
    expect(feed.indexOf('needs-attention')).toBeLessThan(
      feed.indexOf('terms-proposal')
    );
    expect(feed.indexOf('terms-proposal')).toBeLessThan(
      feed.indexOf('pending-schedule')
    );
    expect(feed.indexOf('pending-schedule')).toBeLessThan(
      feed.indexOf('send-my-terms')
    );
    expect(feed.indexOf('send-my-terms')).toBeLessThan(
      feed.indexOf('this-week')
    );
    expect(feed.indexOf('this-week')).toBeLessThan(
      feed.indexOf('handoff-chips')
    );
    // The timer owns the slot, so it must not also sit in the feed.
    expect(feed).not.toContain('clock-in');
  });

  it("puts the parent's no-schedule card in the invite card's slot", () => {
    const { pinned, feed } = renderScreen('parent');

    // Successor to InviteWaitingCard: that card hides the instant a nanny is
    // active and this one requires it, so they are mutually exclusive by
    // construction and share one place in the story. Above the attention
    // band, below the moments, and never in the slot — it displaces nothing.
    expect(feed).toContain('weekly-hours-not-set');
    expect(pinned).not.toContain('weekly-hours-not-set');
    expect(feed.indexOf('invite-waiting')).toBeLessThan(
      feed.indexOf('weekly-hours-not-set')
    );
    expect(feed.indexOf('weekly-hours-not-set')).toBeLessThan(
      feed.indexOf('needs-attention')
    );
  });

  it("keeps the nanny's no-schedule card beside the pending-week card", () => {
    const { pinned, feed } = renderScreen('nanny');

    // Two halves of one fact — a week that is waiting for her, and a week
    // that was never sent — so they sit together and never both apply.
    expect(feed).toContain('no-week-yet');
    expect(pinned).not.toContain('no-week-yet');
    expect(feed.indexOf('pending-schedule')).toBeLessThan(
      feed.indexOf('no-week-yet')
    );
    expect(feed.indexOf('no-week-yet')).toBeLessThan(feed.indexOf('this-week'));
  });

  it('puts the invite waiting card above the attention band for a parent', () => {
    const { feed } = renderScreen('parent');

    // It is a feed card, not a slot rung — it displaces nothing, it just has
    // to be readable before the attention group rather than under the week.
    expect(feed.indexOf('invite-waiting')).toBeGreaterThanOrEqual(0);
    expect(feed.indexOf('invite-waiting')).toBeLessThan(
      feed.indexOf('needs-attention')
    );
  });

  it('never mounts the invite waiting card for a nanny', () => {
    const { feed } = renderScreen('nanny');

    expect(feed).not.toContain('invite-waiting');
  });

  // Wherever the surface goes, the chips go — the fold is a property of the
  // card, not of the position it happens to be mounted in. On an ordinary day
  // that position is the slot.
  it('folds the handoff chips into the coverage surface for a parent', () => {
    const { all, feed } = renderScreen('parent');

    expect(all).toContain('today-coverage');
    expect(all.filter(n => n === 'handoff-chips')).toHaveLength(1);
    expect(all.indexOf('today-coverage')).toBeLessThan(
      all.indexOf('handoff-chips')
    );
    // The week card keeps its feed position under the slot either way.
    expect(feed).toContain('this-week');
  });

  it('offers no clock-in on a household she was removed from', () => {
    const { pinned, all } = renderScreen('nanny', true);

    expect(pinned).toEqual([]);
    expect(all).not.toContain('clock-in');
  });

  it('does not mount the coverage surface for a nanny', () => {
    const { all } = renderScreen('nanny');
    expect(all).not.toContain('today-coverage');
  });

  // B5 — JoinedHouseholdCard was complete and tested but no screen mounted
  // it. §8.1: renders once, above everything else in the feed, nanny-only.
  it('mounts the joined-household card at the top of the feed', () => {
    const { feed } = renderScreen('nanny');
    expect(feed[0]).toBe('joined-household');
  });

  it('does not mount the joined-household card for a parent', () => {
    const { all } = renderScreen('parent');
    expect(all).not.toContain('joined-household');
  });

  it('does not mount the joined-household card once already dismissed', () => {
    mockIsCardDismissed.mockImplementation(() => true);
    const { all } = renderScreen('nanny');
    expect(all).not.toContain('joined-household');
  });

  // The dismissal store starts EMPTY on every install, so "not dismissed" on
  // its own would announce her arrival to a nanny who has worked here for
  // months — every existing user, once, the first time she opens the update.
  // `joined_at` is the only clock that can tell the two apart.
  it('does not mount the joined-household card for a long-standing member', () => {
    mockMembers = [memberJoined(90)];
    const { all } = renderScreen('nanny');
    expect(all).not.toContain('joined-household');
  });

  it('does not mount the joined-household card when her membership is unreadable', () => {
    mockMembers = [];
    const { all } = renderScreen('nanny');
    expect(all).not.toContain('joined-household');
  });
});
