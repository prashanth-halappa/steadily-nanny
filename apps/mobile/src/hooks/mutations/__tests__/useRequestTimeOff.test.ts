/**
 * @module hooks/mutations/__tests__/useRequestTimeOff.test
 * D30 — create + cancel must invalidate time-off AND busy caches so a
 * subsequent request sees the new block.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const createMock = mock(() =>
  Promise.resolve({
    id: '22222222-2222-4222-8222-222222222222',
    status: 'confirmed',
  })
);
const cancelMock = mock(() =>
  Promise.resolve({
    id: '22222222-2222-4222-8222-222222222222',
    status: 'cancelled',
  })
);

mock.module('@/src/api/endpoints/timeOff', () => ({
  timeOffApi: { create: createMock, cancel: cancelMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useRequestTimeOff: typeof import('../useRequestTimeOff').useRequestTimeOff;
let useCancelTimeOff: typeof import('../useCancelTimeOff').useCancelTimeOff;

beforeAll(async () => {
  useRequestTimeOff = (await import('../useRequestTimeOff')).useRequestTimeOff;
  useCancelTimeOff = (await import('../useCancelTimeOff')).useCancelTimeOff;
});

describe('useRequestTimeOff invalidation', () => {
  it('invalidates timeOff and availability busy caches on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useRequestTimeOff()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        starts_at: '2026-08-10T00:00:00.000Z',
        ends_at: '2026-08-13T00:00:00.000Z',
        all_day: true,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeOff.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.availability.all,
    });
  });
});

describe('useRequestTimeOff kind pass-through (068)', () => {
  it('forwards kind: "sick" to timeOffApi.create unchanged', async () => {
    createMock.mockClear();
    const { result } = renderHookWithProviders(() => useRequestTimeOff());

    await act(async () => {
      await result.current.mutateAsync({
        starts_at: '2026-08-10T00:00:00.000Z',
        ends_at: '2026-08-11T00:00:00.000Z',
        all_day: true,
        kind: 'sick',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createMock).toHaveBeenCalledWith({
      starts_at: '2026-08-10T00:00:00.000Z',
      ends_at: '2026-08-11T00:00:00.000Z',
      all_day: true,
      kind: 'sick',
    });
  });

  it('an omitted kind is passed through unchanged — existing personal callers are unaffected', async () => {
    createMock.mockClear();
    const { result } = renderHookWithProviders(() => useRequestTimeOff());

    await act(async () => {
      await result.current.mutateAsync({
        starts_at: '2026-08-10T00:00:00.000Z',
        ends_at: '2026-08-13T00:00:00.000Z',
        all_day: true,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createMock).toHaveBeenCalledWith({
      starts_at: '2026-08-10T00:00:00.000Z',
      ends_at: '2026-08-13T00:00:00.000Z',
      all_day: true,
    });
  });
});

describe('useCancelTimeOff invalidation', () => {
  it('invalidates timeOff and availability busy caches on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useCancelTimeOff()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('22222222-2222-4222-8222-222222222222');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timeOff.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.availability.all,
    });
  });
});
