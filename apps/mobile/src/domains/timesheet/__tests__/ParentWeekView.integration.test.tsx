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
// Imported at module scope, NOT `require()`d inside the mock factories below.
// A `require()` of an ES module from inside a factory races on whether that
// module has finished evaluating: when it hasn't, Bun throws
// "require() async module ... is unsupported" and the whole file fails at
// load with 0 tests run. It is timing-dependent, so it surfaced as an
// intermittent gate failure that passed on re-run.

import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setDefaultTimeout,
} from 'bun:test';

// This file's waitFor(() => …toBeNull()) assertions legitimately take 4–12s
// under CPU contention (parallel qc subshells), tipping over bun's default 5s
// per-test budget intermittently. The slowness is scheduler contention, not a
// hang — raise the budget for this file only.
setDefaultTimeout(30_000);

import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import * as expenseSchemaModule from '@steadily-nanny/shared-types/schemas/expense.schema';
import * as timesheetSchemaModule from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import type React from 'react';
import { useAuthStore } from '@/src/store/auth';
import { positionOf, testIDOrder } from './statementOrder';

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
  // `SettingsHeaderButton` in the header band reaches for the singleton.
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
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
  // Widened: F1's fixture overrides this with a real name, and the mock's
  // element type is inferred from this object.
  display_name_override: null as string | null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
};

const listEntriesMock = mock(() => Promise.resolve([makeEntry()]));
const listTimesheetsMock = mock(() => Promise.resolve([makeTimesheet()]));
// Takes the id the real `getWeek` passes it, so a two-carer week can hand
// back a DIFFERENT week per timesheet row (F-B1-3).
const getByIdMock = mock((_timesheetId?: string) =>
  Promise.resolve(makeTimesheetWeek())
);
const approveMock = mock(() =>
  Promise.resolve(makeTimesheet({ status: 'approved' }))
);
const queryMock = mock(() =>
  Promise.resolve(makeTimesheet({ status: 'queried' }))
);
// A clean week has no messages and `WeekQueryThread` renders nothing for it;
// a test that cares where the thread SITS overrides this with one message.
const getThreadMock = mock(
  (): Promise<{ messages: unknown[] }> => Promise.resolve({ messages: [] })
);
const markViewedMock = mock(() =>
  Promise.resolve(
    makeTimesheet({ parent_viewed_at: '2026-08-16T12:00:00.000Z' })
  )
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

// WP-F: the view now reads the arrangement to say when the week falls due.
// Mocked so a blanket `invalidateQueries()` below refetches a stub, not axios.
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: mock(() => Promise.resolve(null)),
    listHistory: mock(() => Promise.resolve([])),
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
        return Promise.all(matches.map(t => getByIdMock(t.id)));
      },
      approve: approveMock,
      query: queryMock,
      // 3-T1: the view reads the thread on every week. Empty is the clean
      // week, and `WeekQueryThread` renders nothing for it — but the call
      // has to resolve, or `invalidateQueries()` below waits on a rejection.
      getThread: getThreadMock,
      addThreadMessage: () => Promise.resolve({ messages: [] }),
      withdrawQuery: () => Promise.resolve({}),
      markViewed: markViewedMock,
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

function renderParentView(extra: { isPastMember?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
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
        isPastMember={extra.isPastMember}
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
  markViewedMock.mockReset();
  getThreadMock.mockReset();
  getThreadMock.mockImplementation(() => Promise.resolve({ messages: [] }));
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
  markViewedMock.mockImplementation(() =>
    Promise.resolve(
      makeTimesheet({ parent_viewed_at: '2026-08-16T12:00:00.000Z' })
    )
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

  // Daylight P0-3 regression: the headline replaces the pill for the
  // parent viewer — the two must never render together on the real,
  // fully-wired card (not just the isolated WeekTotal prop test).
  it('shows the status headline, never the StatusPill, on the real card', async () => {
    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-status-headline')).toBeTruthy()
    );
    expect(queryByTestId('hours-timesheet-status')).toBeNull();
  });

  // C3 / Pattern B (docs/CROSS-CUTTING-DEFECT-PATTERNS.md): entries succeed
  // but the timesheet read fails — per this component's own header comment,
  // the day rows keep rendering and only the money/status facts degrade.
  // `timesheetStatus={timesheet?.status ?? null}` used to pre-coerce the
  // unknown into a settled `null`, which `WeekTotal`'s `hasStatus` reads as
  // "genuinely not submitted" — printing a false headline over a week whose
  // real status the app simply failed to read.
  describe('a timesheet-only failure (entries OK, timesheet errored)', () => {
    it('never prints a status headline off an unknown timesheet', async () => {
      listTimesheetsMock.mockImplementation(() =>
        Promise.reject(new Error('timesheet boom'))
      );

      const { getByTestId, queryByTestId } = renderParentView();

      // The day rows still render — proves this is NOT the full-screen
      // entriesQuery.isError gate.
      await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
      expect(queryByTestId('hours-status-headline')).toBeNull();
      expect(queryByTestId('hours-timesheet-status')).toBeNull();
    });

    it('actionsNote reads a neutral "couldn\'t load", never "waiting for hours" (C3)', async () => {
      listTimesheetsMock.mockImplementation(() =>
        Promise.reject(new Error('timesheet boom'))
      );

      const { getByTestId } = renderParentView();

      await waitFor(() =>
        expect(getByTestId('hours-approve-waiting')).toBeTruthy()
      );
      expect(getByTestId('hours-approve-waiting').props.children).toBe(
        'couldntLoadHours'
      );
    });

    it('the approve button stays disabled, same as before (unchanged behaviour)', async () => {
      listTimesheetsMock.mockImplementation(() =>
        Promise.reject(new Error('timesheet boom'))
      );

      const { getByTestId } = renderParentView();

      await waitFor(() =>
        expect(getByTestId('hours-approve-button')).toBeTruthy()
      );
      expect(getByTestId('hours-approve-button').props.disabled).toBe(true);
    });
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
    // 033 sets `carer_id` NULL on time_entries AND timesheets — the entry
    // has to lose its id too, or this fixture describes a state the
    // database cannot produce.
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([makeEntry({ carer_id: null })])
    );
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
        'approveDialog.body'
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
        'approveDialog.bodyNoArrangement'
      )
    );
  });
});

