/**
 * @module domains/draft/__tests__/DraftHomeScreen.l1
 *
 * §5.2's L1 transition, which is the one piece of this screen most likely to
 * be "improved" back into a permanent orange card.
 *
 * Before she has sent anything there IS one thing to do, and the share card
 * is it. The moment a code is out in the world there is nothing urgent left —
 * she is waiting on somebody else — and a card that kept shouting would be
 * manufactured urgency, which is exactly the reassurance copy
 * `screens-today.md` §7 forbids. One L1 per screen, sometimes zero.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { renderWithProviders } from '@/src/test-utils';
import { palette } from '~/lib/design-tokens/palette';
import { draftHousehold, draftProposal, makeInvite } from './fixtures';

let invites: ReturnType<typeof makeInvite>[] = [];
let proposal: TermsProposal | null = draftProposal;
let isOnline = true;

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: draftHousehold,
    householdId: draftHousehold.id,
    households: [draftHousehold],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }),
}));
mock.module('@/src/hooks/queries/useAvailability', () => ({
  useAvailability: () => ({ data: [], isPending: false, isError: false }),
}));
mock.module('@/src/hooks/mutations/useCreateInvite', () => ({
  useCreateInvite: () => ({ mutateAsync: mock(), isPending: false }),
}));
mock.module('@/src/hooks/mutations/useRevokeInvite', () => ({
  useRevokeInvite: () => ({ mutate: mock(), isPending: false, isError: false }),
}));
mock.module('@/src/lib/network', () => ({ useIsOnline: () => isOnline }));
mock.module('../hooks/draftQueries', () => ({
  useDraftInvites: () => ({
    data: invites,
    isPending: false,
    isError: false,
  }),
  useDraftProposal: () => ({
    data: proposal,
    isPending: false,
    isError: false,
  }),
  useArchiveDraft: () => ({ mutate: mock(), isPending: false, isError: false }),
}));

const { DraftHomeScreen } = await import('../components/DraftHomeScreen');

const ATTENTION_BG = palette.light.surfaceAttention.hex;

/** Detect the tinted-ground background Card applies for `tone="attention"` —
 * `tone` itself is not a DOM prop (GOLDEN-FIXES.md #33-adjacent: assert by
 * rendered style, not by class/prop). Mirrors
 * `TodayScreen.attentionArbitration.test.tsx`'s technique. */
function hasAttentionBackground(style: unknown): boolean {
  const styles = Array.isArray(style) ? style.flat() : [style];
  return styles.some(
    s =>
      !!s &&
      typeof s === 'object' &&
      (s as { backgroundColor?: string }).backgroundColor === ATTENTION_BG
  );
}

const DRAFT_CARD_TEST_IDS = [
  'draft-share-card-l1',
  'draft-share-card-l3',
  'draft-terms-card',
];

function countAttentionCards(
  queryByTestId: (id: string) => { props: { style?: unknown } } | null
): number {
  return DRAFT_CARD_TEST_IDS.filter(id => {
    const el = queryByTestId(id);
    return !!el && hasAttentionBackground(el.props.style);
  }).length;
}

