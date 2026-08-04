/**
 * @module hooks/mutations/__tests__/useCreateHouseholdClosure.test
 * Create + delete must invalidate the household-scoped closures list cache.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '77777777-7777-4777-8777-777777777777';

const createMock = mock(() =>
  Promise.resolve({
    id: '22222222-2222-4222-8222-222222222222',
    household_id: HOUSEHOLD_ID,
  })
);
const removeMock = mock(() => Promise.resolve(undefined));

mock.module('@/src/api/endpoints/householdClosures', () => ({
  householdClosureApi: { create: createMock, remove: removeMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useCreateHouseholdClosure: typeof import('../useCreateHouseholdClosure').useCreateHouseholdClosure;
let useDeleteHouseholdClosure: typeof import('../useDeleteHouseholdClosure').useDeleteHouseholdClosure;

beforeAll(async () => {
  useCreateHouseholdClosure = (await import('../useCreateHouseholdClosure'))
    .useCreateHouseholdClosure;
  useDeleteHouseholdClosure = (await import('../useDeleteHouseholdClosure'))
    .useDeleteHouseholdClosure;
});

describe('useCreateHouseholdClosure invalidation', () => {
  it("invalidates this household's closures list on success", async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useCreateHouseholdClosure(HOUSEHOLD_ID)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        starts_at: '2026-08-10T00:00:00.000Z',
        ends_at: '2026-08-13T00:00:00.000Z',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createMock).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      starts_at: '2026-08-10T00:00:00.000Z',
      ends_at: '2026-08-13T00:00:00.000Z',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.householdClosures.list(HOUSEHOLD_ID),
    });
  });
});

describe('useDeleteHouseholdClosure invalidation', () => {
  it("invalidates this household's closures list on success", async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useDeleteHouseholdClosure(HOUSEHOLD_ID)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('22222222-2222-4222-8222-222222222222');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(removeMock).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '22222222-2222-4222-8222-222222222222'
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.householdClosures.list(HOUSEHOLD_ID),
    });
  });
});
