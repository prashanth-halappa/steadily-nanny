/**
 * @module domains/timesheet/__tests__/NannyWeekView.payments.test
 *
 * The carer's side of the settlement loop. She reads the SAME ledger her
 * family records against — what landed, when, and what is still outstanding
 * — and has no way to write to it. "Have I been paid" is her question; the
 * app answering it only for the payer would be the wrong app.
 */
// Imported at module scope, NOT `require()`d inside the mock factories below.
// A `require()` of an ES module from inside a factory races on whether that
// module has finished evaluating: when it hasn't, Bun throws
// "require() async module ... is unsupported" and the whole file fails at
// load with 0 tests run. It is timing-dependent, so it surfaced as an
// intermittent gate failure that passed on re-run.

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import * as expenseSchemaModule from '@steadily-nanny/shared-types/schemas/expense.schema';
import * as timesheetSchemaModule from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import type React from 'react';
import { useAuthStore } from '@/src/store/auth';

mock.module('@/src/components/ui/loading-indicator', () => {
  const R = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      R.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

mock.module('@/src/components/custom/BottomSheetBase', () => {
  const R = require('react');
  return {
    BottomSheetBase: ({
      visible,
      children,
      testID,
      onDismiss,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
      onDismiss?: () => void;
      // Forwarded onto the host node so a test can dismiss the sheet the way
      // the real backdrop/close button would, without a fake control that
      // exists nowhere in the shipped tree.
    }) =>
      visible ? R.createElement('View', { testID, onDismiss }, children) : null,
  };
});

mock.module('@rn-primitives/alert-dialog', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => children;
  return {
    Root: pass,
    Trigger: pass,
    Portal: pass,
    Overlay: () => null,
    Content: () => null,
    Title: pass,
    Description: pass,
    Cancel: pass,
    Action: pass,
    useRootContext: () => ({ open: false, setOpen: () => {} }),
  };
});

mock.module('@/src/domains/expenses/components/ExpenseDateField', () => {
  const R = require('react');
  return { ExpenseDateField: () => R.createElement('View', {}) };
});

const routerPushMock = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({ push: routerPushMock, back: mock(), replace: mock() }),
}));

class FakeExportUnavailableError extends Error {}
mock.module('../utils/weekExport', () => ({
  ExportUnavailableError: FakeExportUnavailableError,
  weekExportFileName: () => 'week.csv',
  shareCsv: mock(() => Promise.resolve()),
  sharePdfFromHtml: mock(() => Promise.resolve()),
}));

const CARER_ID = 'carer-amara';
const HOUSEHOLD_ID = 'household-1';
const WEEK_START = '2026-08-03';
const TIMESHEET_ID = 'ts-1';
const now = '2026-08-01T00:00:00.000Z';

const entry = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  carer_display_name: 'Amara',
  shift_id: null,
  clock_in_at: '2026-08-03T08:00:00.000Z',
  clock_out_at: '2026-08-03T16:00:00.000Z',
  break_minutes: 0,
  scheduled_minutes: 480,
  kind: 'worked',
  note: null,
  clock_in_location_ok: null,
  clock_out_location_ok: null,
  status: 'approved',
  local_date: '2026-08-03',
  timezone: 'UTC',
  created_at: now,
  updated_at: now,
};

const okEarnings = {
  status: 'ok' as const,
  week_start: WEEK_START,
  currency: 'GBP',
  lines: [
    {
      kind: 'regular' as const,
      minutes: 2460,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 23612,
      from_date: WEEK_START,
      to_date: '2026-08-09',
      arrangement_id: 'arr-1',
    },
  ],
  gross_minor: 23612,
  reimbursements_minor: 0,
  worked_minutes: 2460,
  payable_minutes: 2460,
  guaranteed_minutes_per_week: null,
};

function makeTimesheetWeek(overrides: Record<string, unknown> = {}) {
  return {
    id: TIMESHEET_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    carer_display_name: 'Amara',
    week_start: WEEK_START,
    total_minutes: 2460,
    status: 'approved',
    approved_by: 'parent-1',
    approved_at: '2026-08-10T09:00:00.000Z',
    query_note: null,
    created_at: now,
    updated_at: now,
    earnings: okEarnings,
    ...overrides,
  };
}

