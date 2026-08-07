/**
 * @module hooks/mutations/__tests__/useWithdrawChangeRequest.test
 *
 * Requester-only withdraw of a still-pending change request: POSTs via
 * changeRequestApi.withdraw, invalidates shift caches, shows a toast.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

const withdrawnRequest = {
  id: REQUEST_ID,
  shift_id: SHIFT_ID,
  requested_by: '33333333-3333-4333-8333-333333333333',
  kind: 'cancel',
  proposed_starts_at: null,
  proposed_ends_at: null,
  message: null,
  response_message: null,
  status: 'withdrawn',
  responded_by: null,
  responded_at: null,
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
};

const withdrawMock = mock(() => Promise.resolve(withdrawnRequest));
const showErrorToastMock = mock(() => {});
const showSuccessToastMock = mock(() => {});
const requestCalendarSyncMock = mock(() => {});

mock.module('@/src/api/endpoints/changeRequests', () => ({
  changeRequestApi: { withdraw: withdrawMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));
mock.module('@/src/domains/schedule/hooks/useCalendarSync', () => ({
  requestCalendarSync: requestCalendarSyncMock,
}));

let useWithdrawChangeRequest: typeof import('../useWithdrawChangeRequest').useWithdrawChangeRequest;

beforeEach(async () => {
  withdrawMock.mockReset();
  withdrawMock.mockImplementation(() => Promise.resolve(withdrawnRequest));
  showErrorToastMock.mockReset();
  showSuccessToastMock.mockReset();
  requestCalendarSyncMock.mockReset();
  useWithdrawChangeRequest = (await import('../useWithdrawChangeRequest'))
    .useWithdrawChangeRequest;
});

describe('useWithdrawChangeRequest', () => {
  it('calls changeRequestApi.withdraw with the changeRequestId', async () => {
    const { result } = renderHookWithProviders(() =>
      useWithdrawChangeRequest()
    );

    await act(async () => {
      await result.current.mutateAsync(REQUEST_ID);
    });

    expect(withdrawMock).toHaveBeenCalledWith(REQUEST_ID);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates shift + me caches on success', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;

    const { result } = renderHookWithProviders(
      () => useWithdrawChangeRequest(),
      { queryClient: client }
    );

    await act(async () => {
      await result.current.mutateAsync(REQUEST_ID);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.shift.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.me.all,
    });
  });

  it('shows a toast on success', async () => {
    const { result } = renderHookWithProviders(() =>
      useWithdrawChangeRequest()
    );

    await act(async () => {
      await result.current.mutateAsync(REQUEST_ID);
    });

    expect(showSuccessToastMock).toHaveBeenCalled();
  });

  it('shows an error toast on failure', async () => {
    withdrawMock.mockImplementation(() =>
      Promise.reject(new Error('not pending'))
    );
    const { result } = renderHookWithProviders(() =>
      useWithdrawChangeRequest()
    );

    await act(async () => {
      await result.current.mutateAsync(REQUEST_ID).catch(() => {});
    });

    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());
  });
});
