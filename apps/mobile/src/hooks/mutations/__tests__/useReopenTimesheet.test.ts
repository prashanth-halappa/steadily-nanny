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
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
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
});
