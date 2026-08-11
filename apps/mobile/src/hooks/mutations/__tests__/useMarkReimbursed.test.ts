/**
 * @module hooks/mutations/__tests__/useMarkReimbursed.test
 * A settlement must invalidate BOTH the settlements cache (the state words
 * on the card) and the expenses cache (the rows it settles). It must NOT
 * touch the payment cache — a reimbursement is not a payment — and it must
 * not toast: the refusal is stated inline next to the button
 * (GOLDEN-FIXES #40).
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const WEEK_START = '2026-08-17';

const SETTLEMENT = {
  id: '77777777-7777-4777-8777-777777777777',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  week_start: WEEK_START,
  amount_minor: 3480,
  currency: 'GBP',
  settled_at: '2026-08-18',
  note: null,
  recorded_by: null,
  created_at: '2026-08-18T00:00:00.000Z',
};

const createMock = mock(() => Promise.resolve(SETTLEMENT as unknown));
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/reimbursementSettlements', () => ({
  reimbursementSettlementApi: { create: createMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useMarkReimbursed: typeof import('../useMarkReimbursed').useMarkReimbursed;

beforeAll(async () => {
  useMarkReimbursed = (await import('../useMarkReimbursed')).useMarkReimbursed;
});

describe('useMarkReimbursed', () => {
  it('records the settlement and invalidates the settlements + expenses caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useMarkReimbursed()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        householdId: HOUSEHOLD_ID,
        input: {
          carer_id: CARER_ID,
          week_start: WEEK_START,
          settled_at: '2026-08-18',
        },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createMock).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      carer_id: CARER_ID,
      week_start: WEEK_START,
      settled_at: '2026-08-18',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.reimbursementSettlements.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.expenses.all,
    });
    // Not a payment: the payment ledger has nothing to refetch.
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: queryKeys.payment.all,
    });
  });

  it('does not toast on failure — the card states the refusal inline', async () => {
    showErrorToastMock.mockReset();
    createMock.mockImplementationOnce(() => Promise.reject(new Error('nope')));

    const { result } = renderHookWithProviders(() => useMarkReimbursed());

    await act(async () => {
      await result.current
        .mutateAsync({
          householdId: HOUSEHOLD_ID,
          input: {
            carer_id: CARER_ID,
            week_start: WEEK_START,
            settled_at: '2026-08-18',
          },
        })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).not.toHaveBeenCalled();
  });
});
