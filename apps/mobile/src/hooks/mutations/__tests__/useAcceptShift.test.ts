/**
 * @module hooks/mutations/__tests__/useAcceptShift.test
 *
 * Carer accept-pending mutation: POSTs via shiftApi.accept, invalidates
 * shift query keys, shows success toast.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const SHIFT_ID = '77777777-7777-4777-8777-777777777777';

const acceptedShift = {
  id: SHIFT_ID,
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  starts_at: '2026-01-07T08:00:00Z',
  ends_at: '2026-01-07T13:00:00Z',
  timezone: 'Europe/London',
  local_date: '2026-01-07',
  kind: 'extra',
  status: 'confirmed',
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

const acceptMock = mock(() =>
  Promise.resolve({ shift: acceptedShift, warnings: [] })
);
const showErrorToastMock = mock(() => {});
const showSuccessToastMock = mock(() => {});
const showWarningToastMock = mock(() => {});
const requestCalendarSyncMock = mock(() => {});

mock.module('@/src/api/endpoints/shifts', () => ({
  shiftApi: { accept: acceptMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
  showWarningToast: showWarningToastMock,
}));
mock.module('@/src/domains/schedule/hooks/useCalendarSync', () => ({
  requestCalendarSync: requestCalendarSyncMock,
}));

let useAcceptShift: typeof import('../useAcceptShift').useAcceptShift;

beforeEach(async () => {
  acceptMock.mockReset();
  acceptMock.mockImplementation(() =>
    Promise.resolve({ shift: acceptedShift, warnings: [] })
  );
  showErrorToastMock.mockReset();
  showSuccessToastMock.mockReset();
  showWarningToastMock.mockReset();
  requestCalendarSyncMock.mockReset();
  useAcceptShift = (await import('../useAcceptShift')).useAcceptShift;
});

describe('useAcceptShift', () => {
  it('calls shiftApi.accept with the shiftId', async () => {
    const { result } = renderHookWithProviders(() => useAcceptShift());

    await act(async () => {
      await result.current.mutateAsync({ shiftId: SHIFT_ID });
    });

    expect(acceptMock).toHaveBeenCalledWith(SHIFT_ID);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates shift list + detail caches on success', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;

    const { result } = renderHookWithProviders(() => useAcceptShift(), {
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

  it('shows the accepted toast on success', async () => {
    const { result } = renderHookWithProviders(() => useAcceptShift());

    await act(async () => {
      await result.current.mutateAsync({ shiftId: SHIFT_ID });
    });

    expect(showSuccessToastMock).toHaveBeenCalled();
  });
});
