/**
 * @module hooks/mutations/__tests__/useClockOut.test
 * Covers: the clock-out mutation passes entryId + the rest of the body
 * through to timeEntryApi.clockOut, and resolves on success.
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

const clockOutMock = mock((entryId: string, _input: unknown) =>
  Promise.resolve({ id: entryId, status: 'submitted' })
);
const showErrorToastMock = mock(() => {});
const useIsOnlineMock = mock(() => true);

function createClockMutationTestClient(): QueryClient {
  const client = createTestQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity },
    mutations: { retry: false },
  });
  return client;
}

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { clockOut: clockOutMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));
mock.module('@/src/lib/network', () => ({
  useIsOnline: useIsOnlineMock,
  setupNetworkManagers: mock(),
}));

let useClockOut: typeof import('../useClockOut').useClockOut;

beforeEach(async () => {
  clockOutMock.mockReset();
  clockOutMock.mockImplementation((entryId: string, _input: unknown) =>
    Promise.resolve({ id: entryId, status: 'submitted' })
  );
  showErrorToastMock.mockReset();
  useIsOnlineMock.mockReset();
  useIsOnlineMock.mockImplementation(() => true);
  onlineManager.setOnline(true);
  useClockOut = (await import('../useClockOut')).useClockOut;
});

describe('useClockOut', () => {
  it('splits entryId out of the mutation variables and forwards the rest as the body', async () => {
    const { result } = renderHookWithProviders(() => useClockOut());

    await act(async () => {
      await result.current.mutateAsync({
        entryId: 'entry-1',
        break_minutes: 30,
        note: 'done',
      });
    });

    expect(clockOutMock).toHaveBeenCalledWith('entry-1', {
      break_minutes: 30,
      note: 'done',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('G20: clears the running entry from cache optimistically before the mutation resolves', async () => {
    const runningEntry = {
      id: 'entry-1',
      household_id: 'household-1',
      clock_in_at: '2026-08-01T20:00:00.000Z',
      status: 'running',
    } as TimeEntry;
    let resolve!: (value: { id: string; status: string }) => void;
    clockOutMock.mockImplementationOnce(
      (_entryId: string, _input: unknown) =>
        new Promise<{ id: string; status: string }>(r => {
          resolve = r;
        })
    );

    const { result, queryClient } = renderHookWithProviders(
      () => useClockOut(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );
    queryClient.setQueryData<TimeEntry | null>(
      queryKeys.timeEntry.running(),
      runningEntry
    );

    let mutationPromise!: Promise<unknown>;
    await act(async () => {
      mutationPromise = result.current.mutateAsync({ entryId: 'entry-1' });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.timeEntry.running())).toBeNull()
    );

    await act(async () => {
      resolve({ id: 'entry-1', status: 'submitted' });
      await mutationPromise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('A1: a 409 TIME_ENTRY_NOT_RUNNING invalidates timeEntry queries so server truth wins instead of rolling back the optimistic clear', async () => {
    const runningEntry = {
      id: 'entry-1',
      household_id: 'household-1',
      clock_in_at: '2026-08-01T20:00:00.000Z',
      status: 'running',
    } as TimeEntry;
    clockOutMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'TIME_ENTRY_NOT_RUNNING' },
            },
          },
        },
      })
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useClockOut(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );
    queryClient.setQueryData<TimeEntry | null>(
      queryKeys.timeEntry.running(),
      runningEntry
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await expect(
        result.current.mutateAsync({ entryId: 'entry-1' })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeEntry.all,
    });
    expect(
      queryClient.getQueryData<TimeEntry | null>(queryKeys.timeEntry.running())
    ).toBeNull();
  });

  it('G20: rolls back the optimistic clear on error', async () => {
    const runningEntry = {
      id: 'entry-1',
      household_id: 'household-1',
      clock_in_at: '2026-08-01T20:00:00.000Z',
      status: 'running',
    } as TimeEntry;
    clockOutMock.mockImplementationOnce(() =>
      Promise.reject(new Error('boom'))
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useClockOut(),
      {
        queryClient: createClockMutationTestClient(),
      }
    );
    queryClient.setQueryData<TimeEntry | null>(
      queryKeys.timeEntry.running(),
      runningEntry
    );

    await act(async () => {
      await expect(
        result.current.mutateAsync({ entryId: 'entry-1' })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<TimeEntry | null>(queryKeys.timeEntry.running())
    ).toEqual(runningEntry);
  });
});
