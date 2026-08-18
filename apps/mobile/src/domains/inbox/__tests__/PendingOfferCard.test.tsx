/**
 * @module domains/inbox/__tests__/PendingOfferCard.test
 *
 * A7's parent-side card, and the one rule that decides whether it is useful
 * or noise: **only `variant === 'blocking'` may be attention-toned.** The day
 * counter changes the words and, at day 10, adds a Withdraw affordance — it
 * never changes the tone. A stale offer for a nanny with no shift on the
 * books stays quiet however old it gets, because a card that shouts about a
 * contract nobody is waiting on today is exactly what teaches a parent to
 * ignore the one that matters.
 *
 * Tone is positional (`usePinnedTone`), so "may be attention-toned" means
 * "may be pinned". The blocking case is asserted INSIDE `PinnedSlot`; every
 * quiet case is asserted inside it too, which is the strong form — even given
 * the loudest position available, a non-blocking offer must not take it.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { PinnedSlot } from '@/src/domains/today/components/PinnedSlot';
import { palette } from '~/lib/design-tokens/palette';
import type { InboxItem } from '../utils/buildInboxItems';

const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;
const HOUSEHOLD_ID = 'hh-offer-1';
const CARER_ID = 'carer-offer-1';
const NOW = Date.parse('2026-08-25T12:00:00.000Z');
const DAY = 86_400_000;

function offer(daysAgo: number, viewedAt: string | null = null): InboxItem {
  return {
    kind: 'terms_proposal_sent',
    id: 'prop-offer-1',
    householdId: HOUSEHOLD_ID,
    carerId: CARER_ID,
    carerDisplayName: 'Marisol',
    proposedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    viewedAt,
    direction: 'parent',
  };
}

/** A scheduled shift for the carer this offer names, today. */
const SHIFT_TODAY = {
  id: 'shift-1',
  carer_id: CARER_ID,
  status: 'confirmed',
  local_date: '2026-08-25',
  starts_at: '2026-08-25T09:00:00.000Z',
  ends_at: '2026-08-25T15:00:00.000Z',
};

let PendingOfferCard: typeof import('../components/PendingOfferCard').PendingOfferCard;
let mockItems: InboxItem[];
let mockRole: string;
let mockShifts: unknown[];
let mockPush: ReturnType<typeof mock>;
let mockWithdraw: ReturnType<typeof mock>;
let mockRemind: ReturnType<typeof mock>;
let mockRemindData: { reminded_at: string } | undefined;
let mockRemindTooSoon: boolean;

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) =>
        opts ? `${key}(${JSON.stringify(opts)})` : key,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
  }));
  mock.module('../hooks/useInboxItems', () => ({
    useInboxItems: () => ({ items: mockItems, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ role: mockRole, isPastMember: false }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'Okafor family',
        timezone: 'UTC',
        week_starts_on: 1,
      },
      households: [{ id: HOUSEHOLD_ID }],
      pastHouseholds: [],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: () => ({ data: mockShifts, isLoading: false }),
  }));
  mockWithdraw = mock(() => Promise.resolve());
  mock.module('@/src/hooks/mutations/useWithdrawTerms', () => ({
    useWithdrawTerms: () => ({ mutateAsync: mockWithdraw, isPending: false }),
  }));

  mockRemind = mock(() => Promise.resolve());
  mock.module('@/src/hooks/mutations/useRemindTerms', () => ({
    useRemindTerms: () => ({
      mutateAsync: mockRemind,
      data: mockRemindData,
      error: null,
      isPending: false,
    }),
    isRemindTooSoon: () => mockRemindTooSoon,
  }));

  const mod = await import('../components/PendingOfferCard');
  PendingOfferCard = mod.PendingOfferCard;
});

beforeEach(() => {
  mockItems = [offer(0)];
  mockRole = 'parent';
  mockShifts = [];
  mockPush.mockClear();
  mockWithdraw.mockClear();
  mockRemind.mockClear();
  mockRemindData = undefined;
  mockRemindTooSoon = false;
});

/** The strongest position available — anything quiet here is quiet anywhere. */
function renderPinned() {
  return render(
    <PinnedSlot>
      <PendingOfferCard nowMs={NOW} />
    </PinnedSlot>
  );
}

function surfaceOf(card: { props: { style?: unknown } }): unknown {
  return [card.props.style]
    .flat()
    .find(
      (s): s is { backgroundColor: unknown } =>
        !!s && typeof s === 'object' && 'backgroundColor' in s
    )?.backgroundColor;
}

