/**
 * @module hooks/mutations/__tests__/useCreateHousehold.test
 *
 * P4.1 — killing the onboarding waterfall. Every household-scoped query
 * (`useChildren`, `useHouseholdMembers`, `useHouseholdTimesheets`) is
 * `enabled` on `useActiveHousehold`'s id, which only exists once
 * `queryKeys.household.list()` has data. Invalidating that key (the old
 * behaviour) makes wave-two queries wait for a SECOND round trip after the
 * household is created; seeding it with the mutation's own response lets
 * them enable on the same tick. The seed must be a `Household[]`, matching
 * what `useHouseholds` reads off this exact key — a mismatched shape would
 * render wrong data rather than no data.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

// The shared test harness defaults to `gcTime: 0` (no gc leakage between
// tests), which garbage-collects an unobserved query almost immediately —
// exactly what `setQueryData` creates here, since nothing in this file
// mounts a `useHouseholds()` observer. A longer gcTime is needed to read the
// seeded cache back out after the mutation settles.
function buildQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 5000 },
      mutations: { retry: false },
    },
  });
}

const NEW_HOUSEHOLD: Household = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'The Okafors',
  timezone: 'America/New_York',
  week_starts_on: 1,
  state: 'live',
} as Household;

const createMock = mock(() => Promise.resolve(NEW_HOUSEHOLD));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { create: createMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));
mock.module('@/src/store/setupProgress', () => ({
  useSetupProgressStore: (
    selector: (s: { setHouseholdId: () => void }) => unknown
  ) => selector({ setHouseholdId: () => {} }),
}));

let useCreateHousehold: typeof import('../useCreateHousehold').useCreateHousehold;

beforeAll(async () => {
  useCreateHousehold = (await import('../useCreateHousehold'))
    .useCreateHousehold;
});

describe('useCreateHousehold — seeds the households list cache (P4.1)', () => {
  it('seeds household.list() with the created household so wave-two queries enable on the same tick', async () => {
    const { result, queryClient } = renderHookWithProviders(
      () => useCreateHousehold(),
      { queryClient: buildQueryClient() }
    );

    await act(async () => {
      await result.current.mutateAsync({
        name: 'The Okafors',
        timezone: 'America/New_York',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const seeded = queryClient.getQueryData(queryKeys.household.list());
    expect(seeded).toEqual([NEW_HOUSEHOLD]);
  });

  it('appends to, rather than clobbers, an existing cached households list', async () => {
    const existing: Household = {
      ...NEW_HOUSEHOLD,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'The Smiths',
    };
    const { result, queryClient } = renderHookWithProviders(
      () => useCreateHousehold(),
      { queryClient: buildQueryClient() }
    );
    queryClient.setQueryData(queryKeys.household.list(), [existing]);

    await act(async () => {
      await result.current.mutateAsync({
        name: 'The Okafors',
        timezone: 'America/New_York',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const seeded = queryClient.getQueryData(queryKeys.household.list());
    expect(seeded).toEqual([existing, NEW_HOUSEHOLD]);
  });

  it('invalidates user.memberships() after success so onboarding role refetches immediately', async () => {
    const { result, queryClient } = renderHookWithProviders(
      () => useCreateHousehold(),
      { queryClient: buildQueryClient() }
    );
    const invalidateQueriesSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        name: 'The Okafors',
        timezone: 'America/New_York',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.user.memberships(),
    });
  });
});
