/**
 * @module domains/timesheet/__tests__/PaidStateCard.test
 *
 * The approved week's settlement card: the Paid / Partially paid / Unpaid
 * badge, the ledger of what has actually landed, and — parents only — the
 * way to record another payment. The carer sees the identical card minus the
 * button, which is the whole point: both sides read the SAME figures.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { fireEvent, render, within } from '@testing-library/react-native';
import { PaidStateCard } from '../components/PaidStateCard';
import { derivePaidState } from '../utils/paidState';

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
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
    ...overrides,
  };
}

function renderCard(
  props: Partial<React.ComponentProps<typeof PaidStateCard>> = {}
) {
  const payments = props.payments ?? [];
  return render(
    <PaidStateCard
      payments={payments}
      paidState={
        props.paidState !== undefined
          ? props.paidState
          : derivePaidState(payments, 23612)
      }
      currency="GBP"
      {...props}
    />
  );
}

describe('PaidStateCard — badge states', () => {
  it('reads Unpaid with the full gross outstanding when nothing has been recorded', () => {
    const { getByTestId } = renderCard({ payments: [] });

    expect(getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgeUnpaid'
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£236.12'
    );
  });

  it('reads Partially paid with the EXACT remainder — £120.00 of £236.12 leaves £116.12', () => {
    const { getByTestId } = renderCard({
      payments: [makePayment({ amount_minor: 12000 })],
    });

    expect(getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgePartial'
    );
    expect(getByTestId('hours-paid-state-total-value').props.children).toBe(
      '£120.00'
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£116.12'
    );
  });

  it('sums several partial payments before deciding the badge', () => {
    const { getByTestId } = renderCard({
      payments: [
        makePayment({ id: 'p1', amount_minor: 10000 }),
        makePayment({ id: 'p2', amount_minor: 3612 }),
      ],
    });

    expect(getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgePartial'
    );
    expect(getByTestId('hours-paid-state-total-value').props.children).toBe(
      '£136.12'
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£100.00'
    );
  });

  it('reads Paid and drops the outstanding row entirely once the week is settled', () => {
    const { getByTestId, queryByTestId } = renderCard({
      payments: [makePayment({ amount_minor: 23612 })],
    });

    expect(getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgePaid'
    );
    expect(queryByTestId('hours-paid-state-balance-value')).toBeNull();
  });

  it('renders NOTHING when the week has no server gross — a missing total is not a zero total', () => {
    const { queryByTestId } = renderCard({
      payments: [],
      paidState: derivePaidState([], null),
    });

    expect(queryByTestId('hours-paid-state')).toBeNull();
  });
});

describe('PaidStateCard — the ledger', () => {
  it('lists each recorded payment with its amount, date and method note', () => {
    const { getByTestId } = renderCard({
      payments: [
        makePayment({
          id: 'p1',
          amount_minor: 12000,
          paid_at: '2026-08-11',
          method_note: 'Bank transfer',
        }),
      ],
    });

    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '£120.00'
    );
    const line = within(getByTestId('hours-paid-state-line-p1'));
    expect(line.getByText('11 August')).toBeTruthy();
    expect(line.getByText('Bank transfer')).toBeTruthy();
  });

  it('renders the date alone when no method note was given', () => {
    const { getByTestId } = renderCard({
      payments: [makePayment({ id: 'p1', method_note: null })],
    });

    expect(
      within(getByTestId('hours-paid-state-line-p1')).queryByText(
        'Bank transfer'
      )
    ).toBeNull();
  });
});

describe('PaidStateCard — who may act', () => {
  it('offers "Mark as paid" only when a handler is supplied (the parent view)', () => {
    const onMarkPaidPress = mock(() => {});
    const { getByTestId } = renderCard({ onMarkPaidPress });

    fireEvent.press(getByTestId('hours-mark-paid-button'));
    expect(onMarkPaidPress).toHaveBeenCalled();
  });

  it('is READ-ONLY with no handler — the carer sees the figures and no way to change them', () => {
    const { queryByTestId, getByTestId } = renderCard({
      payments: [makePayment({ id: 'p1', amount_minor: 12000 })],
    });

    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    // She still sees exactly what the parent sees.
    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '£120.00'
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£116.12'
    );
  });

  it('hides the action once the week is fully settled — there is nothing left to record', () => {
    const { queryByTestId } = renderCard({
      payments: [makePayment({ amount_minor: 23612 })],
      onMarkPaidPress: mock(() => {}),
    });

    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
  });
});
