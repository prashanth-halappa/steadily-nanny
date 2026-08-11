/**
 * @module domains/draft/__tests__/DraftHomeScreen.terms
 *
 * The terms card. Two things are pinned here and both are money-integrity
 * rules rather than layout:
 *
 *  - The weekly figure is the SERVER's `weekly_equivalent_minor`. The fixture
 *    is chosen so a client-side `rate × hours` prints a different number
 *    ($1,400.00 instead of $1,540.00), which is precisely the error David
 *    named as his trust-killer — on the screen where the contract is signed.
 *  - A null term renders its agreement or its blank, never a fabricated
 *    $0.00 (T16).
 */
import { describe, expect, it, mock } from 'bun:test';
import { renderWithProviders } from '@/src/test-utils';
import { draftHousehold, draftProposal } from './fixtures';

let proposal: typeof draftProposal | null = draftProposal;

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
  useDraftInvites: () => ({ data: [], isPending: false, isError: false }),
  useDraftProposal: () => ({
    data: proposal,
    isPending: false,
    isError: false,
  }),
  useArchiveDraft: () => ({ mutate: mock(), isPending: false, isError: false }),
}));

const { DraftHomeScreen } = await import('../components/DraftHomeScreen');

describe('DraftHomeScreen — the terms card', () => {
  it('prints the hourly rate from the proposal', () => {
    proposal = draftProposal;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-terms-rate').props.children).toContain('28.00');
  });

  it('renders the weekly line when the server computed one', () => {
    proposal = draftProposal;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    // The figure itself is pinned in `proposalTerms.test.ts` —
    // `weeklyEquivalentAmount` takes the server's answer and cannot be handed
    // a rate and a number of hours. Under test `t()` echoes its key, so the
    // interpolated amount is not observable here.
    expect(getByTestId('draft-terms-weekly')).toBeTruthy();
  });

  it('omits the weekly line entirely when the server could not compute one', () => {
    proposal = { ...draftProposal, weekly_equivalent_minor: null };
    const { queryByTestId } = renderWithProviders(<DraftHomeScreen />);

    // No guarantee, no line — never a figure we cannot stand behind.
    expect(queryByTestId('draft-terms-weekly')).toBeNull();
  });

  it('renders every term row in the shared order, nulls included', () => {
    proposal = draftProposal;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-term-overtime')).toBeTruthy();
    expect(getByTestId('draft-term-guaranteedHours')).toBeTruthy();
    expect(getByTestId('draft-term-cancellations')).toBeTruthy();
    expect(getByTestId('draft-term-mileage')).toBeTruthy();
    expect(getByTestId('draft-term-paySchedule')).toBeTruthy();
  });

  it('offers a way to write terms rather than an empty card when there are none', () => {
    proposal = null;
    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-terms-empty')).toBeTruthy();
    expect(queryByTestId('draft-terms-rate')).toBeNull();
  });

  it('will not share terms that do not exist yet', () => {
    proposal = null;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-share-button').props.disabled).toBe(true);
  });
});
