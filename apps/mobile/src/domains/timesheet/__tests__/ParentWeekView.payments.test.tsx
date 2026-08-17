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

const routerPushMock = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({ push: routerPushMock, back: mock(), replace: mock() }),
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

const correctPaymentMock = mock(
  (_timesheetId: string, _paymentId: string, _input: unknown) =>
    Promise.resolve({ id: 'corr-1' })
);

mock.module('@/src/api/endpoints/payments', () => ({
  paymentApi: {
    list: listPaymentsMock,
    create: createPaymentMock,
    correct: correctPaymentMock,
  },
}));

const listSettlementsMock = mock(() => Promise.resolve([] as unknown[]));
mock.module('@/src/api/endpoints/reimbursementSettlements', () => ({
  reimbursementSettlementApi: {
    listForWeek: listSettlementsMock,
    create: mock(),
  },
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
      markViewed: mock(() => Promise.resolve({})),
    },
  };
});

const showErrorToastMock = mock((_m: string) => {});
const showSuccessToastMock = mock((_m: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));

// Deterministic and COUNTABLE: the idempotency-key tests below are entirely
// about which submits share a key and which mint a new one, so the global
// constant-uuid mock in `bun.setup.ts` would make every assertion vacuous.
let uuidCounter = 0;
const randomUuidMock = mock(
  () => `00000000-0000-4000-8000-00000000000${++uuidCounter}`
);
mock.module('expo-crypto', () => ({
  randomUUID: randomUuidMock,
  getRandomBytesAsync: mock(() => Promise.resolve(new Uint8Array(16))),
}));

/** The `idempotency_key` on the nth `paymentApi.create` call (0-indexed). */
function keyOfCall(index: number): string | undefined {
  const call = createPaymentMock.mock.calls[index] as
    | [string, { idempotency_key?: string }]
    | undefined;
  return call?.[1]?.idempotency_key;
}

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
    kind: 'payment',
    corrects_payment_id: null,
    correction_reason: null,
    currency: 'GBP',
    paid_at: '2026-08-11',
    method_note: 'Bank transfer',
    recorded_by: PARENT_ID,
    created_at: '2026-08-11T09:30:00.000Z',
    ...overrides,
  };
}

function makeApprovedExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    local_date: WEEK_START,
    kind: 'expense',
    description: 'Soft play tickets',
    amount_minor: 1200,
    miles: null,
    currency: 'GBP',
    status: 'approved',
    reviewed_by: PARENT_ID,
    reviewed_at: now,
    review_note: null,
    carer_display_name: 'Amara',
    created_at: now,
    updated_at: now,
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
    correctPaymentMock,
    listSettlementsMock,
    exportCsvMock,
    shareCsvMock,
    sharePdfMock,
    showErrorToastMock,
    showSuccessToastMock,
  ]) {
    m.mockReset();
  }
  routerPushMock.mockClear();

  listSettlementsMock.mockImplementation(() => Promise.resolve([]));
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

// D-B1 — a failed or still-in-flight payments read must never render as
// "Unpaid" over a week that may already be settled
// (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B's compound finding).
describe('ParentWeekView — a failed or pending payments read', () => {
  it('hides Mark as paid and every Unpaid/Still-to-pay figure, and offers a retry', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.reject(new Error('boom'))
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-money-card')).toBeTruthy());
    expect(queryByTestId('hours-paid-state-badge')).toBeNull();
    expect(queryByTestId('hours-paid-state-balance-value')).toBeNull();
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    expect(getByTestId('hours-paid-state-retry')).toBeTruthy();

    fireEvent.press(getByTestId('hours-paid-state-retry-button'));
    await waitFor(() => expect(listPaymentsMock).toHaveBeenCalledTimes(2));
  });

  it('stays neutral while the payments read is still pending — never "Unpaid" before we know', async () => {
    // A promise that never settles during the test — the payments query
    // stays pending the whole time, same as a slow connection.
    listPaymentsMock.mockImplementation(() => new Promise(() => {}));

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-money-card')).toBeTruthy());
    expect(queryByTestId('hours-paid-state-badge')).toBeNull();
    expect(queryByTestId('hours-mark-paid-button')).toBeNull();
    expect(getByTestId('hours-paid-state-retry')).toBeTruthy();
  });
});