// The approval-time adjustment, staged client-side (Option A): nothing is
// persisted until approve, so the wiring this pins is "what the parent
// staged is exactly what the approve call carries — or nothing at all".
describe('ParentWeekView — staging an approval-time adjustment', () => {
  async function stageDeduction(
    utils: ReturnType<typeof renderParentView>,
    amount = '20',
    note = 'Advance on Friday'
  ) {
    const { getByTestId } = utils;
    await waitFor(() =>
      expect(getByTestId('hours-money-card-add-adjustment')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-money-card-add-adjustment'));

    await waitFor(() =>
      expect(getByTestId('hours-week-adjustment-submit')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-week-adjustment-direction-deduct'));
    fireEvent.changeText(
      getByTestId('hours-week-adjustment-amount-input'),
      amount
    );
    fireEvent.changeText(getByTestId('hours-week-adjustment-note-input'), note);
    fireEvent.press(getByTestId('hours-week-adjustment-submit'));

    await waitFor(() =>
      expect(getByTestId('hours-money-card-adjustment')).toBeTruthy()
    );
  }

  it('sends the staged adjustment with the approval, then clears it on success', async () => {
    const utils = renderParentView();
    const { getByTestId, queryByTestId } = utils;

    await stageDeduction(utils);
    expect(
      getByTestId('hours-money-card-adjustment-row-value').props.children
    ).toBe('-£20.00');

    fireEvent.press(getByTestId('hours-approve-button'));
    await waitFor(() =>
      expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
        'approveDialog.bodyAdjustmentDeducted'
      )
    );
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));

    await waitFor(() =>
      expect(approveMock).toHaveBeenCalledWith(TIMESHEET_ID, {
        adjustment: { amount_minor: -2000, note: 'Advance on Friday' },
      })
    );
    // Sent means spent — the staged row must not survive into the next
    // render and get sent twice.
    await waitFor(() =>
      expect(queryByTestId('hours-money-card-adjustment')).toBeNull()
    );
  });

  it('approves with NO body at all when nothing is staged', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-approve-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(TIMESHEET_ID));
  });

  // A roll-up invalidates the number the parent decided against: she chose
  // "-£20" against a £236.12 week, and the week is no longer that.
  it('drops the staged adjustment when the week rolls up underneath it', async () => {
    const utils = renderParentView();
    const { getByTestId, queryByTestId, queryClient } = utils;

    await stageDeduction(utils);

    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({ updated_at: '2026-08-09T18:00:00.000Z' })
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({ updated_at: '2026-08-09T18:00:00.000Z' }),
      ])
    );
    await act(async () => {
      await queryClient.invalidateQueries();
    });

    await waitFor(() =>
      expect(queryByTestId('hours-money-card-adjustment')).toBeNull()
    );
    expect(getByTestId('hours-money-card-add-adjustment')).toBeTruthy();
  });

  it('keeps the staged adjustment across a refetch that changes nothing', async () => {
    const utils = renderParentView();
    const { getByTestId, queryClient } = utils;

    await stageDeduction(utils);
    await act(async () => {
      await queryClient.invalidateQueries();
    });

    expect(getByTestId('hours-money-card-adjustment')).toBeTruthy();
  });

  it('offers no adjustment affordance on an already-approved week', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({ status: 'approved' }))
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ status: 'approved' })])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(queryByTestId('hours-money-card-add-adjustment')).toBeNull();
  });

  it('offers no adjustment affordance on a week with no computable gross', async () => {
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

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line')).toBeTruthy()
    );
    expect(queryByTestId('hours-money-card-add-adjustment')).toBeNull();
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

  // Phase 3+4 adversarial review, finding 6 — now DECIDED on the API side:
  // approving a claim into an already-approved week is REFUSED (409,
  // reason EXPENSE_WEEK_LOCKED) rather than silently reopening the week,
  // because reimbursements are not wages and must not un-approve a
  // signed-off payroll week. The parent needs to be told that specifically:
  // the generic "couldn't be reviewed right now" invites a retry that will
  // fail identically forever.
  it('an EXPENSE_WEEK_LOCKED approve failure names the locked week rather than showing the generic retry copy', async () => {
    listPendingExpensesMock.mockImplementation(() =>
      Promise.resolve([makeExpense({ kind: 'expense', amount_minor: 1200 })])
    );
    reviewExpenseMock.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('conflict'), {
          response: {
            status: 409,
            data: {
              error: {
                code: 'CONFLICT',
                metadata: { reason: 'EXPENSE_WEEK_LOCKED' },
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
      expect(
        getByTestId('expense-review-card-expense-1-week-locked-error')
      ).toBeTruthy()
    );
    // The generic fallback must NOT also fire — two error lines on one card
    // is worse than none.
    expect(queryByTestId('expense-review-card-expense-1-error')).toBeNull();
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

// F-B1-3 (S0): the household week read returns EVERY carer's entries and
// EVERY carer's timesheet row. Summing them all into one total while binding
// approve to whichever row happened to sort first means a parent approves a
// figure they were never shown. The screen must be carer-scoped: the total
// on the card is the total the button approves.
describe('ParentWeekView — two carers in one household (F-B1-3)', () => {
  const CARER_B_ID = 'carer-bea';
  const TIMESHEET_B_ID = 'ts-2';

  const carerBMember = {
    ...householdMember,
    id: 'member-carer-b',
    user_id: CARER_B_ID,
  };

  function makeCarerBEntry() {
    return makeEntry({
      id: 'entry-2',
      carer_id: CARER_B_ID,
      carer_display_name: 'Bea',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T12:00:00.000Z',
      scheduled_minutes: null,
      local_date: '2026-08-04',
    });
  }

  function makeCarerBTimesheet(overrides: Record<string, unknown> = {}) {
    return makeTimesheet({
      id: TIMESHEET_B_ID,
      carer_id: CARER_B_ID,
      carer_display_name: 'Bea',
      total_minutes: 240,
      ...overrides,
    });
  }

  beforeEach(() => {
    // Amara: 08:00–16:00 Mon = 480 min. Bea: 08:00–12:00 Tue = 240 min.
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([makeEntry(), makeCarerBEntry()])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet(), makeCarerBTimesheet()])
    );
    getByIdMock.mockImplementation((timesheetId?: string) =>
      Promise.resolve(
        timesheetId === TIMESHEET_B_ID
          ? {
              ...makeCarerBTimesheet(),
              earnings: { ...okEarnings, gross_minor: 4440 },
            }
          : makeTimesheetWeek()
      )
    );
    listMembersMock.mockImplementation(() =>
      Promise.resolve([householdMember, carerBMember])
    );
  });

  it("shows ONE carer's hours in the week total, never the household sum", async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    // 8h (Amara alone), never 12h (Amara + Bea).
    expect(getByTestId('hours-total').props.children).toBe('8h');
  });

  it('approves the timesheet of the carer whose hours are on screen, before and after switching', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId(`hours-carer-tab-${CARER_ID}`)).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(TIMESHEET_ID));

    // Switch to Bea: the total, and what approve acts on, must move together.
    fireEvent.press(getByTestId(`hours-carer-tab-${CARER_B_ID}`));
    await waitFor(() =>
      expect(getByTestId('hours-total').props.children).toBe('4h')
    );

    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    await waitFor(() =>
      expect(approveMock).toHaveBeenCalledWith(TIMESHEET_B_ID)
    );
  });

  it("shows the selected carer's gross, not another carer's", async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );

    fireEvent.press(getByTestId(`hours-carer-tab-${CARER_B_ID}`));
    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
        '£44.40'
      )
    );
  });

  it('renders no carer switcher at all when only one carer worked the week', async () => {
    listEntriesMock.mockImplementation(() => Promise.resolve([makeEntry()]));
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet()])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-carer-switcher')).toBeNull();
    expect(getByTestId('hours-total').props.children).toBe('8h');
  });

  it('labels a segment with the carer FIRST name only, even when her snapshot has a surname', async () => {
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([
        makeEntry({ carer_display_name: 'Amara Diallo' }),
        makeCarerBEntry(),
      ])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({ carer_display_name: 'Amara Diallo' }),
        makeCarerBTimesheet({ carer_display_name: 'Bea Nkomo' }),
      ])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId(`hours-carer-tab-${CARER_ID}`)).toBeTruthy()
    );
    expect(
      within(getByTestId(`hours-carer-tab-${CARER_ID}`)).getByText('Amara')
    ).toBeTruthy();
    expect(
      within(getByTestId(`hours-carer-tab-${CARER_B_ID}`)).getByText('Bea')
    ).toBeTruthy();
  });

  // Segmented-control carer switcher, mirroring CalendarViewSwitcher's
  // pattern — plus the pending-approval dot for an unselected carer whose
  // own timesheet is 'submitted'.
  describe('carer switcher pending-approval dot', () => {
    it("shows a dot on Bea's UNSELECTED tab while her timesheet is submitted", async () => {
      const { getByTestId, queryByTestId } = renderParentView();

      await waitFor(() =>
        expect(getByTestId(`hours-carer-tab-${CARER_ID}`)).toBeTruthy()
      );

      // Amara (Amara's own default fixture id) is selected by default; her
      // own tab never carries the dot.
      expect(
        queryByTestId(`hours-carer-tab-${CARER_ID}-pending-dot`)
      ).toBeNull();
      // Bea is unselected and submitted — dot shows.
      expect(
        getByTestId(`hours-carer-tab-${CARER_B_ID}-pending-dot`)
      ).toBeTruthy();
    });

    it('moves the dot off a carer once her tab becomes the selected one', async () => {
      const { getByTestId, queryByTestId } = renderParentView();

      await waitFor(() =>
        expect(getByTestId(`hours-carer-tab-${CARER_B_ID}`)).toBeTruthy()
      );
      fireEvent.press(getByTestId(`hours-carer-tab-${CARER_B_ID}`));

      await waitFor(() =>
        expect(
          queryByTestId(`hours-carer-tab-${CARER_B_ID}-pending-dot`)
        ).toBeNull()
      );
      // Amara is now the unselected, still-submitted carer.
      expect(
        getByTestId(`hours-carer-tab-${CARER_ID}-pending-dot`)
      ).toBeTruthy();
    });

    it('never shows the dot for an approved (not submitted) unselected carer', async () => {
      // `getWeek` (see the module mock above) enriches every row through
      // `getByIdMock`, not `listTimesheetsMock` — that's what
      // `weekTimesheets`'s own `status` field actually comes from.
      getByIdMock.mockImplementation((timesheetId?: string) =>
        Promise.resolve(
          timesheetId === TIMESHEET_B_ID
            ? {
                ...makeCarerBTimesheet({ status: 'approved' }),
                earnings: { ...okEarnings, gross_minor: 4440 },
              }
            : makeTimesheetWeek()
        )
      );

      const { getByTestId, queryByTestId } = renderParentView();

      await waitFor(() =>
        expect(getByTestId(`hours-carer-tab-${CARER_B_ID}`)).toBeTruthy()
      );
      expect(
        queryByTestId(`hours-carer-tab-${CARER_B_ID}-pending-dot`)
      ).toBeNull();
    });
  });
});