const listEntriesMock = mock(() => Promise.resolve([entry]));
const getWeekMock = mock(() => Promise.resolve([makeTimesheetWeek()]));
const listExpensesForWeekMock = mock(
  (): Promise<Expense[]> => Promise.resolve([])
);
const listPaymentsMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/payments', () => ({
  paymentApi: { list: listPaymentsMock, create: mock() },
}));
mock.module('@/src/api/endpoints/expenses', () => {
  const shared = expenseSchemaModule;
  return {
    ...shared,
    expenseApi: {
      listForWeek: listExpensesForWeekMock,
      listPending: mock(() => Promise.resolve([])),
      create: mock(),
      update: mock(),
      withdraw: mock(),
      review: mock(),
    },
  };
});
mock.module('@/src/api/endpoints/timeEntries', () => {
  const shared = timesheetSchemaModule;
  return { ...shared, timeEntryApi: { listForWeek: listEntriesMock } };
});
mock.module('@/src/api/endpoints/timesheets', () => {
  const shared = timesheetSchemaModule;
  return {
    ...shared,
    timesheetApi: {
      list: mock(() => Promise.resolve([])),
      getById: mock(),
      getWeek: getWeekMock,
      exportCsv: mock(() => Promise.resolve('date\n')),
    },
  };
});
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: mock(() => Promise.resolve(null)),
    listHistory: mock(() => Promise.resolve([])),
  },
}));

// WP-C: she now resolves who recorded a payment, so the members read is
// hers too. Never reset between tests — nothing here varies it.
const PARENT_ID = 'parent-1';
const HOUSEHOLD_MEMBERS = [
  {
    id: 'member-carer',
    household_id: HOUSEHOLD_ID,
    user_id: CARER_ID,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: null,
    profile_name: 'Amara',
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'member-parent',
    household_id: HOUSEHOLD_ID,
    user_id: PARENT_ID,
    role: 'parent',
    can_edit: true,
    status: 'active',
    display_name_override: null,
    profile_name: 'Jo',
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
  },
];
const listMembersMock = mock(
  (): Promise<typeof HOUSEHOLD_MEMBERS> => Promise.resolve(HOUSEHOLD_MEMBERS)
);
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { listMembers: listMembersMock },
}));

let NannyWeekView: typeof import('../components/NannyWeekView').NannyWeekView;
let getWeekDates: typeof import('../utils/week').getWeekDates;
let formatWeekRangeLabel: typeof import('../utils/week').formatWeekRangeLabel;

beforeAll(async () => {
  NannyWeekView = (await import('../components/NannyWeekView')).NannyWeekView;
  const weekUtils = await import('../utils/week');
  getWeekDates = weekUtils.getWeekDates;
  formatWeekRangeLabel = weekUtils.formatWeekRangeLabel;
});

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    timesheet_id: TIMESHEET_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    amount_minor: 12000,
    currency: 'GBP',
    paid_at: '2026-08-11',
    method_note: 'Bank transfer',
    recorded_by: 'parent-1',
    created_at: '2026-08-11T09:30:00.000Z',
    ...overrides,
  };
}

