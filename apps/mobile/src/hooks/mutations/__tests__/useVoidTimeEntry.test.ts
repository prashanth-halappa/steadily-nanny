/**
 * @module hooks/mutations/__tests__/useVoidTimeEntry.test
 *
 * Soft-delete mutation (069): mirrors useUpdateTimeEntry's non-optimistic
 * posture — the server may refuse. Refusals render inline in the sheet, not
 * via toast (GOLDEN-FIXES #40).
 */
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { onlineManager } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';
import {
  clockMutationRetry,
  isRetryableClockMutationError,
} from '../timeEntryMutationUtils';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';

const voidedEntry = {
  id: ENTRY_ID,
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  shift_id: null,
  clock_in_at: '2026-08-01T08:00:00.000Z',
  clock_out_at: '2026-08-01T16:00:00.000Z',
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  clock_in_location_ok: null,
  clock_out_location_ok: null,
  status: 'voided',
  local_date: '2026-08-01',
  timezone: 'Europe/London',
  created_at: '2026-08-01T08:00:00.000Z',
  updated_at: '2026-08-02T10:00:00.000Z',
} satisfies TimeEntry;

const voidMock = mock(() => Promise.resolve(voidedEntry));
const showErrorToastMock = mock(() => {});
const useIsOnlineMock = mock(() => true);

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { void: voidMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));
mock.module('@/src/lib/network', () => ({
  useIsOnline: useIsOnlineMock,
  setupNetworkManagers: mock(),
}));

let useVoidTimeEntry: typeof import('../useVoidTimeEntry').useVoidTimeEntry;

beforeEach(async () => {
  voidMock.mockReset();
  voidMock.mockImplementation(() => Promise.resolve(voidedEntry));
  showErrorToastMock.mockReset();
  useIsOnlineMock.mockReset();
  useIsOnlineMock.mockImplementation(() => true);
  onlineManager.setOnline(true);
  useVoidTimeEntry = (await import('../useVoidTimeEntry')).useVoidTimeEntry;
});

describe('useVoidTimeEntry', () => {
  it('calls timeEntryApi.void with the entry id', async () => {
    const { result } = renderHookWithProviders(() => useVoidTimeEntry());

    await act(async () => {
      await result.current.mutateAsync({ entryId: ENTRY_ID });
    });

    expect(voidMock).toHaveBeenCalledWith(ENTRY_ID);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates timeEntry and timesheet caches on success', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = spyOn(client, 'invalidateQueries');
    const { result } = renderHookWithProviders(() => useVoidTimeEntry(), {
      queryClient: client,
    });

    await act(async () => {
      await result.current.mutateAsync({ entryId: ENTRY_ID });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeEntry.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });

  it('invalidates timeEntry and timesheet caches on error so the row stops offering void', async () => {
    voidMock.mockImplementation(() =>
      Promise.reject({
        response: {
          status: 409,
          data: { error: { metadata: { reason: 'voided' } } },
        },
      })
    );
    const client = createTestQueryClient();
    const invalidateSpy = spyOn(client, 'invalidateQueries');
    const { result } = renderHookWithProviders(() => useVoidTimeEntry(), {
      queryClient: client,
    });

    await act(async () => {
      await result.current.mutateAsync({ entryId: ENTRY_ID }).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeEntry.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });

  it('does not toast on error — the sheet renders the refusal inline', async () => {
    voidMock.mockImplementation(() =>
      Promise.reject({
        response: {
          status: 409,
          data: { error: { metadata: { reason: 'voided' } } },
        },
      })
    );
    const { result } = renderHookWithProviders(() => useVoidTimeEntry());

    await act(async () => {
      await result.current.mutateAsync({ entryId: ENTRY_ID }).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).not.toHaveBeenCalled();
  });

  it('uses clockMutationRetry so transport failures may succeed on retry', () => {
    expect(
      clockMutationRetry(0, { isAxiosError: true, message: 'Network Error' })
    ).toBe(true);
    expect(
      clockMutationRetry(3, { isAxiosError: true, message: 'Network Error' })
    ).toBe(false);
    expect(
      clockMutationRetry(0, {
        response: {
          status: 409,
          data: { error: { metadata: { reason: 'voided' } } },
        },
      })
    ).toBe(false);
    expect(isRetryableClockMutationError({ message: 'Network Error' })).toBe(
      true
    );
  });
});
