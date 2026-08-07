/**
 * @module hooks/mutations/__tests__/useAmendSchedulePattern.test
 * An amend re-materialises shifts server-side (see
 * `schedulePatternCommandService.amend`), so success must invalidate the
 * pattern (detail + list), shift, and me caches — same shape as
 * `useRespondToSchedulePattern`'s accept branch — and request a calendar
 * resync, since the materialised shifts can move.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const patternId = '11111111-1111-4111-8111-111111111111';

const amendMock = mock(() =>
  Promise.resolve({
    schedule_pattern: {
      id: patternId,
      status: 'accepted',
      until: '2026-03-01',
    },
    warnings: [],
  })
);

const requestCalendarSyncMock = mock(() => {});

mock.module('@/src/api/endpoints/schedulePatterns', () => ({
  schedulePatternApi: { amend: amendMock },
}));
mock.module('@/src/domains/schedule/hooks/useCalendarSync', () => ({
  requestCalendarSync: requestCalendarSyncMock,
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
  showWarningToast: mock(() => {}),
}));

let useAmendSchedulePattern: typeof import('../useAmendSchedulePattern').useAmendSchedulePattern;

beforeAll(async () => {
  useAmendSchedulePattern = (await import('../useAmendSchedulePattern'))
    .useAmendSchedulePattern;
});

describe('useAmendSchedulePattern', () => {
  it('invalidates schedulePattern (detail + all), shift, and me caches on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useAmendSchedulePattern(patternId)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ until: '2026-03-01' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(amendMock).toHaveBeenCalledWith(patternId, { until: '2026-03-01' });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.schedulePattern.detail(patternId),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.schedulePattern.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.shift.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.me.all,
    });
  });

  it('requests a calendar resync once the mutation settles', async () => {
    requestCalendarSyncMock.mockClear();
    const { result } = renderHookWithProviders(() =>
      useAmendSchedulePattern(patternId)
    );

    await act(async () => {
      await result.current.mutateAsync({ exdates: ['2026-02-10'] });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestCalendarSyncMock).toHaveBeenCalled();
  });
});
