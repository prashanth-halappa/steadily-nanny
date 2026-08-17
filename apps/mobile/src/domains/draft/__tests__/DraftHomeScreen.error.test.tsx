/**
 * @module domains/draft/__tests__/DraftHomeScreen.error
 *
 * C7 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): `proposalQuery.isError`
 * used to fall through the same `?? null` as "no terms written yet", so a
 * dropped connection told her "you need to write terms first" over terms
 * she already wrote. A failed read must say so, not guess.
 *
 * Sweep (§B): `invitesQuery.isError` fell through the same `?? []` as
 * "never sent" — the "Sent to" section's own comment says it goes ABSENT,
 * NOT empty-stated, when unsent, and a failed read is neither.
 */
import { describe, expect, it, mock } from 'bun:test';
import { renderWithProviders } from '@/src/test-utils';
import { draftHousehold } from './fixtures';

let proposalIsError = false;
let invitesIsError = false;
const refetchInvites = mock();

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
    data: undefined,
    isPending: false,
    isError: invitesIsError,
    refetch: refetchInvites,
  }),
  useDraftProposal: () => ({
    data: undefined,
    isPending: false,
    isError: proposalIsError,
  }),
  useArchiveDraft: () => ({ mutate: mock(), isPending: false, isError: false }),
}));

const { DraftHomeScreen } = await import('../components/DraftHomeScreen');

describe('DraftHomeScreen — a failed terms read (C7)', () => {
  it('shows the "couldn\'t check" hint, never the "write terms first" hint, on isError', () => {
    proposalIsError = true;
    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-share-couldnt-check-terms')).toBeTruthy();
    expect(queryByTestId('draft-share-needs-terms')).toBeNull();
  });

  it('keeps the share button disabled on a failed terms read', () => {
    proposalIsError = true;
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(getByTestId('draft-share-button').props.disabled).toBe(true);
  });

  it('shows the ordinary "write terms first" hint on genuine (non-error) empty terms', () => {
    proposalIsError = false;
    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-share-needs-terms')).toBeTruthy();
    expect(queryByTestId('draft-share-couldnt-check-terms')).toBeNull();
  });
});

describe('DraftHomeScreen — a failed invites read (sweep, §B)', () => {
  it('shows a retry, never silently drops the "Sent to" section', () => {
    invitesIsError = true;
    const { getByTestId, queryByTestId } = renderWithProviders(
      <DraftHomeScreen />
    );

    expect(getByTestId('draft-sent-to-retry')).toBeTruthy();
    expect(queryByTestId('draft-sent-to')).toBeNull();
  });

  it('wires the retry to the invites query', () => {
    invitesIsError = true;
    refetchInvites.mockClear();
    const { getByTestId } = renderWithProviders(<DraftHomeScreen />);

    getByTestId('draft-sent-to-retry-button').props.onPress?.();
    expect(refetchInvites).toHaveBeenCalledTimes(1);
  });

  it('renders neither section on genuine (non-error) "never sent"', () => {
    invitesIsError = false;
    const { queryByTestId } = renderWithProviders(<DraftHomeScreen />);

    expect(queryByTestId('draft-sent-to')).toBeNull();
    expect(queryByTestId('draft-sent-to-retry')).toBeNull();
  });
});