// D-B1 — the reimbursement-settlements half of the same compound finding:
// a failed or pending settlement read must never render "not reimbursed
// yet" (or re-offer "Mark reimbursed") over money that may already be back
// with her.
describe('ParentWeekView — a failed or pending settlements read', () => {
  it('hides the settled/unsettled claim and Mark reimbursed, and offers a retry', async () => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([makeApprovedExpense()])
    );
    listSettlementsMock.mockImplementation(() =>
      Promise.reject(new Error('boom'))
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card')).toBeTruthy()
    );
    expect(queryByTestId('reimbursements-card-state')).toBeNull();
    expect(
      queryByTestId('reimbursements-card-mark-reimbursed-button')
    ).toBeNull();
    expect(getByTestId('reimbursements-card-settlement-retry')).toBeTruthy();

    fireEvent.press(getByTestId('reimbursements-card-settlement-retry-button'));
    await waitFor(() => expect(listSettlementsMock).toHaveBeenCalledTimes(2));
  });

  it('stays neutral while the settlements read is still pending', async () => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([makeApprovedExpense()])
    );
    listSettlementsMock.mockImplementation(() => new Promise(() => {}));

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card')).toBeTruthy()
    );
    expect(queryByTestId('reimbursements-card-state')).toBeNull();
    expect(
      queryByTestId('reimbursements-card-mark-reimbursed-button')
    ).toBeNull();
    expect(getByTestId('reimbursements-card-settlement-retry')).toBeTruthy();
  });
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
      idempotency_key: keyOfCall(0),
    });
    expect(keyOfCall(0)).toBeTruthy();
  });

  // WP-P1(A). `payments` is append-only with no edit path, so a double-tapped
  // POST or a retry after a dropped response files a SECOND real row for
  // money that moved once. The key is minted per INTENT — one sheet opening —
  // so every retry of that intent collapses onto the row the first attempt
  // wrote, and the next intent is a genuinely new payment.
  it('reuses the same idempotency key when a failed submit is retried', async () => {
    let attempts = 0;
    createPaymentMock.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(
          Object.assign(new Error('dropped'), {
            isAxiosError: true,
          })
        );
      }
      return Promise.resolve({ id: 'pay-1' });
    });

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-mark-paid-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-mark-paid-button'));
    fireEvent.press(getByTestId('hours-record-payment-submit'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalledTimes(1));

    // Same sheet, same typed figures, same intent — the parent is retrying,
    // not paying twice.
    fireEvent.press(getByTestId('hours-record-payment-submit'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalledTimes(2));

    expect(keyOfCall(0)).toBeTruthy();
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it('mints a fresh idempotency key for the next payment after a success', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-mark-paid-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-mark-paid-button'));
    fireEvent.press(getByTestId('hours-record-payment-submit'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalledTimes(1));

    fireEvent.press(getByTestId('hours-mark-paid-button'));
    fireEvent.press(getByTestId('hours-record-payment-submit'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalledTimes(2));

    expect(keyOfCall(1)).toBeTruthy();
    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });

  it('closes the sheet and confirms only after the server accepted it', async () => {
    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-mark-paid-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-mark-paid-button'));
    fireEvent.press(getByTestId('hours-record-payment-submit'));

    // This is the one path in the file that settles through BOTH of
    // useRecordPayment's onSuccess invalidations (payment.all + timesheet.all)
    // before the sheet closes.
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

// WP-P1(C). The week keeps `approved`, its approver and its frozen snapshot —
// the payments stand — so the ONLY signal that the approved total no longer
// covers every hour worked is this timestamp, and it has to be said out loud.
describe('ParentWeekView — hours added after the week was paid', () => {
  function stubHoursChangedAfterPayment(at: string | null) {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          status: 'approved',
          approved_at: '2026-08-10T09:00:00.000Z',
          approved_by: PARENT_ID,
          hours_changed_after_payment_at: at,
        })
      )
    );
  }

  it('names the carer and the day the hours landed', async () => {
    stubHoursChangedAfterPayment('2026-08-12T09:00:00.000Z');

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-changed-after-payment-note')).toBeTruthy()
    );
    expect(getByTestId('hours-changed-after-payment-note').props.children).toBe(
      'paidWeek.hoursAdded'
    );
  });

  it('says nothing when the server did not flag it', async () => {
    stubHoursChangedAfterPayment(null);

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    expect(queryByTestId('hours-changed-after-payment-note')).toBeNull();
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

// WP7: one entry link from the week to the cross-week Payments screen. A
// plain text link, not gated on approval — it links to a record that spans
// every week, not to this week's state.
describe('ParentWeekView — the payments entry link', () => {
  it('renders and navigates to the payments screen on tap', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-payments-link')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-payments-link'));

    expect(routerPushMock).toHaveBeenCalledWith('/(private)/payments');
  });

  it('renders even when the week is NOT approved', async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ status: 'submitted' })])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({ status: 'submitted' }))
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-payments-link')).toBeTruthy()
    );
  });
});

