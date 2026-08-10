/**
 * @module domains/timesheet/__tests__/ParentWeekView.reopen.test
 *
 * Parent-facing reopen affordance: an approved week that is no longer the
 * current week is otherwise frozen forever. The control must appear only on
 * approved weeks, never for a helper (`readOnly`), and confirming must send
 * the parent's reason through the real mutation hook.
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
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

// ApproveWeekDialog still uses AlertDialog; ReopenWeekDialog uses
// BottomSheetBase (keyboard-aware). Both must be mocked for this screen.
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

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
}));

const PARENT_ID = 'parent-1';
const CARER_ID = 'carer-amara';
const HOUSEHOLD_ID = 'household-1';
const WEEK_START = '2026-08-03';
const TIMESHEET_ID = 'ts-1';
const now = '2026-08-01T00:00:00.000Z';

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
const reopenMock = mock(() =>
  Promise.resolve(makeTimesheet({ status: 'submitted', approved_at: null }))
);
const listMembersMock = mock(() => Promise.resolve([householdMember]));
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
  const shared = expenseSchemaModule;
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
  const shared = timesheetSchemaModule;
  return {
    ...shared,
    timeEntryApi: { listForWeek: listEntriesMock },
  };
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
      // Mirrors the real endpoint: every carer's row for that week, each
      // resolved to its own earnings-bearing week (F-B1-3).
      getWeek: async (_householdId: string, weekStart: string) => {
        const all = await listTimesheetsMock();
        const matches = (all as { week_start: string; id: string }[]).filter(
          t => t.week_start === weekStart
        );
        return Promise.all(matches.map(() => getByIdMock()));
      },
      approve: approveMock,
      query: queryMock,
      reopen: reopenMock,
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
  opts: { readOnly?: boolean } = {},
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
        readOnly={opts.readOnly}
      />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

function stubApprovedWeek() {
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
}

beforeEach(() => {
  listEntriesMock.mockReset();
  listTimesheetsMock.mockReset();
  getByIdMock.mockReset();
  approveMock.mockReset();
  queryMock.mockReset();
  reopenMock.mockReset();
  listMembersMock.mockReset();
  listExpensesForWeekMock.mockReset();
  listPendingExpensesMock.mockReset();
  reviewExpenseMock.mockReset();

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
  reopenMock.mockImplementation(() =>
    Promise.resolve(makeTimesheet({ status: 'submitted', approved_at: null }))
  );
  listMembersMock.mockImplementation(() => Promise.resolve([householdMember]));

  useAuthStore.setState({
    session: { user: { id: PARENT_ID } } as unknown as never,
    user: { id: PARENT_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ParentWeekView — reopen affordance', () => {
  it('renders the reopen control on an approved week', async () => {
    stubApprovedWeek();
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-reopen-button')).toBeTruthy()
    );
  });

  it('does not render reopen on submitted / queried / open weeks', async () => {
    for (const status of ['submitted', 'queried', 'open'] as const) {
      getByIdMock.mockImplementation(() =>
        Promise.resolve(makeTimesheetWeek({ status }))
      );
      listTimesheetsMock.mockImplementation(() =>
        Promise.resolve([makeTimesheet({ status })])
      );

      const { queryByTestId, unmount } = renderParentView();
      await waitFor(() =>
        expect(queryByTestId('hours-week-list')).toBeTruthy()
      );
      expect(queryByTestId('hours-reopen-button')).toBeNull();
      unmount();
    }
  });

  it('a helper (readOnly) never sees the reopen control, even on an approved week', async () => {
    stubApprovedWeek();
    const { queryByTestId, getByTestId } = renderParentView({
      readOnly: true,
    });

    await waitFor(() => expect(getByTestId('hours-week-list')).toBeTruthy());
    expect(queryByTestId('hours-reopen-button')).toBeNull();
  });

  it('confirming with a reason calls the reopen mutation; cancelling does not', async () => {
    stubApprovedWeek();
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-reopen-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-reopen-button'));

    await waitFor(() =>
      expect(getByTestId('hours-reopen-dialog')).toBeTruthy()
    );

    fireEvent.press(getByTestId('hours-reopen-dialog-cancel'));
    expect(reopenMock).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('hours-reopen-button'));
    await waitFor(() =>
      expect(getByTestId('hours-reopen-dialog-reason')).toBeTruthy()
    );
    fireEvent.changeText(
      getByTestId('hours-reopen-dialog-reason'),
      'Thursday hours were wrong'
    );
    fireEvent.press(getByTestId('hours-reopen-dialog-confirm'));

    await waitFor(() =>
      expect(reopenMock).toHaveBeenCalledWith(TIMESHEET_ID, {
        reason: 'Thursday hours were wrong',
      })
    );
  });

  // The API never writes a reopen reason onto `query_note` (that column
  // means "a parent queried this week" — see timesheetCommandService.reopen's
  // doc comment), but this is the defensive belt-and-braces half: even a
  // stale or otherwise-populated `query_note` on a non-queried week must
  // never render as "Queried: ...", the same status-gate `buildInboxItems`
  // already applies before treating a week as a queried one.
  it('never shows the queried-note banner on a non-queried week, even if query_note is populated', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({ status: 'submitted', query_note: 'Stale note' })
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({ status: 'submitted', query_note: 'Stale note' }),
      ])
    );

    const { queryByTestId, getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-week-list')).toBeTruthy());
    expect(queryByTestId('hours-query-note')).toBeNull();
  });
});
