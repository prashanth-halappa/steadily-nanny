/**
 * @module domains/inbox/__tests__/NeedsAttentionCard.test
 *
 * Behavioural companion to NeedsAttentionCard.source.test.ts, which only
 * greps the component's source text — deleting the `items.length === 0`
 * early return still leaves that string in the file's comments, so the
 * source scan stays green on a gutted component. This file RENDERS the card:
 * invisible-when-idle, the T1 tone (attention ONLY inside `PinnedSlot`),
 * headline/deadline/"more" copy from `inboxItemCopy.ts`, the primary CTA
 * deep-linking to the headline item, the "see all" ghost button only past
 * one item, and that `pending_pattern` is filtered out entirely — it's
 * `PendingScheduleCard`'s obligation, and double-showing/double-counting it
 * here was the Wave 1 defect this file's tests now pin against regressing.
 *
 * The global preload's `react-i18next` mock echoes the key and drops
 * interpolation, so it is re-mocked here to splice `{{count}}`/`{{when}}`
 * in — the interpolated value reaching the rendered text is under test.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { PinnedSlot } from '@/src/domains/today/components/PinnedSlot';
import { palette } from '~/lib/design-tokens/palette';
import type { InboxItem } from '../utils/buildInboxItems';

const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;

const CHANGE_REQUEST: InboxItem = {
  kind: 'change_request',
  id: 'cr-1',
  shiftId: 'shift-1',
  requestKind: 'time_change',
};

const SECOND_CHANGE_REQUEST: InboxItem = {
  kind: 'change_request',
  id: 'cr-2',
  shiftId: 'shift-2',
  requestKind: 'cancel',
};

const PENDING_PATTERN: InboxItem = {
  kind: 'pending_pattern',
  id: 'pat-1',
  patternId: 'pat-1',
  dtstart: '2026-08-10',
};

const SUBMITTED_WEEK: InboxItem = {
  kind: 'submitted_week',
  id: 'ts-1',
  weekStart: '2026-08-04',
  carerDisplayName: 'Test Nanny',
};

const QUERIED_WEEK: InboxItem = {
  kind: 'queried_week',
  id: 'ts-2',
  weekStart: '2026-07-28',
  queryNote: null,
};

const TERMS_PROPOSAL: InboxItem = {
  kind: 'terms_proposal',
  id: 'prop-1',
  householdId: 'hh-1',
  carerDisplayName: 'Marisol',
  proposedAt: '2026-08-24T09:00:00.000Z',
  direction: 'carer',
  rateMinor: 2800,
  weeklyEquivalentMinor: 154000,
  currency: 'USD',
};

const TERMS_PROPOSAL_SENT: InboxItem = {
  kind: 'terms_proposal_sent',
  id: 'prop-2',
  householdId: 'hh-1',
  carerId: 'carer-1',
  carerDisplayName: 'Marisol',
  proposedAt: '2026-08-24T09:00:00.000Z',
  viewedAt: null,
  direction: 'parent',
};

let NeedsAttentionCard: typeof import('../components/NeedsAttentionCard').NeedsAttentionCard;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

function setItems(items: InboxItem[]) {
  mockUseInboxItems.mockImplementation(() => ({
    items,
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
}

beforeAll(async () => {
  mockUseInboxItems = mock(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockPush = mock();

  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, string | number>) =>
        opts ? `${key}(${JSON.stringify(opts)})` : key,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
    // `inboxItemCopy` reaches `formatDuration`, which reads the shared i18n
    // instance, whose own module imports this. A mock that answers only
    // `useTranslation` makes that import a hard SyntaxError rather than a
    // missing translation — the whole file fails to load.
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: { timezone: 'UTC' },
      householdId: 'hh-1',
      households: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    }),
  }));

  const mod = await import('../components/NeedsAttentionCard');
  NeedsAttentionCard = mod.NeedsAttentionCard;
});

beforeEach(() => {
  mockPush.mockClear?.();
  setItems([]);
});

describe('NeedsAttentionCard', () => {
  it('renders nothing when there is no pending work', () => {
    const { queryByTestId } = render(<NeedsAttentionCard />);

    expect(queryByTestId('today-needs-attention-card')).toBeNull();
  });

  it("renders on the T1 attention-toned ground inside the pinned slot (Card's tone, not a bar)", () => {
    setItems([CHANGE_REQUEST]);

    const { getByTestId } = render(
      <PinnedSlot>
        <NeedsAttentionCard />
      </PinnedSlot>
    );

    const card = getByTestId('today-needs-attention-card');
    const styleArray = [card.props.style].flat();
    expect(
      styleArray.some(
        s =>
          s && typeof s === 'object' && s.backgroundColor === SURFACE_ATTENTION
      )
    ).toBe(true);
  });

  it("uses the first item's own sentence as the headline", () => {
    setItems([SUBMITTED_WEEK]);

    const { getByText } = render(<NeedsAttentionCard />);

    expect(
      getByText('items.submittedWeek.title({"week":"4 Aug"})')
    ).toBeTruthy();
  });

  it('renders no deadline line for inbox items', () => {
    setItems([SUBMITTED_WEEK]);

    const { queryByText } = render(<NeedsAttentionCard />);

    expect(queryByText(/deadlineLabel/)).toBeNull();
  });

  it('hides the "more" body and the "see all" button for a single item', () => {
    setItems([CHANGE_REQUEST]);

    const { queryByText, queryByTestId } = render(<NeedsAttentionCard />);

    expect(queryByText(/moreItems/)).toBeNull();
    expect(queryByTestId('today-needs-attention-see-all')).toBeNull();
  });

  it('shows the pluralised "more" body and "see all" button past one item', () => {
    setItems([CHANGE_REQUEST, SECOND_CHANGE_REQUEST]);

    const { getByText, getByTestId } = render(<NeedsAttentionCard />);

    expect(getByText('needsAttentionCard.moreItems({"count":1})')).toBeTruthy();
    expect(getByTestId('today-needs-attention-see-all')).toBeTruthy();
  });

  // A pending pattern is `PendingScheduleCard`'s obligation, not this card's
  // — same status/carer_id gate, same destination (buildInboxItems.ts:133).
  // It must not inflate the "N more" count even when it rides along with a
  // real item, or the two cards silently double-count the same thing.
  it('does not count a pending pattern toward "more items" alongside a real item', () => {
    setItems([CHANGE_REQUEST, SECOND_CHANGE_REQUEST, PENDING_PATTERN]);

    const { getByText } = render(<NeedsAttentionCard />);

    expect(getByText('needsAttentionCard.moreItems({"count":1})')).toBeTruthy();
  });

  it('deep-links the primary CTA to the headline item, not always /inbox', () => {
    setItems([CHANGE_REQUEST]);

    const { getByTestId } = render(<NeedsAttentionCard />);
    fireEvent.press(getByTestId('today-needs-attention-cta'));

    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/shifts/shift-1');
  });

  it('deep-links "see all" to /inbox', () => {
    setItems([CHANGE_REQUEST, SECOND_CHANGE_REQUEST]);

    const { getByTestId } = render(<NeedsAttentionCard />);
    fireEvent.press(getByTestId('today-needs-attention-see-all'));

    expect(mockPush).toHaveBeenCalledWith('/inbox');
  });

  it('derives the CTA label from the headline item kind', () => {
    setItems([SUBMITTED_WEEK]);

    const { getByText } = render(<NeedsAttentionCard />);

    expect(getByText('items.submittedWeek.cta')).toBeTruthy();
  });

  // Filtered out before headline selection ever runs — not special-cased
  // there — so a pattern riding with one real item never becomes the
  // headline, and never leaves a stray "more" line behind either.
  it('excludes a pending pattern from consideration entirely: headline is the other item, no "more" line', () => {
    setItems([PENDING_PATTERN, QUERIED_WEEK]);

    const { getByText, getByTestId, queryByText } = render(
      <NeedsAttentionCard />
    );

    expect(
      getByText('items.queriedWeek.title({"week":"28 Jul"})')
    ).toBeTruthy();
    expect(queryByText(/moreItems/)).toBeNull();
    fireEvent.press(getByTestId('today-needs-attention-cta'));
    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/(tabs)/hours?weekStart=2026-07-28'
    );
  });

  // PendingScheduleCard renders on the identical status/carer_id gate and
  // routes to the identical destination (schedule/respond/:id) — a sole
  // pending pattern is ALREADY shown there. Falling back to it here (the old
  // behaviour) stacked two cards for one obligation.
  it("renders nothing when the only item is a pending pattern — that's PendingScheduleCard's obligation alone", () => {
    setItems([PENDING_PATTERN]);

    const { queryByTestId } = render(<NeedsAttentionCard />);

    expect(queryByTestId('today-needs-attention-card')).toBeNull();
  });

  // §7.1 / B3: a live proposal owns Today's L1 on its own card, exactly as a
  // pending pattern owns PendingScheduleCard — so it is filtered here before
  // headline selection, and cannot double-count into "N more" either.
  it('excludes a terms proposal entirely: headline is the other item, no "more" line', () => {
    setItems([TERMS_PROPOSAL, QUERIED_WEEK]);

    const { getByText, queryByText } = render(<NeedsAttentionCard />);

    expect(
      getByText('items.queriedWeek.title({"week":"28 Jul"})')
    ).toBeTruthy();
    expect(queryByText(/moreItems/)).toBeNull();
  });

  it('renders nothing when the only item is a terms proposal — that is its own T1 card', () => {
    setItems([TERMS_PROPOSAL]);

    const { queryByTestId } = render(<NeedsAttentionCard />);

    expect(queryByTestId('today-needs-attention-card')).toBeNull();
  });

  // A7 — the author's row has `PendingOfferCard`, exactly as the answerer's
  // has `TermsProposalCard`. Same treatment for the same reason: two cards
  // about one negotiation is the collision the pinned slot exists to end,
  // and this row must not inflate "N more" either.
  it('excludes a sent-offer row entirely: headline is the other item, no "more" line', () => {
    setItems([TERMS_PROPOSAL_SENT, QUERIED_WEEK]);

    const { getByText, queryByText } = render(<NeedsAttentionCard />);

    expect(
      getByText('items.queriedWeek.title({"week":"28 Jul"})')
    ).toBeTruthy();
    expect(queryByText(/moreItems/)).toBeNull();
  });

  it('renders nothing when the only item is a sent offer — never headlines one', () => {
    setItems([TERMS_PROPOSAL_SENT]);

    const { queryByTestId } = render(<NeedsAttentionCard />);

    expect(queryByTestId('today-needs-attention-card')).toBeNull();
  });

  // `demoted` is deleted. Emphasis is a fact about WHERE the card is mounted:
  // in the feed it keeps its content and CTA on the plain ground, and only the
  // slot's single occupant may wear the attention tint.
  it('renders at default tone in the feed — no tinted ground, content and CTA still intact', () => {
    setItems([CHANGE_REQUEST]);

    const { getByTestId } = render(<NeedsAttentionCard />);

    const card = getByTestId('today-needs-attention-card');
    const styleArray = [card.props.style].flat();
    expect(
      styleArray.some(s => s && typeof s === 'object' && 'backgroundColor' in s)
    ).toBe(false);
    expect(getByTestId('today-needs-attention-cta')).toBeTruthy();
  });
});