// F-B1-3, second reachable path. `033_preserve_payroll_on_carer_deletion.sql`
// makes `carer_id` NULLABLE with `on delete set null` on BOTH `time_entries`
// and `timesheets`, keeping `carer_display_name` as a NOT NULL snapshot — so
// a carer who deletes her account leaves a week's hours and pay behind with
// no id. Dropping nulls when building the carer set makes her INVISIBLE to
// the switcher while her rows still sit in the totals: the handover week
// sums an ex-carer into the active carer's card and approves the ex-carer's
// timesheet.
describe('ParentWeekView — a departed carer alongside an active one (F-B1-3)', () => {
  const TIMESHEET_BEA_ID = 'ts-bea';

  function makeDepartedEntry() {
    return makeEntry({
      id: 'entry-bea',
      carer_id: null,
      carer_display_name: 'Bea',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T12:00:00.000Z',
      scheduled_minutes: null,
      local_date: '2026-08-04',
    });
  }

  function makeDepartedTimesheet() {
    return makeTimesheet({
      id: TIMESHEET_BEA_ID,
      carer_id: null,
      carer_display_name: 'Bea',
      total_minutes: 240,
    });
  }

  beforeEach(() => {
    // Amara active, 8h. Bea worked 4h the same week, then deleted her
    // account: rows preserved, carer_id nulled, name snapshot kept.
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([makeEntry(), makeDepartedEntry()])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet(), makeDepartedTimesheet()])
    );
    getByIdMock.mockImplementation((timesheetId?: string) =>
      Promise.resolve(
        timesheetId === TIMESHEET_BEA_ID
          ? {
              ...makeDepartedTimesheet(),
              earnings: {
                status: 'hours_only',
                week_start: WEEK_START,
                reason: 'carer_removed',
              },
            }
          : makeTimesheetWeek()
      )
    );
  });

  it("does not sum the departed carer into the active carer's total", async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    // 8h (Amara alone), never 12h.
    expect(getByTestId('hours-total').props.children).toBe('8h');
  });

  it('surfaces the departed carer as her own tab rather than hiding her', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-carer-switcher')).toBeTruthy()
    );
    expect(getByTestId('hours-carer-tab-Bea')).toBeTruthy();
  });

  it("approves the ACTIVE carer's week, never the departed carer's row", async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-approve-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(TIMESHEET_ID));
    expect(approveMock).not.toHaveBeenCalledWith(TIMESHEET_BEA_ID);
  });

  it("shows the departed carer's own 4h under her own tab", async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-carer-tab-Bea')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-carer-tab-Bea'));

    await waitFor(() =>
      expect(getByTestId('hours-total').props.children).toBe('4h')
    );
  });

  it('a week worked ONLY by a since-departed carer still renders her hours, no switcher', async () => {
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([makeDepartedEntry()])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeDepartedTimesheet()])
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(getByTestId('hours-total').props.children).toBe('4h');
    expect(queryByTestId('hours-carer-switcher')).toBeNull();
  });
});

