/**
 * @module hooks/mutations/__tests__/useCreateRetroactiveEntry.test
 *
 * Forgotten clock-in recovery: POSTs via timeEntryApi.createRetroactiveEntry,
 * invalidates time-entry + timesheet + me caches (mirrors useClockOut's
 * invalidation set, plus `me` per the Today "Add missed hours" spec), shows
 * a toast on success and surfaces server refusals via the generic toast path.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const createdEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  household_id: HOUSEHOLD_ID,
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  shift_id: null,
  clock_in_at: '2026-08-01T07:00:00.000Z',
  clock_out_at: '2026-08-01T15:00:00.000Z',
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: 'Forgot to clock in',
  clock_in_location_ok: null,
  clock_out_location_ok: null,
  status: 'submitted',
  local_date: '2026-08-01',
  timezone: 'Europe/London',
  created_at: '2026-08-01T15:00:00.000Z',
  updated_at: '2026-08-01T15:00:00.000Z',
};

const createRetroactiveEntryMock = mock(() => Promise.resolve(createdEntry));
const showErrorToastMock = mock(() => {});
const showSuccessToastMock = mock(() => {});

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { createRetroactiveEntry: createRetroactiveEntryMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));

let useCreateRetroactiveEntry: typeof import('../useCreateRetroactiveEntry').useCreateRetroactiveEntry;

const input = {
  household_id: HOUSEHOLD_ID,
  clock_in_at: '2026-08-01T07:00:00.000Z',
  clock_out_at: '2026-08-01T15:00:00.000Z',
  note: 'Forgot to clock in',
};

beforeEach(async () => {
  createRetroactiveEntryMock.mockReset();
  createRetroactiveEntryMock.mockImplementation(() =>
    Promise.resolve(createdEntry)
  );
  showErrorToastMock.mockReset();
  showSuccessToastMock.mockReset();
  useCreateRetroactiveEntry = (await import('../useCreateRetroactiveEntry'))
    .useCreateRetroactiveEntry;
});

describe('useCreateRetroactiveEntry', () => {
  it('calls timeEntryApi.createRetroactiveEntry with the input', async () => {
    const { result } = renderHookWithProviders(() =>
      useCreateRetroactiveEntry()
    );

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(createRetroactiveEntryMock).toHaveBeenCalledWith(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates timeEntry + timesheet + me caches on success', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;

    const { result } = renderHookWithProviders(
      () => useCreateRetroactiveEntry(),
      { queryClient: client }
    );

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeEntry.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.me.all,
    });
  });

  it('shows a success toast on success', async () => {
    const { result } = renderHookWithProviders(() =>
      useCreateRetroactiveEntry()
    );

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(showSuccessToastMock).toHaveBeenCalled();
  });

  it('surfaces a server refusal (e.g. week locked, overlap) via the generic error toast', async () => {
    createRetroactiveEntryMock.mockImplementation(() =>
      Promise.reject(new Error('TIME_ENTRY_NOT_EDITABLE'))
    );
    const { result } = renderHookWithProviders(() =>
      useCreateRetroactiveEntry()
    );

    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });

    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());
  });

  // Retroactive adds route through the same `assertClockOrder` as a
  // correction, so the same specific copy must reach the carer — the generic
  // "check the information you entered" names neither the 16h cap nor the
  // week boundary. (The t mock echoes keys, so the key IS the message here.)
  it.each([
    ['CLOCK_SPAN_TOO_LONG', 'errors:clockSpanTooLong'],
    ['CLOCK_OUT_CHANGES_WEEK', 'errors:clockOutChangesWeek'],
    ['CLOCK_OUT_BEFORE_CLOCK_IN', 'errors:invalidClockTimes'],
  ])('toasts specific copy for a %s refusal', async (reason, expectedKey) => {
    createRetroactiveEntryMock.mockImplementation(() =>
      Promise.reject({
        response: { status: 400, data: { error: { metadata: { reason } } } },
      })
    );
    const { result } = renderHookWithProviders(() =>
      useCreateRetroactiveEntry()
    );

    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });

    await waitFor(() =>
      expect(showErrorToastMock).toHaveBeenCalledWith(expectedKey)
    );
  });
});
