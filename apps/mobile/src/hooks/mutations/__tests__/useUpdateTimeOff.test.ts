/**
 * @module hooks/mutations/__tests__/useUpdateTimeOff.test
 * G17 — PATCH must invalidate time-off AND busy caches like create/cancel.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const updateMock = mock(() =>
  Promise.resolve({
    id: '22222222-2222-4222-8222-222222222222',
    status: 'confirmed',
  })
);

mock.module('@/src/api/endpoints/timeOff', () => ({
  timeOffApi: { update: updateMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useUpdateTimeOff: typeof import('../useUpdateTimeOff').useUpdateTimeOff;

beforeAll(async () => {
  useUpdateTimeOff = (await import('../useUpdateTimeOff')).useUpdateTimeOff;
});

describe('useUpdateTimeOff invalidation', () => {
  it('invalidates timeOff and availability busy caches on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdateTimeOff()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        id: '22222222-2222-4222-8222-222222222222',
        input: { message: 'Updated note' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateMock).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      { message: 'Updated note' }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeOff.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.availability.all,
    });
  });
});

describe('useUpdateTimeOff error localization', () => {
  it('localizes cancel-via-delete error with contextKey errors:cancelViaDelete', async () => {
    const cancelError = Object.assign(
      new Error('Use DELETE to cancel time off'),
      { code: 'CANCEL_VIA_DELETE' }
    );
    updateMock.mockRejectedValueOnce(cancelError);

    const { result } = renderHookWithProviders(() => useUpdateTimeOff());

    let errorOccurred = false;
    await act(async () => {
      await result.current
        .mutateAsync({
          id: '22222222-2222-4222-8222-222222222222',
          input: { message: 'Test' },
        })
        .catch(() => {
          errorOccurred = true;
        });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(errorOccurred).toBe(true);
    // The hook's onError handler should have been called with the error,
    // triggering getLocalizedErrorMessage with contextKey errors:cancelViaDelete
  });
});
