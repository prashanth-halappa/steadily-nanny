/**
 * @module domains/timesheet/__tests__/ParentWeekView.integration.test
 *
 * D15 real-render — renders the ACTUAL `ParentWeekView`, mocked at the API
 * endpoint boundary (`@/src/api/endpoints/*`), not at the hook level and not
 * fed mocked props. Covers TIER0-CX-SPEC.md §4's arms as seen from the
 * parent's Hours screen: estimated, approved-frozen, legacy hours-only,
 * no-arrangement, currency-change, departed-carer; the breakdown sheet; the
 * approve dialog through the real mutation hook; the renamed
 * vs-scheduled delta; and the D1-reopen caption.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { useAuthStore } from '@/src/store/auth';

// LoadingIndicator's `require('@/assets/splash.png')` breaks bundling under
// bun:test (see HoursScreen.test.tsx / ManageHouseholdScreen.test.tsx) —
// same stand-in.
mock.module('@/src/components/ui/loading-indicator', () => {
  const R = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      R.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

// Same @rn-primitives/alert-dialog stand-in as TimeOffScreen.test /
// ManageHouseholdScreen.test — the .mjs distribution isn't pre-compiled for
// bun:test.
mock.module('@rn-primitives/alert-dialog', () => {
  const R = require('react');
  const Ctx = R.createContext({ open: false, setOpen: (_o: boolean) => {} });
  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      R.createElement(
        Ctx.Provider,
        {
          value: {
            open: open ?? false,
            setOpen: (n: boolean) => onOpenChange?.(n),
          },
        },
        children
      ),
    Trigger: ({ children }: { children: React.ReactNode }) => children,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [k: string]: unknown;
    }) => {
      const { open } = R.useContext(Ctx);
      return open ? R.createElement('View', props, children) : null;
    },
    Content: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [k: string]: unknown;
    }) => R.createElement('View', props, children),
    Title: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [k: string]: unknown;
    }) => R.createElement('Text', props, children),
    Description: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [k: string]: unknown;
    }) => R.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [k: string]: unknown;
    }) => {
      const { setOpen } = R.useContext(Ctx);
      return R.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    Action: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      disabled?: boolean;
      [k: string]: unknown;
    }) => {
      const { setOpen } = R.useContext(Ctx);
      return R.createElement(
        'Pressable',
        {
          ...props,
          disabled,
          onPress: (e: unknown) => {
            if (disabled) return;
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    useRootContext: () => R.useContext(Ctx),
  };
});

mock.module('expo-router', () => ({
  useRouter: () => ({ push: routerPush, back: mock(), replace: mock() }),
}));

const PARENT_ID = 'parent-1';
const CARER_ID = 'carer-amara';
const HOUSEHOLD_ID = 'household-1';
const WEEK_START = '2026-08-03';
const TIMESHEET_ID = 'ts-1';
const now = '2026-08-01T00:00:00.000Z';

const routerPush = mock();

function makeEntry(overrides: Partial<Record<string, unknown>> = {}) {
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

function makeTimesheet(overrides: Partial<Record<string, unknown>> = {}) {
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
      from_date: '2026-08-03',
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

function makeTimesheetWeek(
  overrides: Partial<Record<string, unknown>> = {},
  earnings: unknown = okEarnings
) {
  return { ...makeTimesheet(overrides), earnings };
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
const listTimesheetsMock = mock(() => Promise.resolve([makeTimesheet()]));
const getByIdMock = mock(() => Promise.resolve(makeTimesheetWeek()));
const approveMock = mock(() =>
  Promise.resolve(makeTimesheet({ status: 'approved' }))
);
const queryMock = mock(() =>
  Promise.resolve(makeTimesheet({ status: 'queried' }))
);
const listMembersMock = mock(() => Promise.resolve([householdMember]));
// Phase 4 (additive): the week's own approved-expenses read + the
// household-wide pending-review inbox + the review mutation. Mocked so this
// pre-existing suite never makes a real network call now that
// `ParentWeekView` fetches all three.
const listExpensesForWeekMock = mock(
  (): Promise<Expense[]> => Promise.resolve([])
);
const listPendingExpensesMock = mock(
  (): Promise<Expense[]> => Promise.resolve([])
);
const reviewExpenseMock = mock(() =>
  Promise.resolve({ id: 'expense-1', status: 'approved' })
);

mock.module('@/src/api/endpoints/expenses', () => {
  const shared = require('@steadily-nanny/shared-types/schemas/expense.schema');
  return {
    ...shared,
    expenseApi: {
      listForWeek: listExpensesForWeekMock,
      listPending: listPendingExpensesMock,
      create: mock(),
      update: mock(),
      withdraw: mock(),
      review: reviewExpenseMock,
    },
  };
});

mock.module('@/src/api/endpoints/timeEntries', () => {
  const shared = require('@steadily-nanny/shared-types/schemas/timesheet.schema');
  return {
    ...shared,
    timeEntryApi: { listForWeek: listEntriesMock },
  };
});
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/timesheets', () => {
  const shared = require('@steadily-nanny/shared-types/schemas/timesheet.schema');
  return {
    ...shared,
    timesheetApi: {
      list: listTimesheetsMock,
      getById: getByIdMock,
      getWeek: async (_householdId: string, weekStart: string) => {
        const all = await listTimesheetsMock();
        const match = (all as { week_start: string; id: string }[]).find(
          t => t.week_start === weekStart
        );
        if (!match) return null;
        return getByIdMock();
      },
      approve: approveMock,
      query: queryMock,
    },
  };
});

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

function renderParentView(
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
) {
  const weekDates = getWeekDates(WEEK_START);
  const weekRangeLabel = formatWeekRangeLabel(weekDates);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ParentWeekView
        householdId={HOUSEHOLD_ID}
        weekStartISO={WEEK_START}
        weekDates={weekDates}
        weekRangeLabel={weekRangeLabel}
        nowMs={new Date('2026-08-09T12:00:00.000Z').getTime()}
        timeZone="UTC"
        onPreviousWeek={() => {}}
        onNextWeek={() => {}}
        isNextWeekDisabled={false}
        isPreviousWeekDisabled={false}
      />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  listEntriesMock.mockReset();
  listTimesheetsMock.mockReset();
  getByIdMock.mockReset();
  approveMock.mockReset();
  queryMock.mockReset();
  listMembersMock.mockReset();
  listExpensesForWeekMock.mockReset();
  listPendingExpensesMock.mockReset();
  reviewExpenseMock.mockReset();
  routerPush.mockClear();

  listExpensesForWeekMock.mockImplementation(() => Promise.resolve([]));
  listPendingExpensesMock.mockImplementation(() => Promise.resolve([]));
  reviewExpenseMock.mockImplementation(() =>
    Promise.resolve({ id: 'expense-1', status: 'approved' })
  );
  listEntriesMock.mockImplementation(() => Promise.resolve([makeEntry()]));
  listTimesheetsMock.mockImplementation(() =>
    Promise.resolve([makeTimesheet()])
  );
  getByIdMock.mockImplementation(() => Promise.resolve(makeTimesheetWeek()));
  approveMock.mockImplementation(() =>
    Promise.resolve(makeTimesheet({ status: 'approved' }))
  );
  queryMock.mockImplementation(() =>
    Promise.resolve(makeTimesheet({ status: 'queried' }))
  );
  listMembersMock.mockImplementation(() => Promise.resolve([householdMember]));

  useAuthStore.setState({
    session: { user: { id: PARENT_ID } } as unknown as never,
    user: { id: PARENT_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ParentWeekView — earnings arms', () => {
  it('estimated arm: shows "Estimated gross" + amount, and the breakdown sheet opens on tap', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
    expect(
      getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
    ).toContain('earningsEstimatedGross');

    fireEvent.press(getByTestId('hours-earnings-line-pressable'));
    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-total')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-breakdown-total').props.children).toBe(
      '£236.12'
    );
  });

  it('approved-frozen arm: shows "Approved gross" from the snapshot', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          status: 'approved',
          approved_at: '2026-08-10T09:00:00.000Z',
          approved_by: PARENT_ID,
        })
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ status: 'approved' })])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(
      getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
    ).toContain('earningsApprovedGross');
  });

  it('legacy hours-only arm: renders NO money line at all', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek(
          { status: 'approved' },
          {
            status: 'hours_only',
            week_start: WEEK_START,
            reason: 'legacy_approval',
          }
        )
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ status: 'approved' })])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-earnings-line')).toBeNull();
  });

  it('no-arrangement arm (parent): shows the nudge button, routing to the setup screen for THIS carer', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek(
          {},
          {
            status: 'no_arrangement',
            week_start: WEEK_START,
            unpriced_dates: [WEEK_START],
          }
        )
      )
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-set-rate')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-earnings-line-set-rate'));
    expect(routerPush).toHaveBeenCalledWith(`/settings/pay/setup/${CARER_ID}`);
  });

  it('currency-change arm: renders the sentence, no number', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek(
          {},
          {
            status: 'currency_change',
            week_start: WEEK_START,
            currencies: ['GBP', 'EUR'],
          }
        )
      )
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line')).toBeTruthy()
    );
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
  });

  it('departed-carer arm: hours-only caption, never the set-a-rate nudge', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek(
          { carer_id: null },
          {
            status: 'hours_only',
            week_start: WEEK_START,
            reason: 'carer_removed',
          }
        )
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ carer_id: null })])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line')).toBeTruthy()
    );
    expect(queryByTestId('hours-earnings-line-set-rate')).toBeNull();
  });

  it('renders the renamed "vs scheduled" delta, never a bare signed number', async () => {
    // The fixture entry clocks 08:00–16:00 = 480 worked minutes; 466
    // scheduled -> +14, matching the pinned "14m over scheduled" copy.
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([makeEntry({ scheduled_minutes: 466 })])
    );

    const { getByText, queryByText } = renderParentView();

    await waitFor(() => expect(getByText('14m over scheduled')).toBeTruthy());
    expect(queryByText('+14 min')).toBeNull();
  });
});

describe('ParentWeekView — approve dialog', () => {
  it('shows hours + gross as text (with-arrangement body key) and approves through the real mutation hook', async () => {
    // i18n is key-echo mocked (bun.setup.ts: `t: (key) => key`, no
    // interpolation) — the repo's own convention is to assert on the STABLE
    // KEY here (proven to carry `hours`/`gross`/`name` in
    // `ApproveWeekDialog.tsx`'s source and in that component's own isolated
    // unit test), not on rendered copy. What this test proves that the unit
    // test cannot: the REAL week's hours/gross actually reach the dialog
    // through the real `ParentWeekView` -> `WeekTotal` -> `ApproveWeekDialog`
    // wiring, and the real mutation actually fires on confirm.
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-approve-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-approve-button'));

    await waitFor(() =>
      expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
        'approveDialogBody'
      )
    );

    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(TIMESHEET_ID));
  });

  it('no-arrangement week: the dialog body drops the gross clause', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek(
          {},
          {
            status: 'no_arrangement',
            week_start: WEEK_START,
            unpriced_dates: [WEEK_START],
          }
        )
      )
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-approve-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-approve-button'));

    await waitFor(() =>
      expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
        'approveDialogBodyNoArrangement'
      )
    );
  });
});

describe('ParentWeekView — reopen after approval (D1)', () => {
  it('reverts to "Estimated gross" and shows the reopened caption once new hours land', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          status: 'approved',
          approved_at: '2026-08-10T09:00:00.000Z',
        })
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ status: 'approved' })])
    );

    const { getByTestId, queryClient } = renderParentView();

    await waitFor(() =>
      expect(
        getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
      ).toContain('earningsApprovedGross')
    );

    // Simulate the D1 reopen: new hours rolled in, the snapshot is cleared
    // server-side, status flips back to 'submitted', approved_at nulls.
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({ status: 'submitted', approved_at: null })
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({ status: 'submitted', approved_at: null }),
      ])
    );
    await act(async () => {
      await queryClient.invalidateQueries();
    });

    await waitFor(() =>
      expect(
        getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
      ).toContain('earningsEstimatedGross')
    );
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
  });
});

function makeExpense(overrides: Partial<Expense> = {}): Expense {
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
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    carer_display_name: 'Amara',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('ParentWeekView — expenses & the statement (Phase 4)', () => {
  it('no pending-expenses row and no Reimbursements card when there is nothing to review', async () => {
    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('expenses-pending-row')).toBeNull();
    expect(queryByTestId('reimbursements-card')).toBeNull();
  });

  it('the pending-expenses row opens the review sheet; approving calls the review mutation', async () => {
    listPendingExpensesMock.mockImplementation(() =>
      Promise.resolve([makeExpense()])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('expenses-pending-row')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expenses-pending-row'));

    await waitFor(() =>
      expect(getByTestId('expense-review-card-expense-1-approve')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expense-review-card-expense-1-approve'));

    await waitFor(() => expect(reviewExpenseMock).toHaveBeenCalledTimes(1));
    expect(reviewExpenseMock).toHaveBeenCalledWith('expense-1', {
      status: 'approved',
    });
  });

  it('rejecting sends the trimmed note through the review mutation', async () => {
    listPendingExpensesMock.mockImplementation(() =>
      Promise.resolve([makeExpense()])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('expenses-pending-row')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expenses-pending-row'));
    await waitFor(() =>
      expect(getByTestId('expense-review-card-expense-1-reject')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expense-review-card-expense-1-reject'));
    fireEvent.changeText(
      getByTestId('expense-review-card-expense-1-note-input'),
      'Already paid in cash'
    );
    fireEvent.press(getByTestId('expense-review-card-expense-1-send'));

    await waitFor(() => expect(reviewExpenseMock).toHaveBeenCalledTimes(1));
    expect(reviewExpenseMock).toHaveBeenCalledWith('expense-1', {
      status: 'rejected',
      review_note: 'Already paid in cash',
    });
  });

  it('pending mileage in the review sheet shows miles only, never a computed amount', async () => {
    listPendingExpensesMock.mockImplementation(() =>
      Promise.resolve([
        makeExpense({
          kind: 'mileage',
          amount_minor: null,
          miles: 12.4,
        }),
      ])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('expenses-pending-row')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expenses-pending-row'));

    await waitFor(() =>
      expect(getByTestId('expense-review-card-expense-1-amount')).toBeTruthy()
    );
    const amount = getByTestId('expense-review-card-expense-1-amount').props
      .children;
    expect(amount).not.toContain('£');
  });

  it('a NO_MILEAGE_RATE approve failure shows the inline error and "Set a rate" routes to that carer\'s pay screen', async () => {
    listPendingExpensesMock.mockImplementation(() =>
      Promise.resolve([
        makeExpense({ kind: 'mileage', amount_minor: null, miles: 12.4 }),
      ])
    );
    reviewExpenseMock.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('validation'), {
          response: {
            status: 400,
            data: {
              error: {
                code: 'VALIDATION_ERROR',
                metadata: { reason: 'NO_MILEAGE_RATE' },
              },
            },
          },
        })
      )
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('expenses-pending-row')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expenses-pending-row'));
    await waitFor(() =>
      expect(getByTestId('expense-review-card-expense-1-approve')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expense-review-card-expense-1-approve'));

    await waitFor(() =>
      expect(
        getByTestId('expense-review-card-expense-1-mileage-error')
      ).toBeTruthy()
    );

    fireEvent.press(getByTestId('expense-review-card-expense-1-set-rate'));
    expect(routerPush).toHaveBeenCalledWith(`/settings/pay/${CARER_ID}`);
  });

  // Phase 3+4 adversarial review, finding 6: an UNRECOGNISED typed 4xx
  // refusal (e.g. the still-undecided "already-approved week" case) must
  // surface something specific to the card, not leave the parent with only
  // the ambient generic toast. This deliberately uses a made-up reason
  // code — the point is that ANY unmatched typed reason falls into the
  // generic arm, not a specific one this test would be pre-guessing.
  it('finding 6: an unrecognised typed review failure surfaces the generic per-card error, not just a toast', async () => {
    listPendingExpensesMock.mockImplementation(() =>
      Promise.resolve([makeExpense()])
    );
    reviewExpenseMock.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('conflict'), {
          response: {
            status: 409,
            data: {
              error: {
                code: 'CONFLICT',
                metadata: { reason: 'SOME_FUTURE_REASON' },
              },
            },
          },
        })
      )
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('expenses-pending-row')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expenses-pending-row'));
    await waitFor(() =>
      expect(getByTestId('expense-review-card-expense-1-approve')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expense-review-card-expense-1-approve'));

    await waitFor(() =>
      expect(getByTestId('expense-review-card-expense-1-error')).toBeTruthy()
    );
    // The mileage-rate-specific arm must NOT also fire for an unrelated code.
    expect(
      queryByTestId('expense-review-card-expense-1-mileage-error')
    ).toBeNull();
  });

  it('a plain network failure (no typed code) shows neither inline error arm', async () => {
    listPendingExpensesMock.mockImplementation(() =>
      Promise.resolve([makeExpense()])
    );
    reviewExpenseMock.mockImplementation(() =>
      Promise.reject(new Error('Network Error'))
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('expenses-pending-row')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expenses-pending-row'));
    await waitFor(() =>
      expect(getByTestId('expense-review-card-expense-1-approve')).toBeTruthy()
    );
    fireEvent.press(getByTestId('expense-review-card-expense-1-approve'));

    await waitFor(() => expect(reviewExpenseMock).toHaveBeenCalledTimes(1));
    expect(queryByTestId('expense-review-card-expense-1-error')).toBeNull();
    expect(
      queryByTestId('expense-review-card-expense-1-mileage-error')
    ).toBeNull();
  });

  it('renders the Reimbursements card for an approved expense this week, excluding a pending one from the total', async () => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([
        makeExpense({ id: 'expense-approved', status: 'approved' }),
        makeExpense({
          id: 'expense-pending',
          status: 'pending',
          description: 'Nursery run',
        }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({}, { ...okEarnings, reimbursements_minor: 1200 })
      )
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card')).toBeTruthy()
    );
    expect(getByTestId('reimbursements-card-total').props.children).toBe(
      '£12.00'
    );
    expect(
      queryByTestId('reimbursements-card-line-expense-pending-value')
    ).toBeNull();
  });

  // Phase 3+4 adversarial review, finding 7: a week whose earnings are NOT
  // the `ok` arm has no server-computed `reimbursements_minor` at all — the
  // OLD `?? 0` fallback rendered a fabricated "£0.00" above real, non-zero
  // approved expenses. One arm per test, each proving the same thing: no
  // total row (or the explicit "unavailable" line), and never a literal
  // "£0.00" anywhere on the card.
  it.each([
    [
      'no_arrangement',
      { status: 'no_arrangement', week_start: WEEK_START, unpriced_dates: [] },
    ],
    [
      'currency_change',
      {
        status: 'currency_change',
        week_start: WEEK_START,
        currencies: ['GBP', 'EUR'],
      },
    ],
    [
      'legacy hours_only',
      {
        status: 'hours_only',
        week_start: WEEK_START,
        reason: 'legacy_approval',
      },
    ],
  ])('finding 7 — %s week: real approved expenses, but NO fabricated £0.00 total', async (_label, earnings) => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([
        makeExpense({
          id: 'expense-approved',
          status: 'approved',
          amount_minor: 1200,
        }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({}, earnings))
    );

    const { getByTestId, queryByTestId, queryAllByText } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card')).toBeTruthy()
    );
    // The real item still shows its real amount.
    expect(
      getByTestId('reimbursements-card-line-expense-approved-value').props
        .children
    ).toBe('£12.00');
    // No total row claiming a figure the server never computed.
    expect(queryByTestId('reimbursements-card-total')).toBeNull();
    expect(getByTestId('reimbursements-card-total-unavailable')).toBeTruthy();
    expect(queryAllByText('£0.00')).toHaveLength(0);
  });

  it('finding 7 — earnings fetch error: real approved expenses, but NO fabricated £0.00 total', async () => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([
        makeExpense({
          id: 'expense-approved',
          status: 'approved',
          amount_minor: 1200,
        }),
      ])
    );
    getByIdMock.mockImplementation(() => Promise.reject(new Error('boom')));

    const { getByTestId, queryByTestId, queryAllByText } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card')).toBeTruthy()
    );
    expect(
      getByTestId('reimbursements-card-line-expense-approved-value').props
        .children
    ).toBe('£12.00');
    expect(queryByTestId('reimbursements-card-total')).toBeNull();
    expect(getByTestId('reimbursements-card-total-unavailable')).toBeTruthy();
    expect(queryAllByText('£0.00')).toHaveLength(0);
  });
});
