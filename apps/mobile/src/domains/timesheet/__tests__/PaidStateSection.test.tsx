/**
 * @module domains/timesheet/__tests__/PaidStateSection.test
 *
 * The approved week's settlement SECTION — since Daylight v2 it renders no
 * card of its own (`WeekMoneyCard` owns the one card the money block gets),
 * but every figure it states is unchanged: the Paid / Partially paid /
 * Unpaid badge, the ledger of what has actually landed, and — parents only —
 * the way to record another payment. The carer sees the identical section
 * minus the button, which is the whole point: both sides read the SAME
 * figures.
 *
 * `hasPaidStateContent` is the same predicate the section gates itself on and
 * `WeekMoneyCard` asks before drawing a card at all — so the two can never
 * disagree about whether there is a settlement to talk about.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { spacing } from '@/lib/design-tokens/spacing';
import { serializeTree } from '@/src/test-utils';
import {
  hasPaidStateContent,
  PaidStateSection,
} from '../components/PaidStateSection';
import { derivePaidState } from '../utils/paidState';

const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    timesheet_id: TIMESHEET_ID,
    household_id: '22222222-2222-4222-8222-222222222222',
    carer_id: '33333333-3333-4333-8333-333333333333',
    amount_minor: 12000,
    kind: 'payment',
    corrects_payment_id: null,
    correction_reason: null,
    currency: 'GBP',
    paid_at: '2026-08-11',
    method_note: 'Bank transfer',
    recorded_by: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-11T09:30:00.000Z',
    ...overrides,
  };
}

function renderCard(
  props: Partial<React.ComponentProps<typeof PaidStateSection>> = {}
) {
  const payments = props.payments ?? [];
  return render(
    <PaidStateSection
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

describe('PaidStateSection — badge states', () => {
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

  it('renders NOTHING for a genuinely zero-value week with no payments — there is no settlement to talk about', () => {
    const { queryByTestId } = renderCard({
      payments: [],
      paidState: derivePaidState([], 0),
    });

    expect(queryByTestId('hours-paid-state')).toBeNull();
  });

  it('still renders a zero-gross week that HAS a recorded payment — the ledger row is a fact', () => {
    const payments = [makePayment({ id: 'p1', amount_minor: 5000 })];
    const { getByTestId } = renderCard({
      payments,
      paidState: derivePaidState(payments, 0),
    });

    expect(getByTestId('hours-paid-state')).toBeTruthy();
    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '£50.00'
    );
  });
});

describe('hasPaidStateContent — the predicate WeekMoneyCard shares', () => {
  it('is false with no server gross, whatever the ledger says', () => {
    expect(hasPaidStateContent(null, [])).toBe(false);
    expect(hasPaidStateContent(null, [makePayment()])).toBe(false);
  });

  it('is false for a zero-gross week with an empty ledger', () => {
    expect(hasPaidStateContent(derivePaidState([], 0), [])).toBe(false);
  });

  it('is true once there is either a gross or a payment', () => {
    expect(hasPaidStateContent(derivePaidState([], 23612), [])).toBe(true);
    const payments = [makePayment({ amount_minor: 5000 })];
    expect(hasPaidStateContent(derivePaidState(payments, 0), payments)).toBe(
      true
    );
  });
});

describe('PaidStateSection — the ledger', () => {
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

// A failed or still-in-flight payments read must never render as "nothing
// paid" — D-B1, docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B's compound finding.
describe('PaidStateSection — paidStateUnknown', () => {
  it('withholds the badge and every amount, and never offers Mark as paid', () => {
    const { getByTestId, queryByTestId } = renderCard({
      paidStateUnknown: true,
      onMarkPaidPress: mock(() => {}),
      payments: [makePayment({ amount_minor: 23612 })],
      paidState: derivePaidState([makePayment({ amount_minor: 23612 })], 23612),
    });

    expect(getByTestId('hours-paid-state')).toBeTruthy();
    expect(queryByTestId('hours-paid-state-badge')).toBeNull();
    expect(queryByTestId('hours-paid-state-total-value')).toBeNull();
    expect(queryByTestId('hours-paid-state-balance-value')).toBeNull();
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
  });

  it('renders an inline retry that calls onRetryPayments when pressed', () => {
    const onRetryPayments = mock(() => {});
    const { getByTestId, getByText } = renderCard({
      paidStateUnknown: true,
      onRetryPayments,
    });

    expect(getByText('paid.unknown')).toBeTruthy();
    fireEvent.press(getByTestId('hours-paid-state-retry-button'));
    expect(onRetryPayments).toHaveBeenCalledTimes(1);
  });

  it('still renders the section (title) even when the real paidState is null — unknown is not "nothing to say"', () => {
    const { getByTestId } = renderCard({
      paidStateUnknown: true,
      paidState: null,
      payments: [],
    });

    expect(getByTestId('hours-paid-state')).toBeTruthy();
    expect(getByTestId('hours-paid-state-title')).toBeTruthy();
  });
});

describe('PaidStateSection — who may act', () => {
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

// A ledger line that opens its own payment. `onPaymentPress` follows the
// same read-only idiom as `onMarkPaidPress`: without it the block is exactly
// what it was, chevron included — a chevron with no destination is a lie.
describe('PaidStateSection — opening a payment', () => {
  it('leaves every line inert with no handler — no chevron, nothing to press', () => {
    const { queryByTestId, getByTestId, UNSAFE_queryByType } = renderCard({
      payments: [makePayment({ id: 'p1', amount_minor: 12000 })],
    });

    expect(queryByTestId('hours-paid-state-line-p1-open')).toBeNull();
    expect(UNSAFE_queryByType('ChevronRight' as never)).toBeNull();
    // The line itself is untouched.
    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '£120.00'
    );
  });

  it('makes the line pressable with a chevron once a handler is supplied', () => {
    const { getByTestId, UNSAFE_queryByType } = renderCard({
      payments: [makePayment({ id: 'p1', amount_minor: 12000 })],
      onPaymentPress: mock(() => {}),
    });

    const open = getByTestId('hours-paid-state-line-p1-open');
    expect(open.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(open.props.style).minHeight).toBe(
      spacing.minTouchTarget
    );
    expect(UNSAFE_queryByType('ChevronRight' as never)).toBeTruthy();
    // The money testID stays on the AmountRow, not on the wrapper.
    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '£120.00'
    );
  });

  it('hands back the payment that was actually tapped', () => {
    const onPaymentPress = mock(() => {});
    const second = makePayment({ id: 'p2', amount_minor: 3612 });
    const { getByTestId } = renderCard({
      payments: [makePayment({ id: 'p1', amount_minor: 10000 }), second],
      onPaymentPress,
    });

    fireEvent.press(getByTestId('hours-paid-state-line-p2-open'));
    expect(onPaymentPress).toHaveBeenCalledWith(second);
  });

  // The line and its detail sheet are one tap apart; a figure that changes
  // currency between them is a trust bug on a money screen.
  it('states each payment in ITS OWN currency, not the section currency', () => {
    const { getByTestId } = renderCard({
      payments: [
        makePayment({ id: 'p1', amount_minor: 12000, currency: 'EUR' }),
      ],
    });

    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '€120.00'
    );
    // The week-scoped rows above keep the section currency.
    expect(getByTestId('hours-paid-state-total-value').props.children).toBe(
      '£120.00'
    );
  });
});

// D-20, attention spec §4.1 — the spec's own worked ledger: David records one
// £462.00 Zelle transfer twice, and corrects the duplicate.
//
//   £462.00   Paid 16 Aug · Zelle
//    −£462.00 Correction 18 Aug · recorded twice
//   £462.00   Paid 16 Aug · Zelle
//   £462.00 paid · nothing still owed
//
// 46_200 + (−46_200) + 46_200 = 46_200 against a 46_200 gross, so the balance
// row disappears entirely. Hand-computed, integer minor units throughout.
describe('PaidStateSection — corrections', () => {
  const original = () =>
    makePayment({
      id: 'p1',
      amount_minor: 46_200,
      paid_at: '2026-08-16',
      method_note: 'Zelle',
    });
  const correction = () =>
    makePayment({
      id: 'c1',
      amount_minor: -46_200,
      kind: 'correction',
      corrects_payment_id: 'p1',
      correction_reason: 'recorded twice',
      paid_at: '2026-08-18',
      method_note: null,
    });
  const duplicate = () =>
    makePayment({
      id: 'p2',
      amount_minor: 46_200,
      paid_at: '2026-08-16',
      method_note: 'Zelle',
    });

  const renderLedger = () => {
    const payments = [original(), correction(), duplicate()];
    return renderCard({
      payments,
      paidState: derivePaidState(payments, 46_200),
    });
  };

  it('states the correction as a negative figure, and leaves the original at its full amount', () => {
    const { getByTestId } = renderLedger();

    // A ledger that quietly restates history is the thing this whole
    // mechanism exists to avoid — p1 is untouched.
    expect(getByTestId('hours-paid-state-line-p1-value').props.children).toBe(
      '£462.00'
    );
    expect(getByTestId('hours-paid-state-line-c1-value').props.children).toBe(
      '-£462.00'
    );
  });

  it('renders the correction directly under the payment it corrects, indented one step', () => {
    const { getByTestId, toJSON } = renderLedger();

    const order = serializeTree(toJSON()).match(
      /hours-paid-state-line-[a-z0-9]+"/g
    );
    expect(order).toEqual([
      'hours-paid-state-line-p1"',
      'hours-paid-state-line-c1"',
      'hours-paid-state-line-p2"',
    ]);
    expect(
      StyleSheet.flatten(
        getByTestId('hours-paid-state-correction-c1').props.style
      ).paddingLeft
    ).toBe(spacing.md);
  });

  it('renders the reason on the row — it is what makes a reversal readable a year later', () => {
    const { getByText } = renderLedger();

    expect(getByText('recorded twice')).toBeTruthy();
  });

  it('nets the signed sum into paid-to-date and drops the balance row', () => {
    const { getByTestId, queryByTestId } = renderLedger();

    expect(getByTestId('hours-paid-state-total-value').props.children).toBe(
      '£462.00'
    );
    expect(queryByTestId('hours-paid-state-balance-value')).toBeNull();
  });

  // A correction whose original is not in this list would otherwise vanish —
  // a money row disappearing from a ledger is the worst failure this
  // component has.
  it('still shows a correction whose original is missing from the ledger', () => {
    const payments = [correction()];
    const { getByTestId } = renderCard({
      payments,
      paidState: derivePaidState(payments, 46_200),
    });

    expect(getByTestId('hours-paid-state-line-c1-value').props.children).toBe(
      '-£462.00'
    );
  });
});
