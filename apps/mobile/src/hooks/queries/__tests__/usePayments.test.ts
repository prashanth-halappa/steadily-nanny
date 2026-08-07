/**
 * @module hooks/queries/__tests__/usePayments.test
 * Covers: disabled with no timesheetId, fetches once present, keyed by
 * `queryKeys.payment.forTimesheet` — the ledger that drives the week's
 * Paid / Partially paid / Unpaid badge.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';

const PAYMENT = {
  id: '66666666-6666-4666-8666-666666666666',
  timesheet_id: TIMESHEET_ID,
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  amount_minor: 12000,
  currency: 'GBP',
  paid_at: '2026-08-11',
  method_note: 'Bank transfer',
  recorded_by: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-08-11T09:30:00.000Z',
};

const listMock = mock(() => Promise.resolve([PAYMENT as unknown]));

mock.module('@/src/api/endpoints/payments', () => ({
  paymentApi: { list: listMock },
}));

let usePayments: typeof import('../usePayments').usePayments;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  usePayments = (await import('../usePayments')).usePayments;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  listMock.mockReset();
  listMock.mockImplementation(() => Promise.resolve([PAYMENT]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('usePayments', () => {
  it('does not fetch when timesheetId is missing — an unstarted week has no ledger', () => {
    const { result } = renderHookWithProviders(() => usePayments(null));

    expect(result.current.isPending).toBe(true);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('fetches once the timesheetId is present, keyed by that timesheet', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      usePayments(TIMESHEET_ID)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(listMock).toHaveBeenCalledWith(TIMESHEET_ID);
    expect(result.current.data).toHaveLength(1);
    expect(
      queryClient.getQueryData(queryKeys.payment.forTimesheet(TIMESHEET_ID))
    ).toHaveLength(1);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() => usePayments(TIMESHEET_ID));

    expect(result.current.isPending).toBe(true);
    expect(listMock).not.toHaveBeenCalled();
  });
});
