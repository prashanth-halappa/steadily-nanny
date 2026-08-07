/**
 * @module hooks/mutations/__tests__/useDeclineShift.test
 *
 * Carer decline-pending mutation: POSTs via shiftApi.decline, invalidates
 * shift + me query keys, shows a toast — mirrors useAcceptShift.test.ts.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const SHIFT_ID = '77777777-7777-4777-8777-777777777777';

const declinedShift = {
  id: SHIFT_ID,
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  starts_at: '2026-01-07T08:00:00Z',
  ends_at: '2026-01-07T13:00:00Z',
  timezone: 'Europe/London',
  local_date: '2026-01-07',
  kind: 'extra',
  status: 'declined',
  source_pattern_id: null,
  origin: 'parent_proposed',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'shift-1@steadilynanny.app',
  sequence: 0,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const declineMock = mock(() => Promise.resolve(declinedShift));
const showErrorToastMock = mock(() => {});
const showSuccessToastMock = mock(() => {});
const requestCalendarSyncMock = mock(() => {});

mock.module('@/src/api/endpoints/shifts', () => ({
  shiftApi: { decline: declineMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));
mock.module('@/src/domains/schedule/hooks/useCalendarSync', () => ({
  requestCalendarSync: requestCalendarSyncMock,
}));

let useDeclineShift: typeof import('../useDeclineShift').useDeclineShift;

beforeEach(async () => {
  declineMock.mockReset();
  declineMock.mockImplementation(() => Promise.resolve(declinedShift));
  showErrorToastMock.mockReset();
  showSuccessToastMock.mockReset();
  requestCalendarSyncMock.mockReset();
  useDeclineShift = (await import('../useDeclineShift')).useDeclineShift;
});

describe('useDeclineShift', () => {
  it('calls shiftApi.decline with the shiftId', async () => {
    const { result } = renderHookWithProviders(() => useDeclineShift());

    await act(async () => {
      await result.current.mutateAsync({ shiftId: SHIFT_ID });
    });

    expect(declineMock).toHaveBeenCalledWith(SHIFT_ID);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates shift list + detail + me caches on success', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;

    const { result } = renderHookWithProviders(() => useDeclineShift(), {
      queryClient: client,
    });

    await act(async () => {
      await result.current.mutateAsync({ shiftId: SHIFT_ID });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.shift.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.shift.detail(SHIFT_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.me.all,
    });
  });

  it('shows a toast on success', async () => {
    const { result } = renderHookWithProviders(() => useDeclineShift());

    await act(async () => {
      await result.current.mutateAsync({ shiftId: SHIFT_ID });
    });

    expect(showSuccessToastMock).toHaveBeenCalled();
  });

  it('requests a calendar sync on settle', async () => {
    const { result } = renderHookWithProviders(() => useDeclineShift());

    await act(async () => {
      await result.current.mutateAsync({ shiftId: SHIFT_ID });
    });

    expect(requestCalendarSyncMock).toHaveBeenCalled();
  });

  it('shows an error toast on failure', async () => {
    declineMock.mockImplementation(() =>
      Promise.reject(new Error('SHIFT_NOT_PENDING'))
    );
    const { result } = renderHookWithProviders(() => useDeclineShift());

    await act(async () => {
      await result.current.mutateAsync({ shiftId: SHIFT_ID }).catch(() => {});
    });

    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());
  });
});
