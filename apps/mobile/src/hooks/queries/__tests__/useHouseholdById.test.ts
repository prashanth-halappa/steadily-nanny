/**
 * @module hooks/queries/__tests__/useHouseholdById.test
 * Covers: Pattern A's shared resolver — `useHouseholdById` (single id) and
 * `useHouseholdLookup` (map + per-id accessors), both sourced from
 * `useActiveHousehold`'s households/pastHouseholds lists.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_A = {
  id: 'household-a',
  name: 'The Reyes Household',
  timezone: 'America/New_York',
  currency: 'USD',
} as Household;
const HOUSEHOLD_B = {
  id: 'household-b',
  name: 'The Chen Household',
  timezone: 'Europe/London',
  currency: 'GBP',
} as Household;
const HOUSEHOLD_PAST = {
  id: 'household-past',
  name: 'The Okonjo Household',
  timezone: 'Africa/Lagos',
  currency: 'NGN',
} as Household;
const HOUSEHOLD_DRAFT = {
  id: 'household-draft',
  name: null,
  timezone: 'America/New_York',
  currency: 'USD',
} as Household;

const householdsListMock = mock(() => Promise.resolve([] as unknown[]));
const householdsListPastMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdsListMock, listPast: householdsListPastMock },
}));

let useHouseholdById: typeof import('../useHouseholdById').useHouseholdById;
let useHouseholdLookup: typeof import('../useHouseholdById').useHouseholdLookup;
let useActiveHouseholdStore: typeof import('@/src/store/activeHousehold').useActiveHouseholdStore;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  ({ useHouseholdById, useHouseholdLookup } = await import(
    '../useHouseholdById'
  ));
  useActiveHouseholdStore = (await import('@/src/store/activeHousehold'))
    .useActiveHouseholdStore;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  householdsListMock.mockReset();
  householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_B]);
  householdsListPastMock.mockReset();
  householdsListPastMock.mockResolvedValue([HOUSEHOLD_PAST]);
  useActiveHouseholdStore.getState().reset();
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useHouseholdById', () => {
  it('resolves an id from the active households list', async () => {
    const { result } = renderHookWithProviders(() =>
      useHouseholdById('household-b')
    );

    await waitFor(() => expect(result.current.household).toEqual(HOUSEHOLD_B));
    expect(result.current.notMember).toBe(false);
  });

  it('resolves an id from pastHouseholds when not in the active list', async () => {
    const { result } = renderHookWithProviders(() =>
      useHouseholdById('household-past')
    );

    await waitFor(() =>
      expect(result.current.household).toEqual(HOUSEHOLD_PAST)
    );
    expect(result.current.notMember).toBe(false);
  });

  it('notMember is true once loaded, id given, and found in neither list', async () => {
    const { result } = renderHookWithProviders(() =>
      useHouseholdById('household-stranger')
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.household).toBeNull();
    expect(result.current.notMember).toBe(true);
  });

  it('is loading with no verdict while the households query is in flight', () => {
    householdsListMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHookWithProviders(() =>
      useHouseholdById('household-a')
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.household).toBeNull();
    expect(result.current.notMember).toBe(false);
  });

  it('null/undefined id never resolves and is never notMember', async () => {
    const { result } = renderHookWithProviders(() => useHouseholdById(null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.household).toBeNull();
    expect(result.current.notMember).toBe(false);
  });

  it('surfaces isError when the households query fails', async () => {
    householdsListMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHookWithProviders(() =>
      useHouseholdById('household-a')
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.notMember).toBe(false);
  });
});

describe('useHouseholdLookup', () => {
  it('byId maps every active and past household', async () => {
    const { result } = renderHookWithProviders(() => useHouseholdLookup());

    await waitFor(() => expect(result.current.byId.size).toBe(3));
    expect(result.current.byId.get('household-b')).toEqual(HOUSEHOLD_B);
    expect(result.current.byId.get('household-past')).toEqual(HOUSEHOLD_PAST);
  });

  it('timeZoneFor resolves the NAMED household, not the active one', async () => {
    const { result } = renderHookWithProviders(() => useHouseholdLookup());

    await waitFor(() => expect(result.current.byId.size).toBe(3));
    // Active household defaults to household-a (first in list); household-b's
    // own zone must win regardless.
    expect(result.current.timeZoneFor('household-b')).toBe('Europe/London');
  });

  it("timeZoneFor falls back to the active household's zone, then UTC", async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);
    householdsListPastMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useHouseholdLookup());
    await waitFor(() => expect(result.current.byId.size).toBe(1));

    expect(result.current.timeZoneFor('household-unknown')).toBe(
      'America/New_York'
    );
    expect(result.current.timeZoneFor(null)).toBe('America/New_York');

    householdsListMock.mockResolvedValue([]);
    householdsListPastMock.mockResolvedValue([]);
    const { result: emptyResult } = renderHookWithProviders(() =>
      useHouseholdLookup()
    );
    await waitFor(() =>
      expect(emptyResult.current.timeZoneFor(null)).toBe('UTC')
    );
  });

  it('nameFor returns null for a draft household with no name yet, and for an unknown id', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_DRAFT]);

    const { result } = renderHookWithProviders(() => useHouseholdLookup());
    await waitFor(() => expect(result.current.byId.size).toBe(3));

    expect(result.current.nameFor('household-a')).toBe('The Reyes Household');
    expect(result.current.nameFor('household-draft')).toBeNull();
    expect(result.current.nameFor('household-unknown')).toBeNull();
  });

  it('currencyFor resolves the named household, undefined when unknown', async () => {
    const { result } = renderHookWithProviders(() => useHouseholdLookup());
    await waitFor(() => expect(result.current.byId.size).toBe(3));

    expect(result.current.currencyFor('household-b')).toBe('GBP');
    expect(result.current.currencyFor('household-unknown')).toBeUndefined();
  });
});
