/**
 * @module hooks/mutations/__tests__/useWithdrawTimesheetQuery.test
 *
 * The parent's exit from `queried` (D-19). The week's STATUS changes, so
 * every timesheet read has to be invalidated — the card's tone, its headline
 * and the composer's visibility are all derived from it. The thread is not
 * cleared, and must be re-read rather than dropped: the withdrawal itself
 * appends a message.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';

const submittedWeek = {
  id: TIMESHEET_ID,
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  week_start: '2026-08-04',
  total_minutes: 2310,
  status: 'submitted',
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
  created_at: '2026-08-04T18:00:00.000Z',
  updated_at: '2026-08-13T09:00:00+00:00',
};

const withdrawQueryMock = mock(() => Promise.resolve(submittedWeek));
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/timesheets', () => ({
  timesheetApi: { withdrawQuery: withdrawQueryMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: mock(() => {}),
}));

let useWithdrawTimesheetQuery: typeof import('../useWithdrawTimesheetQuery').useWithdrawTimesheetQuery;

beforeEach(async () => {
  withdrawQueryMock.mockReset();
  withdrawQueryMock.mockImplementation(() => Promise.resolve(submittedWeek));
  showErrorToastMock.mockReset();
  useWithdrawTimesheetQuery = (await import('../useWithdrawTimesheetQuery'))
    .useWithdrawTimesheetQuery;
});

describe('useWithdrawTimesheetQuery', () => {
  it('posts the withdrawal and returns the week to submitted', async () => {
    const { result } = renderHookWithProviders(() =>
      useWithdrawTimesheetQuery()
    );

    await act(async () => {
      const week = await result.current.mutateAsync({
        timesheetId: TIMESHEET_ID,
      });
      expect(week.status).toBe('submitted');
    });

    expect(withdrawQueryMock).toHaveBeenCalledWith(TIMESHEET_ID);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates every timesheet read AND the thread — the status moved and a message was appended', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;

    const { result } = renderHookWithProviders(
      () => useWithdrawTimesheetQuery(),
      { queryClient: client }
    );

    await act(async () => {
      await result.current.mutateAsync({ timesheetId: TIMESHEET_ID });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.thread(TIMESHEET_ID),
    });
  });

  it('shows an error toast on failure', async () => {
    withdrawQueryMock.mockImplementation(() =>
      Promise.reject(new Error('TIMESHEET_NOT_ACTIONABLE'))
    );
    const { result } = renderHookWithProviders(() =>
      useWithdrawTimesheetQuery()
    );

    await act(async () => {
      await result.current
        .mutateAsync({ timesheetId: TIMESHEET_ID })
        .catch(() => {});
    });

    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());
  });
});
