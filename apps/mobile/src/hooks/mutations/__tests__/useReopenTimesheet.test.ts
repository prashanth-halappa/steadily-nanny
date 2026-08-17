/**
 * @module hooks/mutations/__tests__/useReopenTimesheet.test
 * Reopen must invalidate the timesheet cache — same broad invalidate as approve.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const TIMESHEET_ID = 'ts-reopen-1';

const reopenMock = mock(() =>
  Promise.resolve({
    id: TIMESHEET_ID,
    status: 'submitted',
    approved_at: null,
  })
);

mock.module('@/src/api/endpoints/timesheets', () => ({
  timesheetApi: { reopen: reopenMock },
}));
const showErrorToastMock = mock((_m: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useReopenTimesheet: typeof import('../useReopenTimesheet').useReopenTimesheet;

beforeAll(async () => {
  useReopenTimesheet = (await import('../useReopenTimesheet'))
    .useReopenTimesheet;
});

describe('useReopenTimesheet', () => {
  it('reopens with the reason and invalidates the timesheet cache', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useReopenTimesheet()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        timesheetId: TIMESHEET_ID,
        reason: 'Thursday hours were wrong',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reopenMock).toHaveBeenCalledWith(TIMESHEET_ID, {
      reason: 'Thursday hours were wrong',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });

  // WP-P1(B). `ReopenWeekDialog` states this refusal inline; a toast over an
  // open `BottomSheetBase` is invisible anyway (GOLDEN-FIXES #40), so firing
  // one here would only double-report a refusal nobody would see.
  it('stays silent for the paid-week refusal, and toasts everything else', async () => {
    const paidRefusal = Object.assign(new Error('not actionable'), {
      response: {
        status: 409,
        data: {
          error: {
            code: 'TIMESHEET_NOT_ACTIONABLE',
            metadata: { timesheetId: TIMESHEET_ID, status: 'has_payments' },
          },
        },
      },
    });
    reopenMock.mockImplementation(() => Promise.reject(paidRefusal));
    showErrorToastMock.mockClear();

    const { result } = renderHookWithProviders(() => useReopenTimesheet());
    await act(async () => {
      await result.current
        .mutateAsync({ timesheetId: TIMESHEET_ID, reason: 'wrong' })
        .catch(() => {});
    });
    expect(showErrorToastMock).not.toHaveBeenCalled();

    // A 409 that is NOT the paid-week refusal still gets its toast.
    reopenMock.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('not actionable'), {
          response: {
            status: 409,
            data: {
              error: {
                code: 'TIMESHEET_NOT_ACTIONABLE',
                metadata: { timesheetId: TIMESHEET_ID, status: 'approved' },
              },
            },
          },
        })
      )
    );
    const second = renderHookWithProviders(() => useReopenTimesheet());
    await act(async () => {
      await second.result.current
        .mutateAsync({ timesheetId: TIMESHEET_ID, reason: 'wrong' })
        .catch(() => {});
    });
    expect(showErrorToastMock).toHaveBeenCalled();
  });
});
