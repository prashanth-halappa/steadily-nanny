/**
 * @module hooks/queries/__tests__/useHouseholdPayments.test
 * Covers: disabled with no householdId, fetches once present, keyed by
 * `queryKeys.payment.forHousehold` — the household-wide Payments screen list.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const PAYMENT = {
  id: '66666666-6666-4666-8666-666666666666',
  timesheet_id: '44444444-4444-4444-8444-444444444444',
  household_id: HOUSEHOLD_ID,
  carer_id: '33333333-3333-4333-8333-333333333333',
  amount_minor: 12000,
  currency: 'GBP',
  paid_at: '2026-08-11',
  method_note: 'Bank transfer',
  recorded_by: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-08-11T09:30:00.000Z',
};

const listForHouseholdMock = mock(() => Promise.resolve([PAYMENT as unknown]));

mock.module('@/src/api/endpoints/payments', () => ({
  paymentApi: { listForHousehold: listForHouseholdMock },
}));

let useHouseholdPayments: typeof import('../useHouseholdPayments').useHouseholdPayments;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useHouseholdPayments = (await import('../useHouseholdPayments'))
    .useHouseholdPayments;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  listForHouseholdMock.mockReset();
  listForHouseholdMock.mockImplementation(() => Promise.resolve([PAYMENT]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useHouseholdPayments', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useHouseholdPayments(null)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForHouseholdMock).not.toHaveBeenCalled();
  });

  it('fetches once the householdId is present, keyed by that household', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useHouseholdPayments(HOUSEHOLD_ID)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(listForHouseholdMock).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(result.current.data).toHaveLength(1);
    expect(
      queryClient.getQueryData(queryKeys.payment.forHousehold(HOUSEHOLD_ID))
    ).toHaveLength(1);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      useHouseholdPayments(HOUSEHOLD_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForHouseholdMock).not.toHaveBeenCalled();
  });
});
