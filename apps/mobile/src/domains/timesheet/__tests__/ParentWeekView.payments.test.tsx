/**
 * @module domains/timesheet/__tests__/ParentWeekView.payments.test
 *
 * The parent side of the settlement loop, end to end through the real hooks:
 * an approved week grows a paid-state card and an export affordance, "Mark
 * as paid" prefills the outstanding balance and posts it, and the server's
 * over-payment refusal lands IN the sheet with the typed figures still there.
 *
 * A week that is not approved has none of it — payments settle a frozen
 * gross, and there is nothing to settle before approval freezes one.
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
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';

// The sheet recomputes the settlement date from the household zone at SUBMIT
// time (a sheet left open across midnight must not date the payment
// yesterday), so the expectation is derived the same way rather than
// hardcoded to whichever day this test happens to run on.
const TODAY_IN_HOUSEHOLD_ZONE = localDateInZone('UTC');

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
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? R.createElement('View', { testID }, children) : null),
  };
});

mock.module('@rn-primitives/alert-dialog', () => {
  const R = require('react');
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

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
}));

// The native export seam — see utils/weekExport's module doc.
class FakeExportUnavailableError extends Error {}
const shareCsvMock = mock(() => Promise.resolve());
const sharePdfMock = mock(() => Promise.resolve());
mock.module('../utils/weekExport', () => ({
  ExportUnavailableError: FakeExportUnavailableError,
  weekExportFileName: (carer: string, week: string, ext: string) =>
    `${carer}-${week}.${ext}`,
  shareCsv: shareCsvMock,
  sharePdfFromHtml: sharePdfMock,
}));

const PARENT_ID = 'parent-1';
const CARER_ID = 'carer-amara';
const HOUSEHOLD_ID = 'household-1';
const WEEK_START = '2026-08-03';
const TIMESHEET_ID = 'ts-1';
const now = '2026-08-01T00:00:00.000Z';

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
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
    status: 'submitted',
    local_date: '2026-08-03',
    timezone: 'UTC',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeTimesheet(overrides: Record<string, unknown> = {}) {
  return {
    id: TIMESHEET_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    carer_display_name: 'Amara',
    week_start: WEEK_START,
    total_minutes: 2460,
    status: 'submitted',
    approved_by: null,
    approved_at: null,
    query_note: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

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
  return { ...makeTimesheet(overrides), earnings: okEarnings };
}

const householdMember = {
  id: 'member-carer',
  household_id: HOUSEHOLD_ID,
  user_id: CARER_ID,
  role: 'nanny',
  can_edit: false,
  status: 'active',
  display_name_override: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
};

const listEntriesMock = mock(() => Promise.resolve([makeEntry()]));
const listTimesheetsMock = mock(() =>
  Promise.resolve([makeTimesheet({ status: 'approved' })])
);
const getByIdMock = mock(() =>
  Promise.resolve(
    makeTimesheetWeek({
      status: 'approved',
      approved_at: '2026-08-10T09:00:00.000Z',
      approved_by: PARENT_ID,
    })
  )
);
const exportCsvMock = mock(() => Promise.resolve('date,amount_minor\n'));
const listMembersMock = mock(() => Promise.resolve([householdMember]));
const listExpensesForWeekMock = mock(
  (): Promise<Expense[]> => Promise.resolve([])
);
const listPendingExpensesMock = mock(
  (): Promise<Expense[]> => Promise.resolve([])
);

const listPaymentsMock = mock(() => Promise.resolve([] as unknown[]));
const createPaymentMock = mock((_id: string, _input: unknown) =>
  Promise.resolve({ id: 'pay-1' })
);

mock.module('@/src/api/endpoints/payments', () => ({
  paymentApi: { list: listPaymentsMock, create: createPaymentMock },
}));

mock.module('@/src/api/endpoints/expenses', () => {
  const shared = expenseSchemaModule;
  return {
    ...shared,
    expenseApi: {
      listForWeek: listExpensesForWeekMock,
      listPending: listPendingExpensesMock,
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
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/timesheets', () => {
  const shared = timesheetSchemaModule;
  return {
    ...shared,
    timesheetApi: {
      list: listTimesheetsMock,
      getById: getByIdMock,
      getWeek: async (_householdId: string, weekStart: string) => {
        const all = await listTimesheetsMock();
        const matches = (all as { week_start: string }[]).filter(
          t => t.week_start === weekStart
        );
        return Promise.all(matches.map(() => getByIdMock()));
      },
      approve: mock(),
      query: mock(),
      reopen: mock(),
      exportCsv: exportCsvMock,
    },
  };
});

const showErrorToastMock = mock((_m: string) => {});
const showSuccessToastMock = mock((_m: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));

let ParentWeekView: typeof import('../components/ParentWeekView').ParentWeekView;
let getWeekDates: typeof import('../utils/week').getWeekDates;
let formatWeekRangeLabel: typeof import('../utils/week').formatWeekRangeLabel;

beforeAll(async () => {
  ParentWeekView = (await import('../components/ParentWeekView'))
    .ParentWeekView;
  const weekUtils = await import('../utils/week');
  getWeekDates = weekUtils.getWeekDates;
  formatWeekRangeLabel = weekUtils.formatWeekRangeLabel;
});

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-existing',
    timesheet_id: TIMESHEET_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    amount_minor: 12000,
    currency: 'GBP',
    paid_at: '2026-08-11',
    method_note: 'Bank transfer',
    recorded_by: PARENT_ID,
    created_at: '2026-08-11T09:30:00.000Z',
    ...overrides,
  };
}

function renderParentView(opts: { readOnly?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const weekDates = getWeekDates(WEEK_START);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ParentWeekView
        householdId={HOUSEHOLD_ID}
        weekStartISO={WEEK_START}
        weekDates={weekDates}
        weekRangeLabel={formatWeekRangeLabel(weekDates)}
        nowMs={new Date('2026-08-09T12:00:00.000Z').getTime()}
        timeZone="UTC"
        onPreviousWeek={() => {}}
        onNextWeek={() => {}}
        isNextWeekDisabled={false}
        isPreviousWeekDisabled={false}
        readOnly={opts.readOnly}
      />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  for (const m of [
    listEntriesMock,
    listTimesheetsMock,
    getByIdMock,
    listMembersMock,
    listExpensesForWeekMock,
    listPendingExpensesMock,
    listPaymentsMock,
    createPaymentMock,
    exportCsvMock,
    shareCsvMock,
    sharePdfMock,
    showErrorToastMock,
    showSuccessToastMock,
  ]) {
    m.mockReset();
  }

  listEntriesMock.mockImplementation(() => Promise.resolve([makeEntry()]));
  listTimesheetsMock.mockImplementation(() =>
    Promise.resolve([makeTimesheet({ status: 'approved' })])
  );
  getByIdMock.mockImplementation(() =>
    Promise.resolve(
      makeTimesheetWeek({
        status: 'approved',
        approved_at: '2026-08-10T09:00:00.000Z',
        approved_by: PARENT_ID,
      })
    )
  );
  listMembersMock.mockImplementation(() => Promise.resolve([householdMember]));
  listExpensesForWeekMock.mockImplementation(() => Promise.resolve([]));
  listPendingExpensesMock.mockImplementation(() => Promise.resolve([]));
  listPaymentsMock.mockImplementation(() => Promise.resolve([]));
  createPaymentMock.mockImplementation(() => Promise.resolve({ id: 'pay-1' }));
  exportCsvMock.mockImplementation(() =>
    Promise.resolve('date,amount_minor\n')
  );
  shareCsvMock.mockImplementation(() => Promise.resolve());
  sharePdfMock.mockImplementation(() => Promise.resolve());

  useAuthStore.setState({
    session: { user: { id: PARENT_ID } } as unknown as never,
    user: { id: PARENT_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ParentWeekView — the paid-state card', () => {
  it('shows Unpaid with the whole gross outstanding on a freshly approved week', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-badge').props.children).toBe(
        'paid.badgeUnpaid'
      )
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£236.12'
    );
  });

  it('shows the partial arithmetic once a payment has landed', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-badge').props.children).toBe(
        'paid.badgePartial'
      )
    );
    expect(getByTestId('hours-paid-state-total-value').props.children).toBe(
      '£120.00'
    );
    expect(getByTestId('hours-paid-state-balance-value').props.children).toBe(
      '£116.12'
    );
  });

  it('does not exist before approval — payments settle a FROZEN gross', async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ status: 'submitted' })])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({ status: 'submitted' }))
    );

    const { queryByTestId, getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-approve-button')).toBeTruthy()
    );
    expect(queryByTestId('hours-paid-state')).toBeNull();
    expect(queryByTestId('hours-export-button')).toBeNull();
    expect(listPaymentsMock).not.toHaveBeenCalled();
  });

  it('keeps payment history visible on a reopened week without mark-paid', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({
          status: 'submitted',
          reopen_reason: 'Thursday hours were wrong',
        }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          status: 'submitted',
          approved_at: null,
          reopen_reason: 'Thursday hours were wrong',
          earnings: null,
        })
      )
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(listPaymentsMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(getByTestId('hours-paid-state-total-value').props.children).toBe(
        '£120.00'
      )
    );
    expect(
      getByTestId('hours-paid-state-line-pay-existing-value').props.children
    ).toBe('£120.00');
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    expect(queryByTestId('hours-export-button')).toBeNull();
  });

  it('lets a helper READ the settlement but never record one', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderParentView({ readOnly: true });

    await waitFor(() => expect(getByTestId('hours-paid-state')).toBeTruthy());
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    // The export is informational, so a helper keeps it.
    expect(getByTestId('hours-export-button')).toBeTruthy();
  });
});

// Daylight v2: `WeekEarningsLine` (what the week is worth) and the former
// standalone `PaidStateSection` (whether it arrived) merged into ONE
// `WeekMoneyCard`. Both halves kept every testID, so a flat `getByTestId`
// passes whether they are one card or two — containment is the assertion.
describe('ParentWeekView — the merged money card', () => {
  it('holds the gross, the settlement and Mark as paid inside ONE card', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-money-card')).toBeTruthy());
    const card = within(getByTestId('hours-money-card'));
    expect(card.getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
    expect(card.getByTestId('hours-paid-state-badge').props.children).toBe(
      'paid.badgePartial'
    );
    expect(
      card.getByTestId('hours-paid-state-balance-value').props.children
    ).toBe('£116.12');
    expect(card.getByTestId('hours-mark-paid-button')).toBeTruthy();

    // The gross left the status card when it moved into this one.
    expect(
      within(getByTestId('hours-week-total')).queryByTestId(
        'hours-earnings-line'
      )
    ).toBeNull();
  });

  it('a helper sees the whole money card and can act on none of it', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderParentView({ readOnly: true });

    await waitFor(() => expect(getByTestId('hours-money-card')).toBeTruthy());
    const card = within(getByTestId('hours-money-card'));
    // Reading the family's money is the helper's whole entitlement here.
    expect(card.getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
    expect(card.getByTestId('hours-paid-state')).toBeTruthy();
    expect(
      card.getByTestId('hours-paid-state-balance-value').props.children
    ).toBe('£116.12');
    // ...and writing it is nobody's but a parent's.
    expect(card.queryByTestId('hours-mark-paid-button')).toBeNull();
    expect(queryByTestId('hours-approve-button')).toBeNull();
    expect(queryByTestId('hours-query-button')).toBeNull();
    expect(queryByTestId('hours-record-payment-sheet')).toBeNull();
  });

  it('renders no money card at all when neither half has anything true to say', async () => {
    // Legacy hours-only week, never approved: no gross the server will stand
    // behind, and no settlement to report. An empty white rectangle on a
    // money screen reads as a figure that failed to load.
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ status: 'submitted' })])
    );
    // `makeTimesheetWeek` hardcodes the `ok` earnings arm, so the shape is
    // cast rather than re-typing the shared fixture for one test.
    getByIdMock.mockImplementation(() =>
      Promise.resolve({
        ...makeTimesheet({ status: 'submitted' }),
        earnings: {
          status: 'hours_only',
          week_start: WEEK_START,
          reason: 'legacy_approval',
        },
      } as unknown as ReturnType<typeof makeTimesheetWeek>)
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-money-card')).toBeNull();
    expect(queryByTestId('hours-earnings-line')).toBeNull();
    expect(queryByTestId('hours-paid-state')).toBeNull();
  });
});

describe('ParentWeekView — recording a payment', () => {
  it('prefills the outstanding balance and posts it against this timesheet', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-mark-paid-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-mark-paid-button'));

    expect(getByTestId('hours-record-payment-amount-input').props.value).toBe(
      '236.12'
    );

    fireEvent.press(getByTestId('hours-record-payment-submit'));

    await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
    expect(createPaymentMock).toHaveBeenCalledWith(TIMESHEET_ID, {
      amount_minor: 23612,
      paid_at: TODAY_IN_HOUSEHOLD_ZONE,
    });
  });

  it('closes the sheet and confirms only after the server accepted it', async () => {
    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-mark-paid-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-mark-paid-button'));
    fireEvent.press(getByTestId('hours-record-payment-submit'));

    await waitFor(() =>
      expect(queryByTestId('hours-record-payment-sheet')).toBeNull()
    );
    expect(showSuccessToastMock).toHaveBeenCalledWith('paid.recordedToast');
  });

  it('keeps the sheet open and states the ceiling when the server refuses an over-payment', async () => {
    createPaymentMock.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('too much'), {
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
        })
      )
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-mark-paid-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-mark-paid-button'));
    fireEvent.press(getByTestId('hours-record-payment-submit'));

    await waitFor(() =>
      expect(
        getByTestId('hours-record-payment-overpayment-already-paid-value').props
          .children
      ).toBe('£200.00')
    );
    expect(
      getByTestId('hours-record-payment-overpayment-gross-value').props.children
    ).toBe('£236.12');
    // Still open, still holding what was typed.
    expect(getByTestId('hours-record-payment-amount-input').props.value).toBe(
      '236.12'
    );
  });
});

describe('ParentWeekView — exporting the week', () => {
  it('shares the server CSV from the approved week', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-export-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-csv'));

    await waitFor(() => expect(shareCsvMock).toHaveBeenCalled());
    expect(exportCsvMock).toHaveBeenCalledWith(TIMESHEET_ID);
  });

  it('shares a PDF built from the week already on screen', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-export-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-pdf'));

    await waitFor(() => expect(sharePdfMock).toHaveBeenCalled());
    expect(exportCsvMock).not.toHaveBeenCalled();
  });
});
