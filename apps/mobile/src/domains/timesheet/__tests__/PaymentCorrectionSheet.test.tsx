/**
 * @module domains/timesheet/__tests__/PaymentCorrectionSheet.test
 *
 * The parent's "Correct this payment" sheet (D-20, attention spec §4.1).
 * Four things this pins: the amount PREFILLS to the original's full figure
 * (the overwhelmingly common correction is "I recorded that twice"), the
 * reason is REQUIRED, a reversal larger than the original is REFUSED and
 * never clamped, and the submitted payload carries a POSITIVE magnitude —
 * the server owns the sign flip, because asking a human to type a minus to
 * un-record a payment is how a correction ends up adding money.
 *
 * `t` echoes its key and drops interpolation params (`bun.setup.ts`), so the
 * assertions here are on the FIGURES and the payload, never on copy.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { fireEvent, render } from '@testing-library/react-native';
import type React from 'react';

mock.module('@/src/components/custom/BottomSheetBase', () => {
  const R = require('react');
  return {
    BottomSheetBase: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? R.createElement('View', { testID }, children) : null),
  };
});

// A correction is dated the day it is recorded, recomputed from the household
// zone at SUBMIT time — pinned here rather than the test being written
// against whatever day it happens to run on.
mock.module('@/src/lib/localDate', () => ({
  localDateInZone: () => '2026-08-18',
}));

let PaymentCorrectionSheet: typeof import('../components/PaymentCorrectionSheet').PaymentCorrectionSheet;

beforeAll(async () => {
  PaymentCorrectionSheet = (
    await import('../components/PaymentCorrectionSheet')
  ).PaymentCorrectionSheet;
});

/** £462.00, paid by Zelle on 16 Aug — the spec's own worked example. */
function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    timesheet_id: '44444444-4444-4444-8444-444444444444',
    household_id: '22222222-2222-4222-8222-222222222222',
    carer_id: '33333333-3333-4333-8333-333333333333',
    amount_minor: 46_200,
    kind: 'payment',
    corrects_payment_id: null,
    correction_reason: null,
    currency: 'GBP',
    paid_at: '2026-08-16',
    method_note: 'Zelle',
    recorded_by: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-16T09:30:00.000Z',
    ...overrides,
  };
}

const onSubmit = mock((_input: unknown) => {});
const onDismiss = mock(() => {});

beforeEach(() => {
  onSubmit.mockClear();
  onDismiss.mockClear();
});

function renderSheet(
  props: Partial<React.ComponentProps<typeof PaymentCorrectionSheet>> = {}
) {
  return render(
    <PaymentCorrectionSheet
      visible
      onDismiss={onDismiss}
      onSubmit={onSubmit}
      isSubmitting={false}
      payment={makePayment()}
      householdTimezone="UTC"
      refusal={null}
      {...props}
    />
  );
}

describe('PaymentCorrectionSheet — prefill', () => {
  it('seeds the amount with the original payment in major units', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('hours-correct-payment-amount-input').props.value).toBe(
      '462.00'
    );
  });

  it('states the row being corrected with its own figure', () => {
    const { getByTestId } = renderSheet();

    expect(
      getByTestId('hours-correct-payment-original-value').props.children
    ).toBe('£462.00');
  });

  it('seeds an empty reason — a reversal inherits no story', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('hours-correct-payment-reason-input').props.value).toBe(
      ''
    );
  });
});

describe('PaymentCorrectionSheet — submit payload', () => {
  it('submits the full original as a POSITIVE magnitude, dated today', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(
      getByTestId('hours-correct-payment-reason-input'),
      'recorded twice'
    );
    fireEvent.press(getByTestId('hours-correct-payment-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: 46_200,
      paid_at: '2026-08-18',
      reason: 'recorded twice',
    });
  });

  it('carries a partial reversal through — £120.00 of the £462.00', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(
      getByTestId('hours-correct-payment-amount-input'),
      '120'
    );
    fireEvent.changeText(
      getByTestId('hours-correct-payment-reason-input'),
      '  wrong week  '
    );
    fireEvent.press(getByTestId('hours-correct-payment-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: 12_000,
      paid_at: '2026-08-18',
      reason: 'wrong week',
    });
  });
});

describe('PaymentCorrectionSheet — what it refuses', () => {
  it('refuses a reversal larger than the original instead of clamping it', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(
      getByTestId('hours-correct-payment-amount-input'),
      '500'
    );
    fireEvent.changeText(
      getByTestId('hours-correct-payment-reason-input'),
      'recorded twice'
    );

    expect(getByTestId('hours-correct-payment-amount-error')).toBeTruthy();
    fireEvent.press(getByTestId('hours-correct-payment-submit'));
    // Not clamped to 46_200 — nothing at all is submitted.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('withholds submit until a reason is given', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('hours-correct-payment-submit'));
    expect(onSubmit).not.toHaveBeenCalled();

    // Whitespace is not a reason.
    fireEvent.changeText(
      getByTestId('hours-correct-payment-reason-input'),
      '  '
    );
    fireEvent.press(getByTestId('hours-correct-payment-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses an unparseable amount rather than guessing at it', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(
      getByTestId('hours-correct-payment-amount-input'),
      '.45'
    );
    fireEvent.changeText(
      getByTestId('hours-correct-payment-reason-input'),
      'recorded twice'
    );

    expect(getByTestId('hours-correct-payment-amount-error')).toBeTruthy();
    fireEvent.press(getByTestId('hours-correct-payment-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('PaymentCorrectionSheet — the server refusal', () => {
  it('states the server’s own figures when the reversal exceeded what is left', () => {
    // £120.00 of the £462.00 has already been reversed, so £342.00 is left.
    const { getByTestId } = renderSheet({
      refusal: {
        reason: 'exceeds_original',
        originalAmountMinor: 46_200,
        remainingMinor: 34_200,
      },
    });

    expect(
      getByTestId('hours-correct-payment-refusal-original-value').props.children
    ).toBe('£462.00');
    expect(
      getByTestId('hours-correct-payment-refusal-remaining-value').props
        .children
    ).toBe('£342.00');
  });

  it('states a not-correctable refusal without inventing figures for it', () => {
    const { getByTestId, queryByTestId } = renderSheet({
      refusal: { reason: 'not_correctable' },
    });

    expect(getByTestId('hours-correct-payment-refusal')).toBeTruthy();
    expect(
      queryByTestId('hours-correct-payment-refusal-original-value')
    ).toBeNull();
  });

  it('shows no refusal banner when there is nothing to refuse', () => {
    const { queryByTestId } = renderSheet();

    expect(queryByTestId('hours-correct-payment-refusal')).toBeNull();
  });
});
