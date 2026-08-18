/**
 * @module hooks/mutations/__tests__/useRefreshDayThread.test
 *
 * Parent-only explicit uncovered-care recheck (S14). No success/error
 * toast — this runs as a best-effort background call from the widget sync
 * (`useWidgetSnapshotSync`), not a user-initiated action, so any onError
 * handling belongs at that call site, not here.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const refreshDayThreadMock = mock(() => Promise.resolve(undefined));

mock.module('@/src/api/endpoints/shifts', () => ({
  shiftApi: { refreshDayThread: refreshDayThreadMock },
}));

let useRefreshDayThread: typeof import('../useRefreshDayThread').useRefreshDayThread;

beforeEach(async () => {
  refreshDayThreadMock.mockReset();
  refreshDayThreadMock.mockImplementation(() => Promise.resolve(undefined));
  useRefreshDayThread = (await import('../useRefreshDayThread'))
    .useRefreshDayThread;
});

describe('useRefreshDayThread', () => {
  it('calls shiftApi.refreshDayThread with householdId + localDate', async () => {
    const { result } = renderHookWithProviders(() => useRefreshDayThread());

    await act(async () => {
      await result.current.mutateAsync({
        householdId: HOUSEHOLD_ID,
        localDate: '2026-01-07',
      });
    });

    expect(refreshDayThreadMock).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-01-07'
    );
  });

  it('invalidates shift queries on success, so useDayThread picks up the recheck', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;

    const { result } = renderHookWithProviders(() => useRefreshDayThread(), {
      queryClient: client,
    });

    await act(async () => {
      await result.current.mutateAsync({
        householdId: HOUSEHOLD_ID,
        localDate: '2026-01-07',
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.shift.all,
    });
  });

  it("propagates a rejection to the caller (no hook-level swallow — best-effort is the call site's job)", async () => {
    refreshDayThreadMock.mockImplementation(() =>
      Promise.reject(new Error('network down'))
    );
    const { result } = renderHookWithProviders(() => useRefreshDayThread());

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          householdId: HOUSEHOLD_ID,
          localDate: '2026-01-07',
        })
      ).rejects.toThrow('network down');
    });
  });
});
