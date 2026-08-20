/**
 * @module domains/inbox/__tests__/TermsProposalCard.test
 *
 * §7.1 / B3: `terms_proposal` has exactly ONE owner on Today — this card.
 * `NeedsAttentionCard` filters the kind out; this file pins that the
 * dedicated card renders when a proposal is pending, deep-links (never
 * resolves in place), and wears the attention tone ONLY inside `PinnedSlot`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { PinnedSlot } from '@/src/domains/today/components/PinnedSlot';
import { palette } from '~/lib/design-tokens/palette';
import type { InboxItem } from '../utils/buildInboxItems';

const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;

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

const OTHER_HOUSEHOLD_TERMS_PROPOSAL: InboxItem = {
  ...TERMS_PROPOSAL,
  id: 'prop-2',
  householdId: 'hh-2',
};

const CHANGE_REQUEST: InboxItem = {
  kind: 'change_request',
  id: 'cr-1',
  shiftId: 'shift-1',
  requestKind: 'time_change',
  requestedAt: '2026-08-08T09:00:00.000Z',
  requesterName: null,
  shiftStartsAt: null,
};

let TermsProposalCard: typeof import('../components/TermsProposalCard').TermsProposalCard;
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
      household: { id: 'hh-1', name: 'Household One', timezone: 'UTC' },
      householdId: 'hh-1',
      households: [{ id: 'hh-1', name: 'Household One', timezone: 'UTC' }],
      pastHouseholds: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    }),
  }));

  const mod = await import('../components/TermsProposalCard');
  TermsProposalCard = mod.TermsProposalCard;
});

beforeEach(() => {
  mockPush.mockClear?.();
  setItems([]);
});

describe('TermsProposalCard', () => {
  it('renders nothing when there is no terms proposal', () => {
    setItems([CHANGE_REQUEST]);

    const { queryByTestId } = render(<TermsProposalCard />);

    expect(queryByTestId('today-terms-proposal-card')).toBeNull();
  });

  it('renders nothing while inbox is loading', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [TERMS_PROPOSAL],
      isLoading: true,
      isError: false,
      refetch: mock(),
    }));

    const { queryByTestId } = render(<TermsProposalCard />);

    expect(queryByTestId('today-terms-proposal-card')).toBeNull();
  });

  it('renders on the T1 attention-toned ground inside the pinned slot', () => {
    setItems([TERMS_PROPOSAL]);

    const { getByTestId } = render(
      <PinnedSlot>
        <TermsProposalCard />
      </PinnedSlot>
    );

    const card = getByTestId('today-terms-proposal-card');
    const styleArray = [card.props.style].flat();
    expect(
      styleArray.some(
        s =>
          s && typeof s === 'object' && s.backgroundColor === SURFACE_ATTENTION
      )
    ).toBe(true);
  });

  it('uses inbox copy for headline, subtitle, and CTA', () => {
    setItems([TERMS_PROPOSAL]);

    const { getByText } = render(<TermsProposalCard />);

    expect(getByText(/items\.termsProposal\.title/)).toBeTruthy();
    expect(getByText(/items\.termsProposal\.subtitle/)).toBeTruthy();
    expect(getByText('items.termsProposal.cta')).toBeTruthy();
  });

  it('deep-links the CTA to the proposal review screen — never resolves in place', () => {
    setItems([TERMS_PROPOSAL]);

    const { getByTestId } = render(<TermsProposalCard />);
    fireEvent.press(getByTestId('today-terms-proposal-cta'));

    expect(mockPush).toHaveBeenCalledWith('/(private)/pay/proposal/prop-1');
  });

  // `demoted` is deleted — the feed mount is simply outside the slot.
  it('renders at default tone in the feed while keeping content and CTA', () => {
    setItems([TERMS_PROPOSAL]);

    const { getByTestId } = render(<TermsProposalCard />);

    const card = getByTestId('today-terms-proposal-card');
    const styleArray = [card.props.style].flat();
    expect(
      styleArray.some(s => s && typeof s === 'object' && 'backgroundColor' in s)
    ).toBe(false);
    expect(getByTestId('today-terms-proposal-cta')).toBeTruthy();
  });

  // Rule M / L1 body: mutedStrong on the pinned attention mount; L3 feed
  // keeps mutedForeground. An unconditional swap would break the feed.
  it('uses mutedStrong body on attention tone and mutedForeground on default', () => {
    setItems([TERMS_PROPOSAL]);

    const pinned = render(
      <PinnedSlot>
        <TermsProposalCard />
      </PinnedSlot>
    );
    const pinnedBody = pinned.getByText(/items\.termsProposal\.subtitle/);
    expect(pinnedBody.props.className).toContain('text-muted-strong');
    expect(pinnedBody.props.className).not.toContain('text-muted-foreground');
    pinned.unmount();

    const feed = render(<TermsProposalCard />);
    const feedBody = feed.getByText(/items\.termsProposal\.subtitle/);
    expect(feedBody.props.className).toContain('text-muted-foreground');
    expect(feedBody.props.className).not.toContain('text-muted-strong');
  });

  // Pattern A (render-time, inverse of the mislabel): this card sits on the
  // ACTIVE household's Today, so a proposal from her OTHER family must never
  // pin here — that is that family's own Today's job, reached by switching.
  it('renders nothing when the only terms proposal belongs to a different household', () => {
    setItems([OTHER_HOUSEHOLD_TERMS_PROPOSAL]);

    const { queryByTestId } = render(<TermsProposalCard />);

    expect(queryByTestId('today-terms-proposal-card')).toBeNull();
  });

  it('shows only the ACTIVE household proposal when both households have one pending', () => {
    setItems([OTHER_HOUSEHOLD_TERMS_PROPOSAL, TERMS_PROPOSAL]);

    const { getByTestId } = render(<TermsProposalCard />);

    expect(getByTestId('today-terms-proposal-card')).toBeTruthy();
  });

  // Regression: terms_proposal is owned HERE, not in NeedsAttentionCard.
  it('shows the first terms proposal even when other inbox kinds are present', () => {
    setItems([TERMS_PROPOSAL, CHANGE_REQUEST]);

    const { getByText, queryByText } = render(<TermsProposalCard />);

    expect(getByText(/items\.termsProposal\.title/)).toBeTruthy();
    expect(queryByText(/changeRequest/)).toBeNull();
  });
});