// WP-C: the week is the second door into the payment leaf the Payments
// screen already opens. Same sheet, same testID — a second testID for one
// component would be the invention, not the reuse.
describe('ParentWeekView — opening a payment from the week', () => {
  it('says what the Payments screen holds, on a row rather than a bare link', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-payments-link')).toBeTruthy()
    );
    expect(getByTestId('hours-payments-link-subtitle').props.children).toBe(
      'payments.subtitleParent'
    );
  });

  it('opens the payment that was tapped, not merely a payment', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([
        makePayment({ id: 'pay-first', amount_minor: 5000 }),
        makePayment({ id: 'pay-second', amount_minor: 12000 }),
      ])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-paid-state-line-pay-second-open')).toBeTruthy()
    );
    expect(queryByTestId('payments-detail')).toBeNull();

    fireEvent.press(getByTestId('hours-paid-state-line-pay-second-open'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(getByTestId('payments-detail-amount').props.children).toBe(
      '£120.00'
    );
  });

  it('closes again on dismiss', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(
        getByTestId('hours-paid-state-line-pay-existing-open')
      ).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-paid-state-line-pay-existing-open'));
    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());

    fireEvent(getByTestId('payments-detail'), 'dismiss');

    await waitFor(() => expect(queryByTestId('payments-detail')).toBeNull());
  });

  // The week IS the context the sheet was opened from — a "For the week" link
  // here would navigate to the week already on screen and stack a second
  // Hours route behind it.
  it('offers no link back to the week it was opened from', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(
        getByTestId('hours-paid-state-line-pay-existing-open')
      ).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-paid-state-line-pay-existing-open'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(queryByTestId('payments-detail-for-week')).toBeNull();
  });

  it('names the carer it went to, and the parent who recorded it as themselves', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(
        getByTestId('hours-paid-state-line-pay-existing-open')
      ).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-paid-state-line-pay-existing-open'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(getByTestId('payments-detail-paid-to-value').props.children).toBe(
      'Amara'
    );
    expect(
      getByTestId('payments-detail-recorded-by-value').props.children
    ).toBe('detail.you');
  });
});

// D-20, attention spec §4.1 — the parent's own entry point, and the one gate
// that matters: a sheet presented over an already-presented sheet is
// invisible on iOS, so the leaf must CLOSE before the correction opens.
describe('ParentWeekView — correcting a payment', () => {
  const openDetail = async (view: ReturnType<typeof renderParentView>) => {
    await waitFor(() =>
      expect(
        view.getByTestId('hours-paid-state-line-pay-existing-open')
      ).toBeTruthy()
    );
    fireEvent.press(
      view.getByTestId('hours-paid-state-line-pay-existing-open')
    );
    await waitFor(() =>
      expect(view.getByTestId('payments-detail')).toBeTruthy()
    );
  };

  it('closes the payment leaf before the correction sheet arrives', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const view = renderParentView();
    await openDetail(view);

    fireEvent.press(view.getByTestId('payments-detail-correct'));

    await waitFor(() =>
      expect(view.getByTestId('hours-correct-payment-sheet')).toBeTruthy()
    );
    expect(view.queryByTestId('payments-detail')).toBeNull();
    // Prefilled with the original's own figure — £120.00.
    expect(
      view.getByTestId('hours-correct-payment-amount-input').props.value
    ).toBe('120.00');
  });

  it('posts the POSITIVE magnitude with its reason, and closes only on success', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );
    correctPaymentMock.mockImplementation(() =>
      Promise.resolve({ id: 'corr-1' })
    );

    const view = renderParentView();
    await openDetail(view);
    fireEvent.press(view.getByTestId('payments-detail-correct'));
    await waitFor(() =>
      expect(view.getByTestId('hours-correct-payment-sheet')).toBeTruthy()
    );

    fireEvent.changeText(
      view.getByTestId('hours-correct-payment-reason-input'),
      'recorded twice'
    );
    fireEvent.press(view.getByTestId('hours-correct-payment-submit'));

    await waitFor(() =>
      expect(correctPaymentMock).toHaveBeenCalledWith(
        TIMESHEET_ID,
        'pay-existing',
        {
          amount_minor: 12000,
          paid_at: TODAY_IN_HOUSEHOLD_ZONE,
          reason: 'recorded twice',
        }
      )
    );
    await waitFor(() =>
      expect(view.queryByTestId('hours-correct-payment-sheet')).toBeNull()
    );
  });

  // Correcting is the payer's act. A helper reads the ledger and never edits
  // it — the same gate as "Mark as paid".
  it('offers a read-only helper no way to correct anything', async () => {
    listPaymentsMock.mockImplementation(() =>
      Promise.resolve([makePayment({ amount_minor: 12000 })])
    );

    const view = renderParentView({ readOnly: true });
    await openDetail(view);

    expect(view.queryByTestId('payments-detail-correct')).toBeNull();
  });
});