describe('DraftHomeScreen — the L1 slot', () => {
  beforeEach(() => {
    invites = [];
    proposal = draftProposal;
    isOnline = true;
  });

  it('gives L1 to the share card while nothing has been sent', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-share-card-l1')).toBeTruthy();
    expect(queryByTestId('draft-share-card-l3')).toBeNull();
  });

  it('demotes the share card to L3 once one invite exists, and promotes nothing in its place', () => {
    invites = [makeInvite()];

    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(queryByTestId('draft-share-card-l1')).toBeNull();
    expect(getByTestId('draft-share-card-l3')).toBeTruthy();
    // The terms card was, and stays, L3. No card claims L1.
    expect(getByTestId('draft-terms-card')).toBeTruthy();
  });

  it('keeps sharing reachable after the demotion — she interviews with more than one family', () => {
    invites = [makeInvite()];

    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-share-button')).toBeTruthy();
  });

  it('a revoked invite still counts — the draft has been out in the world', () => {
    invites = [makeInvite({ status: 'revoked' })];

    const { queryByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(queryByTestId('draft-share-card-l1')).toBeNull();
  });

  it('renders no "Sent to" section at all when nothing has been sent', () => {
    const { queryByTestId } = renderWithProviders(<DraftHomeScreen />);

    // Not an empty state (§12): the share card IS the content, and the hero
    // band already carries this screen's one illustration.
    expect(queryByTestId('draft-sent-to')).toBeNull();
    expect(queryByTestId('draft-sent-to-empty')).toBeNull();
  });

  it('lists one row per invite once they exist', () => {
    invites = [
      makeInvite({ id: 'invite-a', label: 'The Bakers' }),
      makeInvite({ id: 'invite-b', label: 'The Ahmeds', status: 'accepted' }),
    ];

    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-sent-to')).toBeTruthy();
    expect(getByTestId('draft-invite-row-invite-a')).toBeTruthy();
    expect(getByTestId('draft-invite-row-invite-b')).toBeTruthy();
  });

  it('leads with Write my terms when she has not written any', () => {
    proposal = null;

    const { getByTestId, toJSON } = renderWithProviders(<DraftHomeScreen />);
    const tree = JSON.stringify(toJSON());

    expect(tree.indexOf('draft-terms-card')).toBeGreaterThan(-1);
    expect(tree.indexOf('draft-terms-card')).toBeLessThan(
      tree.indexOf('draft-share-card-l3')
    );
    expect(
      hasAttentionBackground(getByTestId('draft-terms-card').props.style)
    ).toBe(true);
  });

  it('demotes the share card and says why it is disabled when there are no terms', () => {
    proposal = null;

    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-share-button').props.disabled).toBe(true);
    expect(getByTestId('draft-share-needs-terms')).toBeTruthy();
    expect(
      hasAttentionBackground(getByTestId('draft-share-card-l3').props.style)
    ).toBe(false);
  });

  it('leads with the share card once terms exist and nothing has been sent', () => {
    const { getByTestId, queryByTestId, toJSON } = renderWithProviders(
      <DraftHomeScreen />
    );
    const tree = JSON.stringify(toJSON());

    expect(tree.indexOf('draft-share-card-l1')).toBeGreaterThan(-1);
    expect(tree.indexOf('draft-share-card-l1')).toBeLessThan(
      tree.indexOf('draft-terms-card')
    );
    expect(getByTestId('draft-share-button').props.disabled).toBe(false);
    expect(queryByTestId('draft-share-needs-terms')).toBeNull();
  });

  it('still explains an offline block, and shows only one reason at a time', () => {
    proposal = null;
    isOnline = false;

    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-share-offline')).toBeTruthy();
    expect(queryByTestId('draft-share-needs-terms')).toBeNull();
  });

  it('keeps the share card quiet once a code has been sent', () => {
    invites = [makeInvite()];

    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-share-card-l3')).toBeTruthy();
    expect(queryByTestId('draft-share-card-l1')).toBeNull();
    expect(
      hasAttentionBackground(getByTestId('draft-share-card-l3').props.style)
    ).toBe(false);
  });

  it('never shows two attention grounds at once', () => {
    // No terms: the terms card alone is attention-toned.
    proposal = null;
    const noTerms = renderWithProviders(<DraftHomeScreen />);
    expect(countAttentionCards(noTerms.queryByTestId)).toBe(1);
    noTerms.unmount();

    // Terms written, unsent: the share card alone is attention-toned.
    proposal = draftProposal;
    const unsent = renderWithProviders(<DraftHomeScreen />);
    expect(countAttentionCards(unsent.queryByTestId)).toBe(1);
    unsent.unmount();

    // Sent: neither card is attention-toned.
    invites = [makeInvite()];
    const sent = renderWithProviders(<DraftHomeScreen />);
    expect(countAttentionCards(sent.queryByTestId)).toBe(0);
  });
});
