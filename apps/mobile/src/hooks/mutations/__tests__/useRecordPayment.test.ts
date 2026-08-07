/**
 * @module hooks/mutations/__tests__/useRecordPayment.test
 * Recording a payment must invalidate BOTH the week's own payment ledger
 * (`queryKeys.payment.forTimesheet`) and `queryKeys.timesheet.all` — the
 * paid badge lives on the week view, which is served from the timesheet
 * cache, so invalidating only the ledger leaves the badge stale.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';

const createMock = mock(() =>
  Promise.resolve({
    id: '66666666-6666-4666-8666-666666666666',
    timesheet_id: TIMESHEET_ID,
    amount_minor: 23612,
    paid_at: '2026-08-11',
    method_note: 'Bank transfer',
  })
);

mock.module('@/src/api/endpoints/payments', () => ({
  paymentApi: { create: createMock },
}));
const showErrorToastMock = mock(() => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useRecordPayment: typeof import('../useRecordPayment').useRecordPayment;

beforeAll(async () => {
  useRecordPayment = (await import('../useRecordPayment')).useRecordPayment;
});

describe('useRecordPayment', () => {
  it('creates the payment and invalidates the ledger AND the timesheet cache', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useRecordPayment()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        timesheetId: TIMESHEET_ID,
        input: {
          amount_minor: 23612,
          paid_at: '2026-08-11',
          method_note: 'Bank transfer',
        },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createMock).toHaveBeenCalledWith(TIMESHEET_ID, {
      amount_minor: 23612,
      paid_at: '2026-08-11',
      method_note: 'Bank transfer',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.payment.forTimesheet(TIMESHEET_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });

  it('surfaces the over-payment refusal as a toast and rejects, so the sheet keeps what was typed', async () => {
    showErrorToastMock.mockClear();
    createMock.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error('too much'), {
          response: {
            status: 400,
            data: {
              error: {
                code: 'VALIDATION_ERROR',
                metadata: {
                  reason: 'PAYMENT_EXCEEDS_GROSS',
                  amountMinor: 900000,
                  alreadyPaidMinor: 20000,
                  grossMinor: 23612,
                },
              },
            },
          },
        })
      )
    );

    const { result } = renderHookWithProviders(() => useRecordPayment());

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          timesheetId: TIMESHEET_ID,
          input: { amount_minor: 900000, paid_at: '2026-08-11' },
        })
      ).rejects.toBeDefined();
    });

    // Its OWN copy, not `errors:validation` — "check the information you
    // entered" is useless against a ceiling the parent cannot see.
    expect(showErrorToastMock).toHaveBeenCalledWith(
      'hours:paid.exceedsGrossError'
    );
  });
});

describe('isOverPaymentError', () => {
  it('reads the server-supplied ceiling so the sheet can state the real figures', async () => {
    const mod = await import('../useRecordPayment');
    const metadata = mod.overPaymentMetadata({
      response: {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            metadata: {
              reason: 'PAYMENT_EXCEEDS_GROSS',
              alreadyPaidMinor: 20000,
              grossMinor: 23612,
            },
          },
        },
      },
    });

    expect(metadata).toEqual({ alreadyPaidMinor: 20000, grossMinor: 23612 });
  });

  it('returns null for anything that is not the over-payment refusal', async () => {
    const mod = await import('../useRecordPayment');
    expect(mod.overPaymentMetadata(new Error('network'))).toBeNull();
    expect(
      mod.overPaymentMetadata({
        response: {
          status: 409,
          data: {
            error: { metadata: { reason: 'PAYMENT_WEEK_NOT_APPROVED' } },
          },
        },
      })
    ).toBeNull();
  });
});