// Two carers who BOTH deleted their accounts share `carer_id === null`.
// Bucketing on the id alone collapses them into one tab: the card sums both
// while approve fires one of their timesheets, freezing a pay record against
// a number that isn't its own. `carer_display_name` is NOT NULL and
// preserved by 033, so it tells them apart.
describe('ParentWeekView — two departed carers in one week (F-B1-3)', () => {
  // Clock times spelled out, never computed. Building an ISO string with
  // arithmetic yields `T9:00:00.000Z` for a 1h shift — Invalid Date, NaN
  // minutes, and every assertion silently passing for the wrong reason.
  function makeDeparted(
    name: string,
    id: string,
    mins: number,
    date: string,
    clockIn: string,
    clockOut: string
  ) {
    return {
      entry: makeEntry({
        id: `entry-${name}`,
        carer_id: null,
        carer_display_name: name,
        clock_in_at: `${date}T${clockIn}:00.000Z`,
        clock_out_at: `${date}T${clockOut}:00.000Z`,
        scheduled_minutes: null,
        local_date: date,
      }),
      timesheet: makeTimesheet({
        id,
        carer_id: null,
        carer_display_name: name,
        total_minutes: mins,
      }),
    };
  }

  const bea = makeDeparted(
    'Bea',
    'ts-bea',
    240,
    '2026-08-04',
    '08:00',
    '12:00'
  );
  const cleo = makeDeparted(
    'Cleo',
    'ts-cleo',
    120,
    '2026-08-05',
    '08:00',
    '10:00'
  );

  beforeEach(() => {
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([bea.entry, cleo.entry])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([bea.timesheet, cleo.timesheet])
    );
    getByIdMock.mockImplementation((timesheetId?: string) =>
      Promise.resolve({
        ...(timesheetId === 'ts-cleo' ? cleo.timesheet : bea.timesheet),
        earnings: {
          status: 'hours_only',
          week_start: WEEK_START,
          reason: 'carer_removed',
        },
      })
    );
  });

  it('gives each departed carer her own tab rather than summing them', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-carer-tab-Bea')).toBeTruthy()
    );
    expect(getByTestId('hours-carer-tab-Cleo')).toBeTruthy();
    // Bea's 4h alone, never 6h.
    expect(getByTestId('hours-total').props.children).toBe('4h');
  });

  it('approves the timesheet of the departed carer actually on screen', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-approve-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('ts-bea'));

    fireEvent.press(getByTestId('hours-carer-tab-Cleo'));
    await waitFor(() =>
      expect(getByTestId('hours-total').props.children).toBe('2h')
    );
    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('ts-cleo'));
  });
});

