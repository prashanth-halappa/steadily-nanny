/**
 * @module domains/timesheet/__tests__/PaymentDetailSheet.test
 *
 * One payment's leaf. Two rows carry the whole point of the screen and are
 * deliberately ADJACENT and differently labelled: "date the money moved"
 * (`paid_at`) and "entered in Steadily" (`created_at`). They are different
 * facts, and the gap between them is what makes a missing transfer findable —
 * merging them would delete the only signal there is.
 *
 * Nothing here edits, voids or deletes: `payments` is append-only server-side
 * (no PATCH route, no DELETE route), and the sheet says so.
 *
 * `t` echoes its key and drops interpolation params (`bun.setup.ts`).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { fireEvent, render } from '@testing-library/react-native';
import type React from 'react';

const pushMock = mock((_href: string) => {});

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: mock(),
    back: mock(),
    navigate: mock(),
  }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));

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

let PaymentDetailSheet: typeof import('../components/PaymentDetailSheet').PaymentDetailSheet;

beforeAll(async () => {
  PaymentDetailSheet = (await import('../components/PaymentDetailSheet'))
    .PaymentDetailSheet;
});

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    timesheet_id: '44444444-4444-4444-8444-444444444444',
    household_id: '22222222-2222-4222-8222-222222222222',
    carer_id: '33333333-3333-4333-8333-333333333333',
    amount_minor: 62_400,
    currency: 'GBP',
    paid_at: '2026-08-16',
    method_note: 'Bank transfer',
    recorded_by: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-20T09:30:00.000Z',
    ...overrides,
  };
}

function renderSheet(
  props: Partial<React.ComponentProps<typeof PaymentDetailSheet>> = {}
) {
  return render(
    <PaymentDetailSheet
      visible
      onDismiss={() => {}}
      payment={makePayment()}
      weekStart="2026-08-10"
      paidToName="Amara"
      recordedByName="Priya"
      {...props}
    />
  );
}

beforeEach(() => {
  pushMock.mockClear();
});

describe('PaymentDetailSheet — the facts', () => {
  it('states the amount under the Recorded label', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('payments-detail-amount').props.children).toBe(
      '£624.00'
    );
    expect(getByTestId('payments-detail-amount-label').props.children).toBe(
      'payments.recordedLabel'
    );
  });

  // The load-bearing pair. Same payment, two different dates, two different
  // labels, both on screen at once.
  it('shows "paid on" and "recorded on" as two adjacent, differently-labelled rows', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('payments-detail-paid-on-label').props.children).toBe(
      'payments.detail.paidOn'
    );
    expect(getByTestId('payments-detail-paid-on-value').props.children).toBe(
      '16 August'
    );
    expect(
      getByTestId('payments-detail-recorded-on-label').props.children
    ).toBe('payments.detail.recordedOn');
    // `created_at` is an instant, so it carries a time — that is the whole
    // difference between this row and the one above it.
    expect(
      getByTestId('payments-detail-recorded-on-value').props.children
    ).toContain('20 August');
    expect(
      getByTestId('payments-detail-recorded-on-value').props.children
    ).not.toBe(getByTestId('payments-detail-paid-on-value').props.children);
  });

  it('names the carer for a parent', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('payments-detail-paid-to-value').props.children).toBe(
      'Amara'
    );
  });

  it('omits the paid-to row for a nanny reading her own record', () => {
    const { queryByTestId } = renderSheet({ paidToName: null });

    expect(queryByTestId('payments-detail-paid-to')).toBeNull();
  });

  it('states the method note verbatim', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('payments-detail-method-value').props.children).toBe(
      'Bank transfer'
    );
  });

  it('states an unstated method rather than a blank row', () => {
    const { getByTestId } = renderSheet({
      payment: makePayment({ method_note: null }),
    });

    expect(getByTestId('payments-detail-method-value').props.children).toBe(
      'payments.detail.methodUnstated'
    );
  });

  // 033 discipline: a parent deleting her account nulls `recorded_by` and
  // leaves the payment intact. A raw uuid — or a blank — on a money row is
  // worse than saying plainly that the person is gone.
  it('says the recorder is gone when recorded_by is null — never blank, never a uuid', () => {
    const { getByTestId, queryByText } = renderSheet({
      payment: makePayment({ recorded_by: null }),
      recordedByName: null,
    });

    const value = getByTestId('payments-detail-recorded-by-value');
    expect(value.props.children).toBe('payments.detail.recordedByGone');
    expect(value.props.children).not.toBe('');
    expect(queryByText('11111111-1111-4111-8111-111111111111')).toBeNull();
  });

  it('carries the append-only note — no edit, no delete, no void', () => {
    const { getByTestId, queryByText } = renderSheet();

    expect(getByTestId('payments-detail-append-only').props.children).toBe(
      'payments.detail.appendOnly'
    );
    expect(queryByText('Delete')).toBeNull();
    expect(queryByText('Edit')).toBeNull();
  });
});

describe('PaymentDetailSheet — the week link', () => {
  it('pushes the hours tab at that week when the for-week row is tapped', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('payments-detail-for-week'));

    expect(pushMock).toHaveBeenCalledWith(
      '/(private)/(tabs)/hours?weekStart=2026-08-10'
    );
  });

  it('omits the for-week row entirely when the timesheet is not in the join', () => {
    const { queryByTestId } = renderSheet({ weekStart: null });

    expect(queryByTestId('payments-detail-for-week')).toBeNull();
  });
});

describe('PaymentDetailSheet — visibility', () => {
  it('renders nothing while dismissed', () => {
    const { queryByTestId } = renderSheet({ visible: false });

    expect(queryByTestId('payments-detail')).toBeNull();
  });
});