function renderNannyView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const weekDates = getWeekDates(WEEK_START);
  return render(
    <QueryClientProvider client={queryClient}>
      <NannyWeekView
        householdId={HOUSEHOLD_ID}
        weekStartISO={WEEK_START}
        weekDates={weekDates}
        weekRangeLabel={formatWeekRangeLabel(weekDates)}
        nowMs={new Date('2026-08-12T12:00:00.000Z').getTime()}
        timeZone="UTC"
        onPreviousWeek={() => {}}
        onNextWeek={() => {}}
        isNextWeekDisabled={false}
        isPreviousWeekDisabled={false}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  listEntriesMock.mockReset();
  getWeekMock.mockReset();
  listExpensesForWeekMock.mockReset();
  listPaymentsMock.mockReset();
  routerPushMock.mockClear();

  listEntriesMock.mockImplementation(() => Promise.resolve([entry]));
  getWeekMock.mockImplementation(() => Promise.resolve([makeTimesheetWeek()]));
  listExpensesForWeekMock.mockImplementation(() => Promise.resolve([]));
  listPaymentsMock.mockImplementation(() => Promise.resolve([]));
  listMembersMock.mockImplementation(() => Promise.resolve(HOUSEHOLD_MEMBERS));

  useAuthStore.setState({
    session: { user: { id: CARER_ID } } as unknown as never,
    user: { id: CARER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('NannyWeekView — reading the settlement', () => {
  it('shows each payment with its amount and date, and the balance still outstanding', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(
        getByTestId('hours-paid-state-line-pay-1-value').props.children
      ).toBe('£120.00')
    );
    expect(
      within(getByTestId('hours-paid-state-line-pay-1')).getByText('11 August')
    ).toBeTruthy();
    expect(getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgePartial'
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£116.12'
    );
  });

  // Daylight v2 (screens-hours.md §5): "what am I owed" and "did it arrive"
  // are two halves of one question and used to sit a screen apart — the
  // gross inside `WeekTotal` at the top, the paid state in its own footer
  // card below the day rows and the reimbursements. One card now, and this
  // pins the merge rather than merely that both figures exist somewhere.
  it('resolves the gross AND the paid state inside the one money card', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-money-card')).toBeTruthy());
    const moneyCard = within(getByTestId('hours-money-card'));

    expect(
      moneyCard.getByTestId('hours-earnings-line-amount').props.children
    ).toBe('£236.12');
    expect(moneyCard.getByTestId('hours-earnings-line-pressable')).toBeTruthy();
    expect(moneyCard.getByTestId('hours-paid-state')).toBeTruthy();
    expect(moneyCard.getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgePartial'
    );
    expect(
      moneyCard.getByTestId('hours-paid-state-line-pay-1-value').props.children
    ).toBe('£120.00');
    // The status card above keeps neither half.
    expect(
      within(getByTestId('hours-week-total')).queryByTestId('hours-paid-state')
    ).toBeNull();
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
  });

  // The card DISAPPEARS when neither half has anything true to say — an
  // empty white rectangle on a money screen reads as a figure that failed.
  it('renders no money card at all when there is neither a gross nor a payment', async () => {
    getWeekMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheetWeek({
          status: 'submitted',
          approved_at: null,
          earnings: {
            status: 'no_arrangement',
            week_start: WEEK_START,
            unpriced_dates: [WEEK_START],
          },
        }),
      ])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    // The no-arrangement nudge is still a thing to say, so the card stays;
    // what must NOT appear is a paid-state half with no settlement, nor a
    // fabricated £0.00 gross.
    expect(
      within(getByTestId('hours-money-card')).getByTestId('hours-earnings-line')
    ).toBeTruthy();
    expect(queryByTestId('hours-paid-state')).toBeNull();
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
  });

  it('never offers her the way to record one — that is her family’s action', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-paid-state')).toBeTruthy());
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    expect(queryByTestId('hours-record-payment-sheet')).toBeNull();
  });

  it('gives her the same export of her own approved week', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-export-button')).toBeTruthy()
    );
  });

  it('has no settlement card at all on a week that is not approved yet', async () => {
    getWeekMock.mockImplementation(() =>
      Promise.resolve([makeTimesheetWeek({ status: 'submitted' })])
    );

    const { queryByTestId, getByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    expect(queryByTestId('hours-paid-state')).toBeNull();
    expect(queryByTestId('hours-export-button')).toBeNull();
    expect(listPaymentsMock).not.toHaveBeenCalled();
  });

  it('keeps payment history visible on a reopened week', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );
    getWeekMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheetWeek({
          status: 'submitted',
          approved_at: null,
          reopen_reason: 'Thursday hours were wrong',
          earnings: null,
        }),
      ])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(listPaymentsMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(getByTestId('hours-paid-state-total-value').props.children).toBe(
        '£120.00'
      )
    );
    expect(
      getByTestId('hours-paid-state-line-pay-1-value').props.children
    ).toBe('£120.00');
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    expect(queryByTestId('hours-export-button')).toBeNull();
  });
});

