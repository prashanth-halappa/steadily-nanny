/**
 * @module hooks/mutations/__tests__/useCreatePayArrangement.test
 * Create must invalidate BOTH the current-arrangement and history caches for
 * this (household, carer) pair — a new arrangement changes what "current"
 * means and appends to the history list.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';

const createMock = mock(() =>
  Promise.resolve({
    id: '44444444-4444-4444-8444-444444444444',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    rate_minor: 1600,
  })
);

mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: { create: createMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useCreatePayArrangement: typeof import('../useCreatePayArrangement').useCreatePayArrangement;

beforeAll(async () => {
  useCreatePayArrangement = (await import('../useCreatePayArrangement'))
    .useCreatePayArrangement;
});

describe('useCreatePayArrangement', () => {
  it('creates the arrangement and invalidates both current + history caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useCreatePayArrangement(HOUSEHOLD_ID, CARER_ID)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        rate_minor: 1600,
        currency: 'GBP',
        overtime_multiplier: 1.5,
        valid_from: '2026-08-04',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createMock).toHaveBeenCalledWith(HOUSEHOLD_ID, CARER_ID, {
      rate_minor: 1600,
      currency: 'GBP',
      overtime_multiplier: 1.5,
      valid_from: '2026-08-04',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pay.current(HOUSEHOLD_ID, CARER_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pay.history(HOUSEHOLD_ID, CARER_ID),
    });
  });
});