// C1 / migration 058. The describe above tells two departed carers apart by
// display name, which is all 033 left behind — so two departed carers who
// SHARED a name still collapsed into one tab, one summed total, and one
// approve button pointed at whichever timesheet sorted first. 058 stamps
// `household_member_id` from `household_members.id` at INSERT time, long
// before the account is deleted, so the rows keep a per-membership identity
// the deletion cannot take with it.
describe('ParentWeekView — two departed carers who shared a display name (C1)', () => {
  // Real `household_members.id` values: the wire schema pins them as uuids,
  // and a fixture with 'member-1' would describe a row the DB cannot hold.
  const MEMBER_EMMA_A = '55555555-5555-4555-8555-555555555555';
  const MEMBER_EMMA_B = '66666666-6666-4666-8666-666666666666';

  function makeEmma(
    memberId: string | null | undefined,
    timesheetId: string,
    mins: number,
    date: string,
    clockIn: string,
    clockOut: string
  ) {
    const memberField =
      memberId === undefined ? {} : { household_member_id: memberId };
    return {
      entry: makeEntry({
        id: `entry-${timesheetId}`,
        carer_id: null,
        carer_display_name: 'Emma',
        clock_in_at: `${date}T${clockIn}:00.000Z`,
        clock_out_at: `${date}T${clockOut}:00.000Z`,
        scheduled_minutes: null,
        local_date: date,
        ...memberField,
      }),
      timesheet: makeTimesheet({
        id: timesheetId,
        carer_id: null,
        carer_display_name: 'Emma',
        total_minutes: mins,
        ...memberField,
      }),
    };
  }

  // Both left; both were called Emma. 4h and 2h, on different days.
  const emmaA = makeEmma(
    MEMBER_EMMA_A,
    'ts-emma-a',
    240,
    '2026-08-04',
    '08:00',
    '12:00'
  );
  const emmaB = makeEmma(
    MEMBER_EMMA_B,
    'ts-emma-b',
    120,
    '2026-08-05',
    '08:00',
    '10:00'
  );

  // The household's ONE remaining active nanny. She is the whole of F1: with
  // no active carer id on a departed carer's rows, the header fell through to
  // "the household has exactly one nanny, it must be her".
  const nadia = {
    ...householdMember,
    id: 'member-nadia',
    user_id: 'carer-nadia',
    display_name_override: 'Nadia',
  };

  function seed(rows: ReturnType<typeof makeEmma>[]) {
    listMembersMock.mockImplementation(() => Promise.resolve([nadia]));
    listEntriesMock.mockImplementation(() =>
      Promise.resolve(rows.map(r => r.entry))
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve(rows.map(r => r.timesheet))
    );
    getByIdMock.mockImplementation((timesheetId?: string) => {
      const match = rows.find(r => r.timesheet.id === timesheetId) ?? rows[0];
      return Promise.resolve({
        ...makeTimesheet(match?.timesheet),
        earnings: {
          status: 'hours_only',
          week_start: WEEK_START,
          reason: 'carer_removed',
        },
      });
    });
  }

  it('gives each departed Emma her own tab rather than merging them', async () => {
    seed([emmaA, emmaB]);

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId(`hours-carer-tab-${MEMBER_EMMA_A}`)).toBeTruthy()
    );
    expect(getByTestId(`hours-carer-tab-${MEMBER_EMMA_B}`)).toBeTruthy();
    // EXACTLY two — a third tab would mean the key split one carer's rows.
    expect(getByTestId('hours-carer-switcher').props.children).toHaveLength(2);
    // ...and both read "Emma". The tab label is the human's name; the uuid is
    // only the key underneath it, and must never surface as the label.
    expect(
      within(getByTestId(`hours-carer-tab-${MEMBER_EMMA_A}`)).getByText('Emma')
    ).toBeTruthy();
    expect(
      within(getByTestId(`hours-carer-tab-${MEMBER_EMMA_B}`)).getByText('Emma')
    ).toBeTruthy();
    // The first Emma's 4h alone, never the merged 6h.
    expect(getByTestId('hours-total').props.children).toBe('4h');
  });

  // F1 (S0). Aggregation was fixed; ATTRIBUTION was not. `entryCarerIds` was
  // built from raw `e.carer_id` with nulls filtered out, so on a departed
  // carer's tab it came back EMPTY — and `resolveWeekCarerHeaderName`'s
  // no-entries branch then names the household's sole nanny. The header above
  // Emma's 4h read "Nadia", and `approveDialogCarerName` (`carerName ??
  // timesheet.carer_display_name`) never reached the correct snapshot either,
  // so the confirm dialog named Nadia over Emma's timesheet.
  it('F1: names the departed carer whose hours are on screen, not the sole active nanny', async () => {
    seed([emmaA, emmaB]);

    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-carer-name')).toBeTruthy());
    expect(getByTestId('hours-carer-name').props.children).toBe('Emma');
  });

  it('F1: still names the active carer on her own tab', async () => {
    // The regression guard for the fix: an active carer must keep resolving
    // through the member list (her household display-name override), not
    // silently switch to whatever snapshot her rows carry.
    listMembersMock.mockImplementation(() =>
      Promise.resolve([householdMember])
    );
    listEntriesMock.mockImplementation(() => Promise.resolve([makeEntry()]));
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet()])
    );
    getByIdMock.mockImplementation(() => Promise.resolve(makeTimesheetWeek()));

    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-carer-name')).toBeTruthy());
    expect(getByTestId('hours-carer-name').props.children).toBe('Amara');
  });

  it('approves the timesheet of the Emma actually on screen', async () => {
    seed([emmaA, emmaB]);

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-approve-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('ts-emma-a'));

    fireEvent.press(getByTestId(`hours-carer-tab-${MEMBER_EMMA_B}`));
    await waitFor(() =>
      expect(getByTestId('hours-total').props.children).toBe('2h')
    );
    fireEvent.press(getByTestId('hours-approve-button'));
    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('ts-emma-b'));
  });

  it('one membership, two weeks-worth of rows: still ONE carer, hours summed', async () => {
    // The other direction — the key must not split a single carer's own rows.
    const shiftOne = makeEmma(
      MEMBER_EMMA_A,
      'ts-emma-a',
      360,
      '2026-08-04',
      '08:00',
      '12:00'
    );
    const shiftTwo = makeEmma(
      MEMBER_EMMA_A,
      'ts-emma-a',
      360,
      '2026-08-05',
      '08:00',
      '10:00'
    );
    seed([shiftOne, shiftTwo]);

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-carer-switcher')).toBeNull();
    expect(getByTestId('hours-total').props.children).toBe('6h');
  });

  it('pre-058 rows carry no member id and keep the display-name fallback', async () => {
    // Rows whose carer_id was NULLed before 058 ran cannot be backfilled —
    // the membership is gone. Today's behaviour is what they keep: merged
    // under the shared name. Pinned so the fallback is not quietly dropped.
    const legacyA = makeEmma(
      undefined,
      'ts-legacy-a',
      240,
      '2026-08-04',
      '08:00',
      '12:00'
    );
    const legacyB = makeEmma(
      undefined,
      'ts-legacy-b',
      120,
      '2026-08-05',
      '08:00',
      '10:00'
    );
    seed([legacyA, legacyB]);

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-carer-switcher')).toBeNull();
    // 4h + 2h under one name — the accepted forward-only ceiling.
    expect(getByTestId('hours-total').props.children).toBe('6h');
  });
});

// The default tab must not depend on the order the server happened to return
// entries in — `useUpdateTimeEntry` correcting a `clock_in_at` earlier
// reorders the list, and a default that follows arrival order would silently
// move the parent onto a different carer's figures.
describe('ParentWeekView — default carer is order-independent', () => {
  const CARER_B_ID = 'carer-bea';

  function makeBeaEntry() {
    return makeEntry({
      id: 'entry-2',
      carer_id: CARER_B_ID,
      carer_display_name: 'Bea',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T12:00:00.000Z',
      scheduled_minutes: null,
      local_date: '2026-08-04',
    });
  }

  it('picks the same carer whichever order the week arrives in', async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet(),
        makeTimesheet({
          id: 'ts-2',
          carer_id: CARER_B_ID,
          carer_display_name: 'Bea',
        }),
      ])
    );
    // Bea's entry FIRST — arrival order reversed relative to the other tests.
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([makeBeaEntry(), makeEntry()])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    // Amara (8h) is still the default, not Bea (4h).
    expect(getByTestId('hours-total').props.children).toBe('8h');
  });
});

