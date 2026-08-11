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
import { renderWithProviders } from '@/src/test-utils';
import { draftHousehold, draftProposal, makeInvite } from './fixtures';

let invites: ReturnType<typeof makeInvite>[] = [];

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
mock.module('@/src/lib/network', () => ({ useIsOnline: () => true }));
mock.module('../hooks/draftQueries', () => ({
  useDraftInvites: () => ({
    data: invites,
    isPending: false,
    isError: false,
  }),
  useDraftProposal: () => ({
    data: draftProposal,
    isPending: false,
    isError: false,
  }),
  useArchiveDraft: () => ({ mutate: mock(), isPending: false, isError: false }),
}));

const { DraftHomeScreen } = await import('../components/DraftHomeScreen');

describe('DraftHomeScreen — the L1 slot', () => {
  beforeEach(() => {
    invites = [];
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
});
