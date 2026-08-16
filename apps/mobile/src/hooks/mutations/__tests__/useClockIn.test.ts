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
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
/** The signed-in carer — `pay.current` is keyed by (household, carer), and on
 * a clock-in the carer is always whoever is holding the phone. */
const CARER_ID = '00000000-0000-4000-8000-0000000000ca';

mock.module('@/src/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_ID } } }),
}));

const clockInMock = mock(() =>
  Promise.resolve({ id: 'entry-1', status: 'running' })
);
const showErrorToastMock = mock(() => {});
const useIsOnlineMock = mock(() => true);

/** gcTime: 0 drops cache entries the moment a mutation settles — too early to assert rollback. */
function createClockMutationTestClient(): QueryClient {
  const client = createTestQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity },
    mutations: { retry: false },
  });
  return client;
}

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { clockIn: clockInMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));
mock.module('@/src/lib/network', () => ({
  useIsOnline: useIsOnlineMock,
  setupNetworkManagers: mock(),
}));

let useClockIn: typeof import('../useClockIn').useClockIn;

beforeEach(async () => {
  clockInMock.mockReset();
  clockInMock.mockImplementation(() =>
    Promise.resolve({ id: 'entry-1', status: 'running' })
  );
  showErrorToastMock.mockReset();
  useIsOnlineMock.mockReset();
  useIsOnlineMock.mockImplementation(() => true);
  onlineManager.setOnline(true);
  useClockIn = (await import('../useClockIn')).useClockIn;
});

describe('useClockIn', () => {
  it('calls timeEntryApi.clockIn and resolves on success', async () => {
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await result.current.mutateAsync({ household_id: HOUSEHOLD_ID });
    });

    expect(clockInMock).toHaveBeenCalledWith({ household_id: HOUSEHOLD_ID });
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
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
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
    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
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
    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // A1. The server is the guard, so this 409 is the FIRST the app may hear
  // that terms are not agreed — the gate's arrangement query can easily be
  // holding a stale non-null (she was blocked while the screen was open, or
  // an arrangement was voided elsewhere). Refetching it is what turns a
  // refused tap into the blocked card explaining itself, instead of a toast
  // over a clock-in button that still looks usable.
  it('A1: refetches the current arrangement on TERMS_NOT_AGREED, so the card flips to blocked', async () => {
    clockInMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'TERMS_NOT_AGREED' },
            },
          },
        },
      })
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      { queryClient: createClockMutationTestClient() }
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pay.current(HOUSEHOLD_ID, CARER_ID),
    });
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:termsNotAgreed');
  });

  it('leaves the arrangement cache alone for every other CONFLICT reason', async () => {
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
    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      { queryClient: createClockMutationTestClient() }
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: queryKeys.pay.current(HOUSEHOLD_ID, CARER_ID),
    });
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
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
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
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:unknown');
  });

  it('G20: writes an optimistic running entry to the cache before the mutation resolves', async () => {
    let resolve!: (value: { id: string; status: string }) => void;
    clockInMock.mockImplementationOnce(
      () =>
        new Promise<{ id: string; status: string }>(r => {
          resolve = r;
        })
    );

    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );

    let mutationPromise!: Promise<unknown>;
    await act(async () => {
      mutationPromise = result.current.mutateAsync({
        household_id: HOUSEHOLD_ID,
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData(queryKeys.timeEntry.running())
      ).toMatchObject({
        status: 'running',
        household_id: HOUSEHOLD_ID,
      });
    });

    await act(async () => {
      resolve({ id: 'entry-1', status: 'running' });
      await mutationPromise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  // F-B8-6: the household zone the caller already holds must reach the
  // optimistic row, or a carer clocking in from elsewhere sees her own row
  // filed under the device's day until the server answers.
  it('stamps the optimistic entry with the household zone it was given', async () => {
    let resolve!: (value: { id: string; status: string }) => void;
    clockInMock.mockImplementationOnce(
      () =>
        new Promise<{ id: string; status: string }>(r => {
          resolve = r;
        })
    );

    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn('Pacific/Auckland'),
      { queryClient: createClockMutationTestClient() }
    );

    let mutationPromise!: Promise<unknown>;
    await act(async () => {
      mutationPromise = result.current.mutateAsync({
        household_id: HOUSEHOLD_ID,
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData(queryKeys.timeEntry.running())
      ).toMatchObject({ timezone: 'Pacific/Auckland' });
    });

    await act(async () => {
      resolve({ id: 'entry-1', status: 'running' });
      await mutationPromise;
    });
  });

  it('G20: rolls back the optimistic running entry on a non-409 error', async () => {
    const runningKey = queryKeys.timeEntry.running();
    const previousEntry = {
      id: 'entry-prior',
      household_id: HOUSEHOLD_ID,
      clock_in_at: '2026-08-01T19:00:00.000Z',
      status: 'running',
    } as TimeEntry;
    clockInMock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );
    queryClient.setQueryData<TimeEntry | null>(runningKey, previousEntry);
    expect(queryClient.getQueryData<TimeEntry | null>(runningKey)).toEqual(
      previousEntry
    );

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:unknown');
    expect(queryClient.getQueryData<TimeEntry | null>(runningKey)).toEqual(
      previousEntry
    );
  });

  it('G20: surfaces explicit offline copy when clock-in starts while offline', async () => {
    useIsOnlineMock.mockImplementation(() => false);
    onlineManager.setOnline(false);

    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );

    await act(async () => {
      void result.current.mutate({ household_id: HOUSEHOLD_ID });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(showErrorToastMock).toHaveBeenCalledWith('errors:offline');
      expect(
        queryClient.getQueryData(queryKeys.timeEntry.running())
      ).toMatchObject({ status: 'running' });
    });

    result.current.reset();
    queryClient.getMutationCache().clear();
  });

  it('A1: still invokes timeEntryApi.clockIn after onMutate writes the optimistic entry (onMutate must not abort the mutation)', async () => {
    let resolve!: (value: { id: string; status: string }) => void;
    clockInMock.mockImplementationOnce(
      () =>
        new Promise<{ id: string; status: string }>(r => {
          resolve = r;
        })
    );

    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );

    let mutationPromise!: Promise<unknown>;
    await act(async () => {
      mutationPromise = result.current.mutateAsync({
        household_id: HOUSEHOLD_ID,
      });
    });

    expect(clockInMock).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(queryKeys.timeEntry.running())
    ).toMatchObject({ status: 'running', isOptimistic: true });

    await act(async () => {
      resolve({ id: 'entry-server', status: 'running' });
      await mutationPromise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('A1: onSuccess replaces the optimistic running entry with the server entry in cache', async () => {
    const serverEntry = {
      id: 'entry-server',
      household_id: HOUSEHOLD_ID,
      clock_in_at: '2026-08-01T20:00:00.000Z',
      status: 'running',
    } as TimeEntry;
    clockInMock.mockImplementationOnce(() => Promise.resolve(serverEntry));

    const { result, queryClient } = renderHookWithProviders(
      () => useClockIn(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );

    await act(async () => {
      await result.current.mutateAsync({ household_id: HOUSEHOLD_ID });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      queryClient.getQueryData<TimeEntry | null>(queryKeys.timeEntry.running())
    ).toEqual(serverEntry);
  });

  it('G20: retries transient network failures (mutation-level retry overrides the test client default)', async () => {
    let attempts = 0;
    clockInMock.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject({
          isAxiosError: true,
          message: 'Network Error',
        });
      }
      return Promise.resolve({ id: 'entry-1', status: 'running' });
    });
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await result.current.mutateAsync({ household_id: HOUSEHOLD_ID });
    });

    expect(clockInMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
