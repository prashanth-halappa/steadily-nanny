/**
 * @module domains/draft/__tests__/DraftHomeScreen.states
 *
 * §12's loading and offline rows.
 *
 * The hero band needs no network, so it renders immediately and the skeleton
 * sits below it — a screen that blanks entirely while a query resolves tells
 * the user nothing. Each skeleton matches the RUNG it becomes
 * (`docs/design/00-FOUNDATIONS.md`); a white card standing in for a tinted L1 makes the
 * loaded state visibly jump.
 *
 * Offline, Share is disabled. Never mint a code optimistically — a code that
 * does not exist on the server is worse than no code.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderWithProviders } from '@/src/test-utils';
import { draftHousehold, draftProposal, liveHousehold } from './fixtures';

let isOnline = true;
let invitesPending = false;
let proposalPending = false;
let households = [draftHousehold];

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: draftHousehold,
    householdId: draftHousehold.id,
    households,
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
    data: invitesPending ? undefined : [],
    isPending: invitesPending,
    isError: false,
  }),
  useDraftProposal: () => ({
    data: proposalPending ? undefined : draftProposal,
    isPending: proposalPending,
    isError: false,
  }),
  useArchiveDraft: () => ({ mutate: mock(), isPending: false, isError: false }),
}));

const { DraftHomeScreen } = await import('../components/DraftHomeScreen');

describe('DraftHomeScreen — loading', () => {
  beforeEach(() => {
    isOnline = true;
    invitesPending = false;
    proposalPending = false;
    households = [draftHousehold];
  });

  it('renders the hero band immediately — it needs no network', () => {
    proposalPending = true;
    invitesPending = true;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-hero-title')).toBeTruthy();
    expect(getByTestId('draft-hero-art')).toBeTruthy();
  });

  it('stands in with skeletons shaped like the rungs they become', () => {
    proposalPending = true;
    invitesPending = true;
    const { getByTestId, getAllByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-skeleton-l1')).toBeTruthy();
    expect(getAllByTestId('draft-skeleton-l3')).toHaveLength(2);
    expect(getAllByTestId('draft-skeleton-l4')).toHaveLength(2);
  });

  it('does not render the real cards while the skeleton is up', () => {
    proposalPending = true;
    invitesPending = true;
    const { queryByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(queryByTestId('draft-terms-card')).toBeNull();
    expect(queryByTestId('draft-share-card-l1')).toBeNull();
  });
});

describe('DraftHomeScreen — offline', () => {
  beforeEach(() => {
    isOnline = true;
    invitesPending = false;
    proposalPending = false;
    households = [draftHousehold];
  });

  it('puts the banner above the hero band and disables Share', () => {
    isOnline = false;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('offline-banner')).toBeTruthy();
    expect(getByTestId('draft-share-button').props.disabled).toBe(true);
    expect(getByTestId('draft-share-offline')).toBeTruthy();
  });

  it('still renders the terms she already has, from cache', () => {
    isOnline = false;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-terms-card')).toBeTruthy();
  });

  it('shows no offline hint and an enabled Share when connected', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(queryByTestId('draft-share-offline')).toBeNull();
    expect(getByTestId('draft-share-button').props.disabled).toBe(false);
  });
});

describe('DraftHomeScreen — household switcher (B3)', () => {
  beforeEach(() => {
    isOnline = true;
    invitesPending = false;
    proposalPending = false;
    households = [draftHousehold];
  });

  it('renders the household switcher when she also belongs to a live family', () => {
    households = [draftHousehold, liveHousehold];
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('household-switcher')).toBeTruthy();
  });

  it('does not render the household switcher when the draft is her only household', () => {
    const { queryByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(queryByTestId('household-switcher')).toBeNull();
  });
});
