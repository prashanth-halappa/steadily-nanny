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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { fireEvent, render } from '@testing-library/react-native';
import type React from 'react';

const pushMock = mock((_href: string) => {});

mock.module('expo-router', () => ({
  // `SettingsHeaderButton` in the header band reaches for the singleton.
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
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
    kind: 'payment',
    corrects_payment_id: null,
    correction_reason: null,
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
  // leaves the payment intact. The sheet no longer decides the fallback
  // word itself (it used to, and disagreed with NannyWeekView/ParentWeekView
  // — 'No longer in this household' vs 'Someone', one fact printed two
  // ways). Every caller now resolves through `resolveMemberDisplayName`
  // before handing this prop down, so this only pins that the sheet
  // renders whatever string it is given, verbatim — never blank, never a
  // raw uuid.
  it('renders the caller-resolved name verbatim, never blank, never a raw uuid', () => {
    const { getByTestId, queryByText } = renderSheet({
      payment: makePayment({ recorded_by: null }),
      recordedByName: 'detail.someone',
    });

    const value = getByTestId('payments-detail-recorded-by-value');
    expect(value.props.children).toBe('detail.someone');
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
  // The route now lands on the week with the earnings breakdown already
  // open — one hop, not two. `breakdown=1` is the request; `HoursScreen`
  // consumes and clears it.
  it('pushes the hours tab at that week AND asks for the breakdown', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('payments-detail-for-week'));

    expect(pushMock).toHaveBeenCalledWith(
      '/(private)/(tabs)/hours?weekStart=2026-08-10&breakdown=1'
    );
  });

  it('omits the for-week row entirely when the timesheet is not in the join', () => {
    const { queryByTestId } = renderSheet({ weekStart: null });

    expect(queryByTestId('payments-detail-for-week')).toBeNull();
  });

  // The defect this exists to fix: `text-primary` (#5B3E5D) against
  // `text-foreground` (#2A1F2B) is two dark plums, so colour alone made the
  // row read as static text and nobody found the route. The chevron is the
  // second channel (colour + iconography) docs/design/01-LAWS.md requires.
  it('carries a trailing chevron on the pressable for-week row', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('payments-detail-for-week-chevron')).toBeTruthy();
  });

  // A chevron with no destination is a lie, and a RESERVED slot on a
  // non-pressable row would shift the value column for no reason.
  it('gives the read-only rows no chevron and no reserved slot', () => {
    const { queryByTestId } = renderSheet();

    expect(queryByTestId('payments-detail-paid-on-chevron')).toBeNull();
    expect(queryByTestId('payments-detail-recorded-on-chevron')).toBeNull();
    expect(queryByTestId('payments-detail-paid-to-chevron')).toBeNull();
    expect(queryByTestId('payments-detail-recorded-by-chevron')).toBeNull();
    expect(queryByTestId('payments-detail-method-chevron')).toBeNull();
  });
});

// D-20, attention spec §4.1. Correcting is the PAYER's act: the action is a
// prop the parent view passes and nobody else does, so "who may correct" is
// one call site rather than a role check inside this component. It is NOT
// `onFlagPress` — that is the carer's "this doesn't look right" (§3.1) and
// the two must never collapse into one control.
describe('PaymentDetailSheet — correcting a payment', () => {
  it('offers the correction only when the caller passes the action', () => {
    const { queryByTestId } = renderSheet();

    expect(queryByTestId('payments-detail-correct')).toBeNull();
  });

  it('hands the payment back when the correction action is pressed', () => {
    const onCorrectPress = mock((_payment: Payment) => {});
    const payment = makePayment();
    const { getByTestId } = renderSheet({ payment, onCorrectPress });

    fireEvent.press(getByTestId('payments-detail-correct'));

    expect(onCorrectPress).toHaveBeenCalledWith(payment);
  });

  // One level, no chains: correcting a correction is a new payment, and a
  // chain of reversals is a thing nobody can read back a year later.
  it('never offers to correct a correction, even when the action is passed', () => {
    const { queryByTestId } = renderSheet({
      payment: makePayment({
        kind: 'correction',
        amount_minor: -62_400,
        corrects_payment_id: '77777777-7777-4777-8777-777777777777',
        correction_reason: 'recorded twice',
      }),
      onCorrectPress: mock(() => {}),
    });

    expect(queryByTestId('payments-detail-correct')).toBeNull();
  });
});

describe('PaymentDetailSheet — visibility', () => {
  it('renders nothing while dismissed', () => {
    const { queryByTestId } = renderSheet({ visible: false });

    expect(queryByTestId('payments-detail')).toBeNull();
  });
});

// Flagging WRITES DATA (attention spec §3.1). 01-LAWS 5.G reserves
// `text-primary` for navigation that changes nothing; ghost is the right
// control for an optional reversible write. bun.setup stubs buttonVariants,
// so variant/size are pinned by source inspection, not render props.
describe('PaymentDetailSheet — flag is a ghost Button, not a text-primary link', () => {
  it('hands the payment back when the flag action is pressed', () => {
    const onFlagPress = mock((_payment: Payment) => {});
    const payment = makePayment();
    const { getByTestId } = renderSheet({ payment, onFlagPress });

    fireEvent.press(getByTestId('payments-detail-flag'));

    expect(onFlagPress).toHaveBeenCalledWith(payment);
  });

  it('omits the flag control when onFlagPress is not passed', () => {
    const { queryByTestId } = renderSheet();

    expect(queryByTestId('payments-detail-flag')).toBeNull();
  });

  it('renders the flag as Button variant="ghost" size="sm" (source)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../components/PaymentDetailSheet.tsx'),
      'utf8'
    );
    const flat = src.replace(/\s+/g, ' ');
    const flagIdx = flat.indexOf('testID={`${testID}-flag`}');
    expect(flagIdx).toBeGreaterThan(-1);
    // Window around the flag control — not DetailRow's navigation link.
    const flagWindow = flat.slice(Math.max(0, flagIdx - 80), flagIdx + 200);
    expect(flagWindow).toContain('<Button');
    expect(flagWindow).toContain('variant="ghost"');
    expect(flagWindow).toContain('size="sm"');
    expect(flagWindow).not.toContain('<Pressable');
    expect(flagWindow).not.toContain('text-primary');
  });
});
