/**
 * @module domains/timesheet/__tests__/RecordPaymentSheet.test
 *
 * The parent's "Mark as paid" sheet. Three things this pins: the amount
 * PREFILLS to what is still outstanding (the overwhelmingly common case is
 * "I just paid the rest"), the submitted payload is minor units built by
 * `parseMajorToMinor` and nothing else, and the server's over-payment
 * refusal is stated with the server's OWN figures rather than a guess.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
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

// The sheet recomputes "today" from the household zone at SUBMIT time (a
// sheet left open across midnight must not date the payment yesterday), so
// the clock is pinned here rather than the test being written against
// whatever day it happens to run on.
mock.module('@/src/lib/localDate', () => ({
  localDateInZone: () => '2026-08-12',
}));

let RecordPaymentSheet: typeof import('../components/RecordPaymentSheet').RecordPaymentSheet;

beforeAll(async () => {
  RecordPaymentSheet = (await import('../components/RecordPaymentSheet'))
    .RecordPaymentSheet;
});

const onSubmit = mock((_input: unknown) => {});
const onDismiss = mock(() => {});

beforeEach(() => {
  onSubmit.mockClear();
  onDismiss.mockClear();
});

function renderSheet(
  props: Partial<React.ComponentProps<typeof RecordPaymentSheet>> = {}
) {
  return render(
    <RecordPaymentSheet
      visible
      onDismiss={onDismiss}
      onSubmit={onSubmit}
      isSubmitting={false}
      outstandingMinor={11612}
      currency="GBP"
      todayISO="2026-08-12"
      householdTimezone="UTC"
      carerName="Amara"
      weekRangeLabel="3 Aug – 9 Aug"
      overPayment={null}
      {...props}
    />
  );
}

describe('RecordPaymentSheet — prefill', () => {
  it('seeds the amount with the outstanding balance in major units', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('hours-record-payment-amount-input').props.value).toBe(
      '116.12'
    );
  });

  it('seeds nothing when there is no outstanding balance to suggest', () => {
    const { getByTestId } = renderSheet({ outstandingMinor: 0 });

    expect(getByTestId('hours-record-payment-amount-input').props.value).toBe(
      ''
    );
  });
});

// The parent used to assert "I paid Andrea £X" with no visible balance to
// check the typed amount against. `outstandingMinor` was already read here
// (as the prefill) but never displayed — this pins that it is now, above
// the input, as an AmountRow.
describe('RecordPaymentSheet — outstanding balance is echoed, not just prefilled', () => {
  it('renders the outstanding balance as an AmountRow above the amount input', () => {
    const { getByTestId } = renderSheet({ outstandingMinor: 11612 });

    expect(
      getByTestId('hours-record-payment-outstanding-value').props.children
    ).toBe('£116.12');
  });

  it('renders a known-zero outstanding balance rather than omitting the row', () => {
    const { getByTestId } = renderSheet({ outstandingMinor: 0 });

    expect(
      getByTestId('hours-record-payment-outstanding-value').props.children
    ).toBe('£0.00');
  });
});

describe('RecordPaymentSheet — submit payload', () => {
  it('submits the prefilled balance as minor units, dated today, with no method note', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('hours-record-payment-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: 11612,
      paid_at: '2026-08-12',
    });
  });

  it('carries an edited amount and a method note through', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(
      getByTestId('hours-record-payment-amount-input'),
      '50'
    );
    fireEvent.changeText(
      getByTestId('hours-record-payment-method-input'),
      '  Cash  '
    );
    fireEvent.press(getByTestId('hours-record-payment-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: 5000,
      paid_at: '2026-08-12',
      method_note: 'Cash',
    });
  });

  it('submits an earlier settlement date when one is typed', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('hours-record-payment-date-chip-earlier'));
    fireEvent.changeText(
      getByTestId('hours-record-payment-date-input'),
      '2026-08-07'
    );
    fireEvent.press(getByTestId('hours-record-payment-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: 11612,
      paid_at: '2026-08-07',
    });
  });

  it('refuses a future settlement date instead of clamping it', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('hours-record-payment-date-chip-earlier'));
    fireEvent.changeText(
      getByTestId('hours-record-payment-date-input'),
      '2026-09-01'
    );

    expect(getByTestId('hours-record-payment-date-error')).toBeTruthy();
    fireEvent.press(getByTestId('hours-record-payment-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses an unparseable amount rather than guessing at it', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(
      getByTestId('hours-record-payment-amount-input'),
      '.45'
    );

    expect(getByTestId('hours-record-payment-amount-error')).toBeTruthy();
    fireEvent.press(getByTestId('hours-record-payment-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a zero amount — the wire contract has a floor of one penny', () => {
    const { getByTestId, queryByTestId } = renderSheet();

    fireEvent.changeText(getByTestId('hours-record-payment-amount-input'), '0');
    fireEvent.press(getByTestId('hours-record-payment-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(queryByTestId('hours-record-payment-amount-error')).toBeTruthy();
  });
});

describe('RecordPaymentSheet — the server refusal', () => {
  it('states the server’s own figures when the payment exceeded the week', () => {
    const { getByTestId } = renderSheet({
      overPayment: { alreadyPaidMinor: 20000, grossMinor: 23612 },
    });

    // The FIGURES are what make this actionable — the copy around them is a
    // key under the test i18n echo, but these are computed here.
    expect(
      getByTestId('hours-record-payment-overpayment-already-paid-value').props
        .children
    ).toBe('£200.00');
    expect(
      getByTestId('hours-record-payment-overpayment-gross-value').props.children
    ).toBe('£236.12');
  });

  it('shows no refusal banner when there is nothing to refuse', () => {
    const { queryByTestId } = renderSheet();

    expect(queryByTestId('hours-record-payment-overpayment-error')).toBeNull();
  });
});
