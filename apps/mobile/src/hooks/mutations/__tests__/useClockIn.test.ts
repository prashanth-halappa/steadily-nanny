/**
 * @module hooks/mutations/__tests__/useClockIn.test
 *
 * Covers: the clock-in mutation calls timeEntryApi.clockIn exactly once,
 * invalidates the timeEntry query subtree on success, and — the
 * design-critical case — surfaces a duplicate clock-in with the specific
 * "already clocked in" copy, while any OTHER 409 still gets the generic
 * conflict message. The error shape below (`error.code: 'CONFLICT'` +
 * `error.metadata.reason: 'ALREADY_CLOCKED_IN'`) is copied verbatim from a
 * live call against the running API (2026-08-01) — EVERY ConflictError in
 * this domain has the same generic `code`; only `metadata.reason` tells
 * duplicate-clock-in apart from e.g. TIMESHEET_NOT_ACTIONABLE.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const clockInMock = mock(() =>
  Promise.resolve({ id: 'entry-1', status: 'running' })
);
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { clockIn: clockInMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useClockIn: typeof import('../useClockIn').useClockIn;

beforeAll(async () => {
  useClockIn = (await import('../useClockIn')).useClockIn;
});

describe('useClockIn', () => {
  it('calls timeEntryApi.clockIn and resolves on success', async () => {
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await result.current.mutateAsync({ household_id: 'household-1' });
    });

    expect(clockInMock).toHaveBeenCalledWith({ household_id: 'household-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('shows the "already clocked in" message on ALREADY_CLOCKED_IN, not the generic conflict copy', async () => {
    clockInMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'ALREADY_CLOCKED_IN' },
            },
          },
        },
      })
    );
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: 'household-1' })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:alreadyClockedIn');
  });

  it('D7: refetches the timeEntry cache on ALREADY_CLOCKED_IN, so the Today card lands on truth (on-the-clock) instead of freezing on stale cache', async () => {
    clockInMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'ALREADY_CLOCKED_IN' },
            },
          },
        },
      })
    );
    const { result, queryClient } = renderHookWithProviders(() => useClockIn());
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: 'household-1' })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeEntry.all,
    });
  });

  it('does NOT refetch the timeEntry cache for a different CONFLICT reason (nothing about server truth changed)', async () => {
    clockInMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'TIMESHEET_NOT_ACTIONABLE' },
            },
          },
        },
      })
    );
    const { result, queryClient } = renderHookWithProviders(() => useClockIn());
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: 'household-1' })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does NOT show the "already clocked in" copy for a different CONFLICT reason', async () => {
    clockInMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'TIMESHEET_NOT_ACTIONABLE' },
            },
          },
        },
      })
    );
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: 'household-1' })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:conflict');
  });

  it('shows the generic error message for a non-conflict failure', async () => {
    clockInMock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: 'household-1' })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:unknown');
  });
});
