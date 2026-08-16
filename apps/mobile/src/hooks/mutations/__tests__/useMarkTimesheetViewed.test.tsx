/**
 * @module hooks/mutations/__tests__/useMarkTimesheetViewed.test
 *
 * The parent's Hours read receipt. Fire-and-forget: nobody pressed
 * anything, so there is no error toast, and only the week query is
 * invalidated — the receipt is a field on the row already on screen.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_START = '2026-08-03';

const viewedWeek = {
  id: TIMESHEET_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  week_start: WEEK_START,
  total_minutes: 2310,
  status: 'submitted',
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
  parent_viewed_at: '2026-08-16T12:00:00.000Z',
  created_at: '2026-08-04T18:00:00.000Z',
  updated_at: '2026-08-13T09:00:00+00:00',
};

const markViewedMock = mock(() => Promise.resolve(viewedWeek));

mock.module('@/src/api/endpoints/timesheets', () => ({
  timesheetApi: { markViewed: markViewedMock },
}));

let useMarkTimesheetViewed: typeof import('../useMarkTimesheetViewed').useMarkTimesheetViewed;

beforeEach(async () => {
  markViewedMock.mockReset();
  markViewedMock.mockImplementation(() => Promise.resolve(viewedWeek));
  useMarkTimesheetViewed = (await import('../useMarkTimesheetViewed'))
    .useMarkTimesheetViewed;
});

describe('useMarkTimesheetViewed', () => {
  it('invalidates only the week query key on success', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;

    const { result } = renderHookWithProviders(() => useMarkTimesheetViewed(), {
      queryClient: client,
    });

    await act(async () => {
      await result.current.mutateAsync({
        timesheetId: TIMESHEET_ID,
        householdId: HOUSEHOLD_ID,
        weekStart: WEEK_START,
      });
    });

    expect(markViewedMock).toHaveBeenCalledWith(TIMESHEET_ID);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.week(HOUSEHOLD_ID, WEEK_START),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('declares no onError handler', async () => {
    const source = await Bun.file(
      join(import.meta.dir, '../useMarkTimesheetViewed.ts')
    ).text();
    expect(source).not.toContain('onError');
  });
});