describe('ParentWeekView — cold-mount reopen reason', () => {
  // Parent sees their own stated reason on the week they reopened — not a
  // leak. Same slot as the nanny view; gated off approved status.
  it('shows the reopened note from reopen_reason on a submitted week without a watched transition', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          status: 'submitted',
          approved_at: null,
          reopen_reason: 'Thursday hours were wrong',
        })
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({
          status: 'submitted',
          reopen_reason: 'Thursday hours were wrong',
        }),
      ])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy()
    );
  });

  it('does not show a stale reopen_reason on an approved week', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          status: 'approved',
          approved_at: '2026-08-10T09:00:00.000Z',
          reopen_reason: 'Thursday hours were wrong',
        })
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({
          status: 'approved',
          approved_at: '2026-08-10T09:00:00.000Z',
          reopen_reason: 'Thursday hours were wrong',
        }),
      ])
    );

    const { queryByTestId, getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line')).toBeTruthy()
    );
    expect(queryByTestId('hours-earnings-line-reopened-note')).toBeNull();
  });
});

// Daylight v2 statement rebuild. Every testID below already existed; what
// changed is WHICH block owns it. The figure, the carer name, the title and
// the week nav moved out of `WeekTotal` into the new `HoursHeroBand`, and the
// gross moved out of `WeekTotal` into the new `WeekMoneyCard` — so a plain
// `getByTestId` still passes even if a band was left behind in its old home.
// These assert containment, which is the only thing that can regress.
describe('ParentWeekView — Daylight v2 statement layout', () => {
  it('puts the carer name and the week figure in the hero band, never in the status card', async () => {
    const { getByTestId } = renderParentView();

    // Anchored on the status card, not the hero band: the loading skeleton
    // renders a hero band of its own, so waiting on that would sample the
    // half-painted screen.
    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    const hero = within(getByTestId('hours-hero-band'));
    expect(hero.getByTestId('hours-total').props.children).toBe('8h');
    expect(hero.getByTestId('hours-carer-name').props.children).toBe('Amara');

    const statusCard = within(getByTestId('hours-week-total'));
    expect(statusCard.queryByTestId('hours-total')).toBeNull();
    expect(statusCard.queryByTestId('hours-carer-name')).toBeNull();
  });

  it('keeps the title and the week nav in the hero band, never in the status card', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    const hero = within(getByTestId('hours-hero-band'));
    expect(hero.getByTestId('hours-title')).toBeTruthy();
    expect(hero.getByTestId('hours-week-prev')).toBeTruthy();
    expect(hero.getByTestId('hours-week-label')).toBeTruthy();
    expect(hero.getByTestId('hours-week-next')).toBeTruthy();

    const statusCard = within(getByTestId('hours-week-total'));
    expect(statusCard.queryByTestId('hours-week-prev')).toBeNull();
    expect(statusCard.queryByTestId('hours-week-label')).toBeNull();
    expect(statusCard.queryByTestId('hours-week-next')).toBeNull();
  });

  it('leaves the status headline, the pay boundary and both actions in the status card', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    const statusCard = within(getByTestId('hours-week-total'));
    expect(statusCard.getByTestId('hours-status-chip')).toBeTruthy();
    expect(statusCard.getByTestId('hours-status-headline')).toBeTruthy();
    expect(statusCard.getByTestId('hours-pay-boundary')).toBeTruthy();
    expect(statusCard.getByTestId('hours-approve-button')).toBeTruthy();
    expect(statusCard.getByTestId('hours-query-button')).toBeTruthy();

    // The hero band is the figure and nothing to press — an approve button
    // beside the total is the pre-Daylight layout.
    const hero = within(getByTestId('hours-hero-band'));
    expect(hero.queryByTestId('hours-approve-button')).toBeNull();
    expect(hero.queryByTestId('hours-query-button')).toBeNull();
  });

  // C — "who hears this when I tap it": Approve and Ask about this week
  // each grow a recipient caption directly beneath their own button.
  // `hours-query-button`'s testID and the wire status `queried` are
  // untouched — only the label and this caption are new.
  it('C: names who hears Approve and Ask about this week, directly under each button', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    expect(getByTestId('hours-approve-button-recipient').props.children).toBe(
      'recipient.approve'
    );
    expect(getByTestId('hours-query-button-recipient').props.children).toBe(
      'recipient.query'
    );
  });

  // C — the composer both roles share names its recipient too, directly
  // under Send: the carer, for the parent viewer.
  it('C: names who a reply through the thread composer goes to', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({ status: 'queried' }))
    );
    getThreadMock.mockImplementation(() =>
      Promise.resolve({
        messages: [
          {
            id: 'msg-1',
            kind: 'query',
            author_id: PARENT_ID,
            author_name: 'Jo',
            body: 'Was Thursday a full day?',
            created_at: '2026-08-10T09:00:00.000Z',
          },
        ],
      })
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-week-thread-send')).toBeTruthy()
    );
    expect(getByTestId('hours-week-thread-send-recipient').props.children).toBe(
      'recipient.threadSend'
    );
  });

  it('renders the money line inside the money card, never inside the status card', async () => {
    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-money-card')).toBeTruthy());
    const moneyCard = within(getByTestId('hours-money-card'));
    expect(
      moneyCard.getByTestId('hours-earnings-line-amount').props.children
    ).toBe('£236.12');
    expect(
      within(getByTestId('hours-week-total')).queryByTestId(
        'hours-earnings-line'
      )
    ).toBeNull();
    // Nothing approved yet, so the settlement half of the merged card stays
    // silent rather than rendering an empty stub under the gross.
    expect(queryByTestId('hours-paid-state')).toBeNull();
  });

  // A1/A2 — the figure a parent is about to authorise must not sit below
  // every one-minute punch of the week. FlashList paints
  // header → data → footer, so this is a claim about WHICH SLOT the money
  // card is passed in, and `within()` cannot see that.
  it('paints the money card above the day ledger, under the status card, above the thread', async () => {
    // A queried week is where the thread is TALLEST — putting it first would
    // re-bury the figure on exactly the week where the figure is disputed.
    getThreadMock.mockImplementation(() =>
      Promise.resolve({
        messages: [
          {
            id: 'msg-1',
            kind: 'query',
            author_id: PARENT_ID,
            author_name: 'Jo',
            body: 'Was Thursday a full day?',
            created_at: '2026-08-10T09:00:00.000Z',
          },
        ],
      })
    );

    const view = renderParentView();

    await waitFor(() =>
      expect(view.getByTestId('hours-money-card')).toBeTruthy()
    );
    const order = testIDOrder(view.toJSON());
    const money = positionOf(order, 'hours-money-card');

    expect(money).toBeGreaterThan(positionOf(order, 'hours-hero-band'));
    expect(money).toBeGreaterThan(positionOf(order, 'hours-week-total'));
    expect(money).toBeLessThan(positionOf(order, 'hours-week-thread'));
    expect(money).toBeLessThan(positionOf(order, `hours-day-${WEEK_START}`));
  });

  it('passes per-day minutes and scheduled minutes into the hero band', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    const hero = within(getByTestId('hours-hero-band'));
    expect(hero.getByTestId('hours-week-bars')).toBeTruthy();
    expect(hero.getByTestId('hours-split-track')).toBeTruthy();
    expect(hero.getByTestId('hours-lead').props.children).toBe('lead.parent');
  });

  it('shows the week skeleton, never a full-screen spinner, while the hours load', async () => {
    listEntriesMock.mockImplementation(
      () => new Promise<ReturnType<typeof makeEntry>[]>(() => {})
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-loading')).toBeTruthy());
    expect(queryByTestId('loading-indicator-container')).toBeNull();
    // The title and the week label paint on the first frame — a blanked
    // header is the thing the skeleton replaced. Only the FIGURE waits, and
    // it waits as a shimmer rather than a fabricated 0m.
    expect(getByTestId('hours-title')).toBeTruthy();
    expect(getByTestId('hours-week-label')).toBeTruthy();
    expect(getByTestId('hours-total-skeleton')).toBeTruthy();
    expect(queryByTestId('hours-total')).toBeNull();
  });
});