describe('PendingOfferCard — THE TONE RULE', () => {
  it('goes attention-toned when she has a shift today and cannot record it', () => {
    mockShifts = [SHIFT_TODAY];

    const card = renderPinned().getByTestId('today-pending-offer-card');

    expect(surfaceOf(card)).toBe(SURFACE_ATTENTION);
  });

  it('stays quiet at day 10 with no shift — age changes copy, never tone', () => {
    mockItems = [offer(10)];

    const card = renderPinned().getByTestId('today-pending-offer-card');

    expect(surfaceOf(card)).not.toBe(SURFACE_ATTENTION);
  });

  // The false-alarm guard, stated at every age the copy has a word for.
  it('stays quiet at ANY age with no shift scheduled', () => {
    for (const daysAgo of [0, 3, 10, 45, 365]) {
      mockItems = [offer(daysAgo)];
      const card = renderPinned().getByTestId('today-pending-offer-card');
      expect(surfaceOf(card)).not.toBe(SURFACE_ATTENTION);
    }
  });

  it("ignores another carer's shift today — the consequence has to be HERS", () => {
    mockItems = [offer(12)];
    mockShifts = [{ ...SHIFT_TODAY, carer_id: 'someone-else' }];

    const card = renderPinned().getByTestId('today-pending-offer-card');

    expect(surfaceOf(card)).not.toBe(SURFACE_ATTENTION);
  });

  it('ignores a cancelled shift today — nothing is being prevented', () => {
    mockItems = [offer(12)];
    mockShifts = [{ ...SHIFT_TODAY, status: 'cancelled' }];

    const card = renderPinned().getByTestId('today-pending-offer-card');

    expect(surfaceOf(card)).not.toBe(SURFACE_ATTENTION);
  });
});

describe('PendingOfferCard — copy per variant', () => {
  it('day 0 names the send, and says it has not been opened', () => {
    const tree = renderPinned();

    expect(tree.getByTestId('today-pending-offer-title').props.children).toBe(
      'pendingOfferCard.titleSentToday({"carer":"Marisol"})'
    );
    expect(
      tree.getByTestId('today-pending-offer-subtitle').props.children
    ).toBe('pendingOfferCard.subtitleSentToday');
  });

  it('day 3 opened waits on HER, and says opened-not-answered', () => {
    mockItems = [offer(3, '2026-08-23T09:00:00.000Z')];

    const tree = renderPinned();

    expect(tree.getByTestId('today-pending-offer-title').props.children).toBe(
      'pendingOfferCard.titleWaiting({"carer":"Marisol"})'
    );
    expect(
      tree.getByTestId('today-pending-offer-subtitle').props.children
    ).toBe('pendingOfferCard.subtitleOpened({"date":"22 Aug"})');
  });

  it('day 3 unopened forks only the subtitle', () => {
    mockItems = [offer(3)];

    const tree = renderPinned();

    expect(
      tree.getByTestId('today-pending-offer-subtitle').props.children
    ).toBe('pendingOfferCard.subtitleNotOpened({"date":"22 Aug"})');
  });

  it('day 10 counts the days out loud', () => {
    mockItems = [offer(10)];

    expect(
      renderPinned().getByTestId('today-pending-offer-title').props.children
    ).toBe('pendingOfferCard.titleStale({"days":"10"})');
  });

  it('blocking names the consequence, in her name, not the contract', () => {
    mockShifts = [SHIFT_TODAY];
    mockItems = [offer(4)];

    const tree = renderPinned();

    expect(tree.getByTestId('today-pending-offer-title').props.children).toBe(
      'pendingOfferCard.titleBlocking({"carer":"Marisol"})'
    );
    expect(
      tree.getByTestId('today-pending-offer-subtitle').props.children
    ).toBe('pendingOfferCard.subtitleBlocking({"date":"21 Aug"})');
  });

  // The number is what makes it concrete — "she has 6 hours today" beats any
  // amount of prose about contracts.
  it('counts the hours that cannot be recorded, and only while blocking', () => {
    mockShifts = [SHIFT_TODAY];

    expect(
      renderPinned().getByTestId('today-pending-offer-hours').props.children
    ).toBe('pendingOfferCard.scheduledToday({"carer":"Marisol","hours":"6h"})');

    mockShifts = [];
    expect(
      renderPinned().queryByTestId('today-pending-offer-hours')
    ).toBeNull();
  });
});

