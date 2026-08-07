/**
 * @module hooks/queries/__tests__/useActiveHousehold.test
 * Covers: Wave B — a nanny in multiple households can pick which one is
 * "active", the preference survives across the household list re-resolving,
 * and a stale/missing preference falls back to the first household (which is
 * also exactly what a single-household parent already saw).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_A = {
  id: 'household-a',
  name: 'The Reyes Household',
} as Household;
const HOUSEHOLD_B = {
  id: 'household-b',
  name: 'The Chen Household',
} as Household;

const HOUSEHOLD_PAST = {
  id: 'household-past',
  name: 'The Okonjo Household',
} as Household;

const householdsListMock = mock(() => Promise.resolve([] as unknown[]));
const householdsListPastMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdsListMock, listPast: householdsListPastMock },
}));

let useActiveHousehold: typeof import('../useActiveHousehold').useActiveHousehold;
let useActiveHouseholdStore: typeof import('@/src/store/activeHousehold').useActiveHouseholdStore;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useActiveHousehold = (await import('../useActiveHousehold'))
    .useActiveHousehold;
  useActiveHouseholdStore = (await import('@/src/store/activeHousehold'))
    .useActiveHouseholdStore;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  householdsListMock.mockReset();
  householdsListMock.mockResolvedValue([]);
  householdsListPastMock.mockReset();
  householdsListPastMock.mockResolvedValue([]);
  useActiveHouseholdStore.getState().reset();
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useActiveHousehold', () => {
  it('is loading with no household while households are in flight', () => {
    householdsListMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.household).toBeNull();
    expect(result.current.householdId).toBeNull();
  });

  it('falls back to the first household when there is no preference yet', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_B]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.householdId).toBe('household-a'));
    expect(result.current.household).toEqual(HOUSEHOLD_A);
    expect(result.current.households).toEqual([HOUSEHOLD_A, HOUSEHOLD_B]);
  });

  it('a single-household parent gets that one household — same as before', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.householdId).toBe('household-a'));
  });

  it('falls back to the first household when the preferred id is no longer in the list', async () => {
    useActiveHouseholdStore
      .getState()
      .setPreferredHouseholdId('household-gone');
    householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_B]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.householdId).toBe('household-a'));
  });

  it('honors a valid persisted preference over the first household', async () => {
    useActiveHouseholdStore.getState().setPreferredHouseholdId('household-b');
    householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_B]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.householdId).toBe('household-b'));
    expect(result.current.household).toEqual(HOUSEHOLD_B);
  });

  it('switching updates the resolved household + persists the preference', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_B]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.householdId).toBe('household-a'));

    act(() => {
      result.current.setActiveHouseholdId('household-b');
    });

    await waitFor(() => expect(result.current.householdId).toBe('household-b'));
    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBe(
      'household-b'
    );
  });

  it('exposes past households separately and never inside the active list', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);
    householdsListPastMock.mockResolvedValue([HOUSEHOLD_PAST]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() =>
      expect(result.current.pastHouseholds).toEqual([HOUSEHOLD_PAST])
    );
    expect(result.current.households).toEqual([HOUSEHOLD_A]);
    expect(result.current.householdId).toBe('household-a');
    expect(result.current.isPastHousehold).toBe(false);
  });

  it('resolves a past household when it is the persisted preference, flagged as past', async () => {
    useActiveHouseholdStore
      .getState()
      .setPreferredHouseholdId('household-past');
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);
    householdsListPastMock.mockResolvedValue([HOUSEHOLD_PAST]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.isPastHousehold).toBe(true));
    expect(result.current.householdId).toBe('household-past');
    expect(result.current.household).toEqual(HOUSEHOLD_PAST);
  });

  // A nanny removed from the only family she worked for has NO active
  // household. Resolving to null would leave the hours she is owed with no
  // screen to render on.
  it('falls back to a past household when the user has no active ones left', async () => {
    householdsListMock.mockResolvedValue([]);
    householdsListPastMock.mockResolvedValue([HOUSEHOLD_PAST]);

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() =>
      expect(result.current.householdId).toBe('household-past')
    );
    expect(result.current.isPastHousehold).toBe(true);
  });

  // The past list is a bonus surface; the live app must not go down with it.
  it('degrades to no past households when that query fails, leaving the active experience intact', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);
    householdsListPastMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.householdId).toBe('household-a'));
    expect(result.current.pastHouseholds).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('surfaces isError when the households list query fails', async () => {
    householdsListMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHookWithProviders(() => useActiveHousehold());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.households).toEqual([]);
  });
});
