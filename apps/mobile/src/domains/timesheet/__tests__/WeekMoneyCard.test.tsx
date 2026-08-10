/**
 * @module domains/timesheet/__tests__/WeekMoneyCard.test
 *
 * The one card the money block gets (docs/design/screens-hours.md §5): what
 * the week is worth, and whether it has been paid. The two halves used to be
 * a band inside `WeekTotal` and a footer card a screen below it.
 *
 * The rule this suite exists for is the DISAPPEARANCE: an empty white
 * rectangle on a money screen reads as a figure that failed to load, so the
 * card must render nothing at all when neither half has anything true to say
 * — and must still appear when only ONE of them does.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { fireEvent, render, within } from '@testing-library/react-native';
import { WeekMoneyCard } from '../components/WeekMoneyCard';
import type { WeekEarningsStateResult } from '../types';
import { derivePaidState } from '../utils/paidState';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
}));

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';

const okEarnings: WeekEarningsStateResult = {
  status: 'ok',
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [],
  gross_minor: 23612,
  reimbursements_minor: 0,
  worked_minutes: 2460,
  payable_minutes: 2460,
  guaranteed_minutes_per_week: null,
};

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
  props: Partial<React.ComponentProps<typeof WeekMoneyCard>> = {}
) {
  return render(
    <WeekMoneyCard
      earnings={null}
      timesheetStatus="submitted"
      viewerRole="parent"
      carerId="carer-1"
      carerDisplayName="Amara"
      totalMinutes={2460}
      paidState={null}
      payments={[]}
      settlementCurrency="GBP"
      {...props}
    />
  );
}

describe('WeekMoneyCard — when it exists at all', () => {
  it('renders NOTHING with neither earnings content nor a paid state', () => {
    const { queryByTestId } = renderCard();

    expect(queryByTestId('hours-money-card')).toBeNull();
    expect(queryByTestId('hours-earnings-line')).toBeNull();
    expect(queryByTestId('hours-paid-state')).toBeNull();
  });

  it('renders NOTHING for a zero-hours, zero-gross week with no payments', () => {
    const { queryByTestId } = renderCard({
      earnings: { ...okEarnings, gross_minor: 0, worked_minutes: 0 },
      totalMinutes: 0,
      paidState: derivePaidState([], 0),
    });

    expect(queryByTestId('hours-money-card')).toBeNull();
  });

  it('renders the gross when earnings are ok, even with no settlement yet', () => {
    const { getByTestId, queryByTestId } = renderCard({
      earnings: okEarnings,
    });

    expect(getByTestId('hours-money-card')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
    expect(queryByTestId('hours-paid-state')).toBeNull();
  });

  it('renders the paid state alone when earnings are absent but payments exist', () => {
    // A reopened week clears its frozen snapshot; the ledger rows survive, and
    // a carer must still be able to see what actually landed.
    const payments = [makePayment({ id: 'p1', amount_minor: 12000 })];
    const { getByTestId, queryByTestId } = renderCard({
      earnings: null,
      paidState: derivePaidState(payments, 0),
      payments,
    });

    expect(getByTestId('hours-money-card')).toBeTruthy();
    expect(queryByTestId('hours-earnings-line')).toBeNull();
    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '£120.00'
    );
  });

  it('renders BOTH halves inside ONE card — never two cards a screen apart', () => {
    const payments = [makePayment({ id: 'p1', amount_minor: 12000 })];
    const { getAllByTestId, getByTestId } = renderCard({
      earnings: okEarnings,
      timesheetStatus: 'approved',
      paidState: derivePaidState(payments, 23612),
      payments,
    });

    expect(getAllByTestId('hours-money-card')).toHaveLength(1);
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
    expect(getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgePartial'
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£116.12'
    );
    // Both sections live INSIDE the same card, not as siblings of it.
    const card = within(getByTestId('hours-money-card'));
    expect(card.getByTestId('hours-earnings-line')).toBeTruthy();
    expect(card.getByTestId('hours-paid-state')).toBeTruthy();
  });
});

describe('WeekMoneyCard — the degraded arms still live in the card', () => {
  it('earnings error: the retry sits INSIDE the card, and the amount is withheld', () => {
    const onRetryEarnings = mock(() => {});
    const { getByTestId, queryByTestId } = renderCard({
      earnings: okEarnings,
      earningsError: true,
      onRetryEarnings,
    });

    const card = within(getByTestId('hours-money-card'));
    expect(card.getByTestId('hours-earnings-line-retry')).toBeTruthy();
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();

    fireEvent.press(getByTestId('hours-earnings-line-retry'));
    expect(onRetryEarnings).toHaveBeenCalledTimes(1);
  });

  it('passes the breakdown handler through to the earnings half', () => {
    const onPressBreakdown = mock(() => {});
    const { getByTestId } = renderCard({
      earnings: okEarnings,
      onPressBreakdown,
    });

    fireEvent.press(getByTestId('hours-earnings-line-pressable'));
    expect(onPressBreakdown).toHaveBeenCalledTimes(1);
  });
});

describe('WeekMoneyCard — who may record a payment', () => {
  const payments = [makePayment({ id: 'p1', amount_minor: 12000 })];

  it('offers "Mark as paid" only when the parent view passes a handler', () => {
    const onMarkPaidPress = mock(() => {});
    const { getByTestId } = renderCard({
      earnings: okEarnings,
      paidState: derivePaidState(payments, 23612),
      payments,
      onMarkPaidPress,
    });

    fireEvent.press(getByTestId('hours-mark-paid-button'));
    expect(onMarkPaidPress).toHaveBeenCalledTimes(1);
  });

  it('is READ-ONLY without one — the carer sees the same figures and no button', () => {
    const { getByTestId, queryByTestId } = renderCard({
      earnings: okEarnings,
      viewerRole: 'nanny',
      paidState: derivePaidState(payments, 23612),
      payments,
    });

    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£116.12'
    );
  });

  it('holds the action down while a record-payment request is in flight', () => {
    const { getByTestId } = renderCard({
      earnings: okEarnings,
      paidState: derivePaidState(payments, 23612),
      payments,
      onMarkPaidPress: mock(() => {}),
      isMarkPaidDisabled: true,
    });

    expect(getByTestId('hours-mark-paid-button').props.disabled).toBe(true);
  });
});

// The parent's STAGED approval-time adjustment. It is decided but not yet
// sent, so it deliberately is NOT inside the estimated gross above it — the
// caption is the only thing that stops two figures on one card looking like
// an arithmetic bug.
describe('WeekMoneyCard — the staged adjustment', () => {
  const staged = {
    amountMinor: -2000,
    note: 'Advance on Friday',
    currency: 'GBP',
  };

  it('renders the row, the note and the "not counted yet" caption', () => {
    const { getByTestId, getByText } = renderCard({
      earnings: okEarnings,
      adjustment: staged,
      onAdjustmentPress: mock(() => {}),
    });

    // Intl renders the minus — the component never hand-prefixes a sign.
    expect(
      getByTestId('hours-money-card-adjustment-row-value').props.children
    ).toBe('-£20.00');
    expect(getByText('Advance on Friday')).toBeTruthy();
    expect(getByText('adjustment.stagedNote')).toBeTruthy();
  });

  it('opens the editor when the staged row is pressed', () => {
    const onAdjustmentPress = mock(() => {});
    const { getByTestId } = renderCard({
      earnings: okEarnings,
      adjustment: staged,
      onAdjustmentPress,
    });

    fireEvent.press(getByTestId('hours-money-card-adjustment'));
    expect(onAdjustmentPress).toHaveBeenCalledTimes(1);
  });

  it('offers the ghost "Add an adjustment" affordance when nothing is staged', () => {
    const onAdjustmentPress = mock(() => {});
    const { getByTestId, queryByTestId } = renderCard({
      earnings: okEarnings,
      onAdjustmentPress,
    });

    expect(queryByTestId('hours-money-card-adjustment')).toBeNull();
    fireEvent.press(getByTestId('hours-money-card-add-adjustment'));
    expect(onAdjustmentPress).toHaveBeenCalledTimes(1);
  });

  it('is READ-ONLY without a handler — the carer sees the figure, never the button', () => {
    const { getByTestId, queryByTestId } = renderCard({
      earnings: okEarnings,
      viewerRole: 'nanny',
      adjustment: staged,
    });

    expect(queryByTestId('hours-money-card-add-adjustment')).toBeNull();
    expect(
      getByTestId('hours-money-card-adjustment-row-value').props.children
    ).toBe('-£20.00');
  });

  it('shows no adjustment surface at all to a viewer with neither', () => {
    const { queryByTestId } = renderCard({
      earnings: okEarnings,
      viewerRole: 'nanny',
    });

    expect(queryByTestId('hours-money-card-adjustment')).toBeNull();
    expect(queryByTestId('hours-money-card-add-adjustment')).toBeNull();
  });

  // The disappear guard now has THREE predicates, not two: a card whose only
  // content is the adjustment still has something true to say.
  it('still renders when the adjustment is the ONLY thing the card has to say', () => {
    const { getByTestId } = renderCard({
      earnings: null,
      totalMinutes: 0,
      paidState: null,
      adjustment: staged,
    });

    expect(getByTestId('hours-money-card')).toBeTruthy();
    expect(getByTestId('hours-money-card-adjustment')).toBeTruthy();
  });

  it('still disappears when there is no adjustment either', () => {
    const { queryByTestId } = renderCard({
      earnings: null,
      totalMinutes: 0,
      paidState: null,
      adjustment: null,
    });

    expect(queryByTestId('hours-money-card')).toBeNull();
  });
});
