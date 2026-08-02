/**
 * @module hooks/mutations/__tests__/useUpdateHousehold.test
 * Covers: the household-update mutation forwards `{ householdId, input }`
 * correctly, invalidates the household query subtree on success, and
 * surfaces a failure via the standard error toast.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const updateMock = mock((householdId: string, input: unknown) =>
  Promise.resolve({ id: householdId, ...(input as object) })
);
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { update: updateMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useUpdateHousehold: typeof import('../useUpdateHousehold').useUpdateHousehold;

beforeAll(async () => {
  useUpdateHousehold = (await import('../useUpdateHousehold'))
    .useUpdateHousehold;
});

describe('useUpdateHousehold', () => {
  it('forwards householdId + input to householdApi.update', async () => {
    const { result } = renderHookWithProviders(() => useUpdateHousehold());

    await act(async () => {
      await result.current.mutateAsync({
        householdId: 'household-1',
        input: { name: 'The Reyes Household' },
      });
    });

    expect(updateMock).toHaveBeenCalledWith('household-1', {
      name: 'The Reyes Household',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates the household query subtree on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdateHousehold()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        householdId: 'household-1',
        input: { timezone: 'Asia/Tokyo' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.household.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.household.detail('household-1'),
    });
  });

  it('shows the generic error message on failure', async () => {
    updateMock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const { result } = renderHookWithProviders(() => useUpdateHousehold());

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          householdId: 'household-1',
          input: { name: 'x' },
        })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:unknown');
  });
});
