/**
 * @module hooks/mutations/__tests__/useAddTimesheetThreadMessage.test
 *
 * Posting a message on the week thread (D-18). The server answers with the
 * FULL updated thread, so this seeds the cache rather than refetching — the
 * message must appear the instant she sends it, because that appearance IS
 * the confirmation (§3.1: no toast, no "your dispute has been filed").
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';

const thread = {
  messages: [
    {
      id: '88888888-8888-4888-8888-888888888888',
      kind: 'note' as const,
      author_id: '33333333-3333-4333-8333-333333333333',
      author_name: 'Ines Ferreira',
      body: 'I stayed late',
      created_at: '2026-08-12T19:20:00+00:00',
    },
  ],
};

const addThreadMessageMock = mock(() => Promise.resolve(thread));
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/timesheets', () => ({
  timesheetApi: { addThreadMessage: addThreadMessageMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: mock(() => {}),
}));

let useAddTimesheetThreadMessage: typeof import('../useAddTimesheetThreadMessage').useAddTimesheetThreadMessage;

beforeEach(async () => {
  addThreadMessageMock.mockReset();
  addThreadMessageMock.mockImplementation(() => Promise.resolve(thread));
  showErrorToastMock.mockReset();
  useAddTimesheetThreadMessage = (
    await import('../useAddTimesheetThreadMessage')
  ).useAddTimesheetThreadMessage;
});

describe('useAddTimesheetThreadMessage', () => {
  it('posts the message for the given timesheet', async () => {
    const { result } = renderHookWithProviders(() =>
      useAddTimesheetThreadMessage()
    );

    await act(async () => {
      await result.current.mutateAsync({
        timesheetId: TIMESHEET_ID,
        message: 'I stayed late',
      });
    });

    expect(addThreadMessageMock).toHaveBeenCalledWith(TIMESHEET_ID, {
      message: 'I stayed late',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('seeds the thread cache with the response instead of refetching it', async () => {
    const client = createTestQueryClient();
    const { result } = renderHookWithProviders(
      () => useAddTimesheetThreadMessage(),
      { queryClient: client }
    );

    await act(async () => {
      await result.current.mutateAsync({
        timesheetId: TIMESHEET_ID,
        message: 'I stayed late',
      });
    });

    const cached = client.getQueryData<typeof thread>(
      queryKeys.timesheet.thread(TIMESHEET_ID)
    );
    expect(cached).toEqual(thread);
  });

  // GOLDEN-FIXES #40: the composer renders its own inline refusal, and it can
  // sit under an open sheet where a toast is simply not visible on iOS. The
  // caller reads `error`; this hook must not fire a toast over it.
  it('never toasts a failure — the composer states it inline', async () => {
    addThreadMessageMock.mockImplementation(() =>
      Promise.reject(new Error('TIMESHEET_NOT_ACTIONABLE'))
    );
    const { result } = renderHookWithProviders(() =>
      useAddTimesheetThreadMessage()
    );

    await act(async () => {
      await result.current
        .mutateAsync({ timesheetId: TIMESHEET_ID, message: 'x' })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).not.toHaveBeenCalled();
  });
});