describe('ParentWeekView — hours lead subject', () => {
  it('renders name-less lead copy when the carer cannot be resolved', async () => {
    // Zero entries this week + more than one nanny/helper: the header
    // genuinely cannot say whose week it is, so the lead must not start
    // with a blank name ("has 0m this week.").
    listEntriesMock.mockImplementation(() => Promise.resolve([]));
    listTimesheetsMock.mockImplementation(() => Promise.resolve([]));
    listMembersMock.mockImplementation(() =>
      Promise.resolve([
        householdMember,
        {
          ...householdMember,
          id: 'member-carer-b',
          user_id: 'carer-bea',
        },
      ])
    );

    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-lead')).toBeTruthy());
    expect(getByTestId('hours-lead').props.children).toBe('lead.parentNoCarer');
  });

  it('renders the named lead when the carer resolves', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-lead')).toBeTruthy());
    expect(getByTestId('hours-lead').props.children).toBe('lead.parent');
  });
});

describe('ParentWeekView — voided entries (069)', () => {
  const CARER_B_ID = 'carer-bea';
  const TIMESHEET_B_ID = 'ts-2';

  const carerBMember = {
    ...householdMember,
    id: 'member-carer-b',
    user_id: CARER_B_ID,
  };

  function makeCarerBEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return makeEntry({
      id: 'entry-2',
      carer_id: CARER_B_ID,
      carer_display_name: 'Bea',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T12:00:00.000Z',
      scheduled_minutes: 240,
      local_date: '2026-08-04',
      ...overrides,
    });
  }

  function makeCarerBTimesheet(
    overrides: Partial<Record<string, unknown>> = {}
  ) {
    return makeTimesheet({
      id: TIMESHEET_B_ID,
      carer_id: CARER_B_ID,
      carer_display_name: 'Bea',
      total_minutes: 0,
      ...overrides,
    });
  }

  beforeEach(() => {
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([makeEntry(), makeCarerBEntry({ status: 'voided' })])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet(), makeCarerBTimesheet()])
    );
    getByIdMock.mockImplementation((timesheetId?: string) =>
      Promise.resolve(
        timesheetId === TIMESHEET_B_ID
          ? makeTimesheetWeek({ id: TIMESHEET_B_ID, total_minutes: 0 })
          : makeTimesheetWeek()
      )
    );
    listMembersMock.mockImplementation(() =>
      Promise.resolve([householdMember, carerBMember])
    );
  });

  it('keeps a carer tab when her entire week is voided', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId(`hours-carer-tab-${CARER_B_ID}`)).toBeTruthy()
    );
  });

  it('shows 0h on a carer tab whose entries are all voided', async () => {
    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId(`hours-carer-tab-${CARER_B_ID}`)).toBeTruthy()
    );
    fireEvent.press(getByTestId(`hours-carer-tab-${CARER_B_ID}`));

    await waitFor(() =>
      expect(getByTestId('hours-total').props.children).toBe('0h')
    );
  });
});

// ---------------------------------------------------------------------------
// Landing from a payment. `PaymentDetailSheet`'s "For the week" row pushes
// `?weekStart=…&breakdown=1`; `HoursScreen` consumes that param and bumps
// `openBreakdownSignal`, which opens the breakdown this view already owns.
// The user's report was that the breakdown could not be reached at all.
// ---------------------------------------------------------------------------
const PRIOR_WEEK = '2026-07-27';
const PRIOR_TIMESHEET_ID = 'ts-prior';