describe('PendingOfferCard — actions', () => {
  it('routes to the proposal he sent, whatever the verb on the button', () => {
    fireEvent.press(renderPinned().getByTestId('today-pending-offer-cta'));

    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/pay/proposal/prop-offer-1'
    );
  });

  it('offers to SEE it while it is fresh, and to CHANGE it once it is not', () => {
    expect(
      renderPinned().getByTestId('today-pending-offer-cta-label').props.children
    ).toBe('pendingOfferCard.ctaSee');

    mockItems = [offer(10)];
    expect(
      renderPinned().getByTestId('today-pending-offer-cta-label').props.children
    ).toBe('pendingOfferCard.ctaChange');
  });

  // Taking your own offer back is a real decision; it is not on the table
  // until the offer has genuinely gone nowhere.
  it('withholds Withdraw until day 10', () => {
    for (const daysAgo of [0, 3, 9]) {
      mockItems = [offer(daysAgo)];
      expect(
        renderPinned().queryByTestId('today-pending-offer-withdraw')
      ).toBeNull();
    }
    mockItems = [offer(10)];
    expect(
      renderPinned().getByTestId('today-pending-offer-withdraw')
    ).toBeTruthy();
  });

  it('never offers Withdraw on a blocking offer — the fix is to change it, not drop it', () => {
    mockItems = [offer(30)];
    mockShifts = [SHIFT_TODAY];

    expect(
      renderPinned().queryByTestId('today-pending-offer-withdraw')
    ).toBeNull();
  });

  // WP-G. The nudge is for the middle of the offer's life: not the day it
  // was sent (nobody has had a chance to read it), and never while she is
  // standing in the house unable to clock in — at that point the fix is to
  // change the terms, not to ask again more politely.
  it('offers the nudge once the offer has been waiting, and once it is stale', () => {
    for (const daysAgo of [3, 10]) {
      mockItems = [offer(daysAgo)];
      expect(
        renderPinned().getByTestId('today-pending-offer-remind')
      ).toBeTruthy();
    }
  });

  it('never on the day it was sent', () => {
    mockItems = [offer(0)];

    expect(
      renderPinned().queryByTestId('today-pending-offer-remind')
    ).toBeNull();
  });

  it('never on a blocking offer — asking again does not open her clock', () => {
    mockItems = [offer(12)];
    mockShifts = [SHIFT_TODAY];

    expect(
      renderPinned().queryByTestId('today-pending-offer-remind')
    ).toBeNull();
  });

  it('nudges through the mutation', () => {
    mockItems = [offer(3)];

    fireEvent.press(renderPinned().getByTestId('today-pending-offer-remind'));

    expect(mockRemind).toHaveBeenCalled();
  });

  it('trades the button for the dated fact once one has gone', () => {
    mockItems = [offer(3)];
    mockRemindData = { reminded_at: '2026-08-24T09:00:00.000Z' };

    const tree = renderPinned();

    expect(tree.queryByTestId('today-pending-offer-remind')).toBeNull();
    expect(
      tree.getByTestId('today-pending-offer-reminded').props.children
    ).toBe('pendingOfferCard.reminded({"date":"24 Aug"})');
  });

  it('answers a too-soon refusal inline, and never claims one was sent', () => {
    mockItems = [offer(3)];
    mockRemindTooSoon = true;

    const tree = renderPinned();

    expect(
      tree.getByTestId('today-pending-offer-remind-too-soon').props.children
    ).toBe('pendingOfferCard.remindTooSoon');
    expect(tree.queryByTestId('today-pending-offer-reminded')).toBeNull();
  });

  it('withdraws through the mutation, never in place', () => {
    mockItems = [offer(12)];

    fireEvent.press(renderPinned().getByTestId('today-pending-offer-withdraw'));

    expect(mockWithdraw).toHaveBeenCalled();
  });
});

/** Walk children in tree order; skip the node's own testID. */
function leadingTestId(node: {
  props: { children?: unknown };
}): string | undefined {
  const walk = (n: unknown): string | undefined => {
    if (!n || typeof n !== 'object') return undefined;
    const el = n as { props?: { testID?: string; children?: unknown } };
    if (el.props?.testID) return el.props.testID;
    const kids = Array.isArray(el.props?.children)
      ? el.props.children
      : el.props?.children != null
        ? [el.props.children]
        : [];
    for (const kid of kids) {
      const id = walk(kid);
      if (id) return id;
    }
    return undefined;
  };
  const kids = Array.isArray(node.props.children)
    ? node.props.children
    : node.props.children != null
      ? [node.props.children]
      : [];
  for (const kid of kids) {
    const id = walk(kid);
    if (id) return id;
  }
  return undefined;
}

describe('PendingOfferCard — person', () => {
  it('leads with the carer avatar', () => {
    const tree = renderPinned();
    const card = tree.getByTestId('today-pending-offer-card');
    const avatar = tree.getByTestId('today-pending-offer-avatar');

    expect(leadingTestId(card)).toBe('today-pending-offer-avatar');
    expect(avatar.props.accessibilityLabel).toBe('Marisol');
    expect(tree.getByTestId('today-pending-offer-title')).toBeTruthy();
  });
});

describe('PendingOfferCard — when it does not mount', () => {
  it('renders nothing with no sent offer', () => {
    mockItems = [];

    expect(renderPinned().queryByTestId('today-pending-offer-card')).toBeNull();
  });

  // The nanny-author variant is deferred: her side of "I sent terms and they
  // haven't answered" is already the `youSent` blocked card, and a second
  // card saying the same thing is the collision the slot exists to end.
  it('renders nothing for a nanny, even on her own sent offer', () => {
    mockRole = 'nanny';

    expect(renderPinned().queryByTestId('today-pending-offer-card')).toBeNull();
  });

  it('renders nothing for a helper — a helper sends no terms', () => {
    mockRole = 'helper';

    expect(renderPinned().queryByTestId('today-pending-offer-card')).toBeNull();
  });

  // Today is SCOPED to the picked household (A2); another family's offer
  // belongs on that family's Today, reached through the switcher.
  it('renders nothing for an offer in another household', () => {
    mockItems = [{ ...offer(3), householdId: 'other-hh' } as InboxItem];

    expect(renderPinned().queryByTestId('today-pending-offer-card')).toBeNull();
  });
});