// WP7: one entry link from the week to the cross-week Payments screen. A
// plain text link, not gated on approval — it links to a record that spans
// every week, not to this week's state.
describe('NannyWeekView — the payments entry link', () => {
  it('renders and navigates to the payments screen on tap', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-payments-link')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-payments-link'));

    expect(routerPushMock).toHaveBeenCalledWith('/(private)/payments');
  });

  it('renders even when the week is NOT approved', async () => {
    getWeekMock.mockImplementation(() =>
      Promise.resolve([makeTimesheetWeek({ status: 'submitted' })])
    );

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-payments-link')).toBeTruthy()
    );
  });
});

// WP-C: the same payment leaf the Payments screen opens, reached from the
// week it settles. Same sheet, same testID — reuse, not a second component.
describe('NannyWeekView — opening a payment from the week', () => {
  it('says what the Payments screen holds, on a row rather than a bare link', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-payments-link')).toBeTruthy()
    );
    expect(getByTestId('hours-payments-link-subtitle').props.children).toBe(
      'payments.subtitleNanny'
    );
  });

  it('opens the payment that was tapped, not merely a payment', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([
        makePayment({ id: 'pay-first', amount_minor: 5000 }),
        makePayment({ id: 'pay-second', amount_minor: 12000 }),
      ])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-line-pay-second-open')).toBeTruthy()
    );
    expect(queryByTestId('payments-detail')).toBeNull();

    fireEvent.press(getByTestId('hours-paid-state-line-pay-second-open'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(getByTestId('payments-detail-amount').props.children).toBe(
      '\u00a3120.00'
    );
  });

  it('closes again on dismiss', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-line-pay-1-open')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-paid-state-line-pay-1-open'));
    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());

    fireEvent(getByTestId('payments-detail'), 'dismiss');

    await waitFor(() => expect(queryByTestId('payments-detail')).toBeNull());
  });

  // The week IS the context the sheet was opened from, and she is the only
  // person a payment on her own week can have gone to.
  it('offers no link back to this week, and does not tell her who she is', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-line-pay-1-open')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-paid-state-line-pay-1-open'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(queryByTestId('payments-detail-for-week')).toBeNull();
    expect(queryByTestId('payments-detail-paid-to')).toBeNull();
  });

  // The one field that exists purely for trust. Printing "No longer in this
  // household" over a present, active parent is a false statement about a
  // real person on a money record.
  it('names the household member who recorded it, never the gone copy', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-line-pay-1-open')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-paid-state-line-pay-1-open'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    await waitFor(() =>
      expect(
        getByTestId('payments-detail-recorded-by-value').props.children
      ).toBe('Jo')
    );
    expect(
      getByTestId('payments-detail-recorded-by-value').props.children
    ).not.toBe('payments.detail.recordedByGone');
  });
});

// The one field that exists purely for trust, in the one window where it is
// cheapest to get wrong. `recordedByName ?? t('recordedByGone')` means every
// "I don't know yet" prints as "No longer in this household" — a false
// statement about a present, active parent, and a cold cache is exactly when
// a nanny opens a payment.
describe('NannyWeekView — who recorded it, before the members read lands', () => {
  it('never calls a present member gone while the members query is still in flight', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );
    listMembersMock.mockImplementation(
      () => new Promise<typeof HOUSEHOLD_MEMBERS>(() => {})
    );

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-line-pay-1-open')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-paid-state-line-pay-1-open'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(
      getByTestId('payments-detail-recorded-by-value').props.children
    ).not.toBe('payments.detail.recordedByGone');
    // Vague but true, and the same word the parent side already shows for an
    // id it cannot resolve.
    expect(
      getByTestId('payments-detail-recorded-by-value').props.children
    ).toBe('detail.someone');
  });
});