function renderParentWeek(props: {
  openBreakdownSignal?: number;
  weekStartISO?: string;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const tree = (next: typeof props) => {
    const weekStartISO = next.weekStartISO ?? WEEK_START;
    const weekDates = getWeekDates(weekStartISO);
    return (
      <QueryClientProvider client={queryClient}>
        <ParentWeekView
          householdId={HOUSEHOLD_ID}
          weekStartISO={weekStartISO}
          weekDates={weekDates}
          weekRangeLabel={formatWeekRangeLabel(weekDates)}
          nowMs={new Date('2026-08-09T12:00:00.000Z').getTime()}
          timeZone="UTC"
          onPreviousWeek={() => {}}
          onNextWeek={() => {}}
          isNextWeekDisabled={false}
          isPreviousWeekDisabled={false}
          openBreakdownSignal={next.openBreakdownSignal}
        />
      </QueryClientProvider>
    );
  };
  const utils = render(tree(props));
  return {
    ...utils,
    rerenderWith: (next: typeof props) => utils.rerender(tree(next)),
  };
}

/** Both weeks priced, so "paging closes it" is testing the mechanism and
 * not just an empty week unmounting the sheet. */
function seedTwoPricedWeeks() {
  listTimesheetsMock.mockImplementation(() =>
    Promise.resolve([
      makeTimesheet(),
      makeTimesheet({ id: PRIOR_TIMESHEET_ID, week_start: PRIOR_WEEK }),
    ])
  );
  listEntriesMock.mockImplementation(() =>
    Promise.resolve([makeEntry(), makeEntry({ id: 'entry-prior' })])
  );
  getByIdMock.mockImplementation((timesheetId?: string) =>
    Promise.resolve(
      timesheetId === PRIOR_TIMESHEET_ID
        ? makeTimesheetWeek(
            { id: PRIOR_TIMESHEET_ID, week_start: PRIOR_WEEK },
            { ...okEarnings, week_start: PRIOR_WEEK, gross_minor: 11100 }
          )
        : makeTimesheetWeek()
    )
  );
}

describe('ParentWeekView — breakdown on landing', () => {
  it('opens the breakdown on landing, with no second tap on the money card', async () => {
    const { getByTestId } = renderParentWeek({ openBreakdownSignal: 1 });

    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
        true
      )
    );
    expect(getByTestId('hours-earnings-breakdown-total').props.children).toBe(
      '£236.12'
    );
  });

  it('does not open the breakdown without the signal', async () => {
    const { getByTestId, queryByTestId } = renderParentWeek({});

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
      false
    );
  });

  it('closes the breakdown when the user pages to another priced week', async () => {
    seedTwoPricedWeeks();
    const { getByTestId, queryByTestId, rerenderWith } = renderParentWeek({
      openBreakdownSignal: 1,
    });

    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
        true
      )
    );

    rerenderWith({ openBreakdownSignal: 1, weekStartISO: PRIOR_WEEK });

    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
        false
      )
    );
  });

  it('re-opens for a second payment tapped later — the signal is not swallowed', async () => {
    seedTwoPricedWeeks();
    const { getByTestId, queryByTestId, rerenderWith } = renderParentWeek({
      openBreakdownSignal: 1,
    });

    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
        true
      )
    );
    // Scoped: every other sheet this view mounts also carries a close
    // button, and Modal renders its children whether or not it is visible.
    fireEvent.press(
      within(getByTestId('hours-earnings-breakdown')).getByTestId(
        'bottom-sheet-close-button'
      )
    );
    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
        false
      )
    );

    rerenderWith({ openBreakdownSignal: 2 });

    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
        true
      )
    );
  });

  // An empty breakdown sheet is worse than no sheet: `no_arrangement` has no
  // lines to show and nothing to total. The sheet is already mounted only
  // under `earningsOk`, so the signal simply finds nothing to open.
  it('opens nothing on a no-arrangement week, and still lands on the week', async () => {
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

    const { getByTestId, queryByTestId } = renderParentWeek({
      openBreakdownSignal: 1,
    });

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-earnings-breakdown')).toBeNull();
  });
});

describe('ParentWeekView — parent viewed receipt', () => {
  // Own ids: `viewedThisSession` is module-scope and outlives a test, so a
  // test that reused `ts-1` would be asserting an earlier render's stamp.
  it('fires markViewed once for the selected carer when her week is submitted and unviewed', async () => {
    const id = 'ts-viewed-1';
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ id })])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({ id }))
    );

    const { getByTestId } = renderParentView();
    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    await waitFor(() => expect(markViewedMock).toHaveBeenCalledTimes(1));
    expect(markViewedMock).toHaveBeenCalledWith(id);
  });

  it('does not fire when parent_viewed_at is already set', async () => {
    const id = 'ts-viewed-already';
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({
          id,
          parent_viewed_at: '2026-08-16T12:00:00.000Z',
        }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          id,
          parent_viewed_at: '2026-08-16T12:00:00.000Z',
        })
      )
    );

    const { getByTestId } = renderParentView();
    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(markViewedMock).not.toHaveBeenCalled();
  });

  // P6b: the parent never saw any acknowledgment that THEY opened the
  // week — `parent_viewed_at` only ever fed the nanny's timeline. A small
  // "You viewed this on {{date}}" line now reads it back for the parent.
  it('shows a "you viewed this" note for the parent when parent_viewed_at is set', async () => {
    const id = 'ts-viewed-note';
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({ id, parent_viewed_at: '2026-08-16T12:00:00.000Z' }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({
          id,
          parent_viewed_at: '2026-08-16T12:00:00.000Z',
        })
      )
    );

    const { getByTestId } = renderParentView();

    await waitFor(() =>
      expect(getByTestId('hours-parent-viewed-note')).toBeTruthy()
    );
  });

  it('omits the "you viewed this" note when parent_viewed_at is not set', async () => {
    const id = 'ts-not-viewed-note';
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ id, parent_viewed_at: null })])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({ id, parent_viewed_at: null }))
    );

    const { getByTestId, queryByTestId } = renderParentView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-parent-viewed-note')).toBeNull();
  });

  it('fires again for the second carer when the carer switcher changes', async () => {
    const CARER_B_ID = 'carer-bea';
    const amaraId = 'ts-viewed-amara';
    const beaId = 'ts-viewed-bea';
    const carerBMember = {
      ...householdMember,
      id: 'member-carer-b-viewed',
      user_id: CARER_B_ID,
    };

    listEntriesMock.mockImplementation(() =>
      Promise.resolve([
        makeEntry(),
        makeEntry({
          id: 'entry-bea-viewed',
          carer_id: CARER_B_ID,
          carer_display_name: 'Bea',
        }),
      ])
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({ id: amaraId }),
        makeTimesheet({
          id: beaId,
          carer_id: CARER_B_ID,
          carer_display_name: 'Bea',
        }),
      ])
    );
    getByIdMock.mockImplementation((timesheetId?: string) =>
      Promise.resolve(
        timesheetId === beaId
          ? makeTimesheetWeek({
              id: beaId,
              carer_id: CARER_B_ID,
              carer_display_name: 'Bea',
            })
          : makeTimesheetWeek({ id: amaraId })
      )
    );
    listMembersMock.mockImplementation(() =>
      Promise.resolve([householdMember, carerBMember])
    );

    const { getByTestId } = renderParentView();
    await waitFor(() =>
      expect(getByTestId(`hours-carer-tab-${CARER_ID}`)).toBeTruthy()
    );
    await waitFor(() => expect(markViewedMock).toHaveBeenCalledWith(amaraId));
    expect(markViewedMock).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId(`hours-carer-tab-${CARER_B_ID}`));
    await waitFor(() => expect(markViewedMock).toHaveBeenCalledWith(beaId));
    expect(markViewedMock).toHaveBeenCalledTimes(2);
  });

  it('does not fire for a past member', async () => {
    const id = 'ts-viewed-past';
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet({ id })])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(makeTimesheetWeek({ id }))
    );

    const { getByTestId } = renderParentView({ isPastMember: true });
    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(markViewedMock).not.toHaveBeenCalled();
  });
});
