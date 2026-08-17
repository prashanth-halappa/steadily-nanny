/**
 * @module domains/timesheet/__tests__/NannyWeekView.integration.test
 *
 * D15 real-render — renders the ACTUAL `NannyWeekView`, mocked at the API
 * endpoint boundary. Complements `ParentWeekView.integration.test.tsx`:
 * covers the nanny-role-specific rendering the parent test can't (the
 * no-arrangement arm's sentence-only, no-control nudge; the breakdown sheet
 * reachable read-only) rather than repeating every arm twice.
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
import * as payArrangementSchemaModule from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { ReimbursementSettlement } from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
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

const routerPush = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({ push: routerPush, back: mock(), replace: mock() }),
}));

// `TimeEntryDayRow` (rendered per day in the list) uses `AlertDialog` for its
// zero-duration "flagged entry" confirmation — same @rn-primitives stand-in
// as ApproveWeekDialog.test.tsx / TimeOffScreen.test.tsx; the .mjs
// distribution isn't pre-compiled for bun:test.
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
    useRootContext: () => R.useContext(Ctx),
  };
});

const NANNY_ID = 'carer-amara';
const HOUSEHOLD_ID = 'household-1';
const WEEK_START = '2026-08-03';
const TIMESHEET_ID = 'ts-1';
const now = '2026-08-01T00:00:00.000Z';

// Daylight P0-5: NannyWeekView now reads `useActiveHousehold()` for the
// approved appreciation line's household name — mocked at the same
// endpoint boundary as everything else here, not the hook level.
function makeHousehold(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: HOUSEHOLD_ID,
    name: 'The Smiths',
    timezone: 'UTC',
    address_line: null,
    latitude: null,
    longitude: null,
    currency: 'GBP',
    jurisdiction: null,
    approval_mode: 'either',
    approval_scope: 'all',
    short_notice_hours: 24,
    cancellation_paid_within_hours: 24,
    created_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
const listHouseholdsMock = mock(() => Promise.resolve([makeHousehold()]));

function makeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'entry-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
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
    carer_id: NANNY_ID,
    carer_display_name: 'Amara',
    week_start: WEEK_START,
    total_minutes: 480,
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
      minutes: 480,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 14800,
      from_date: '2026-08-03',
      to_date: '2026-08-09',
      arrangement_id: 'arr-1',
    },
  ],
  gross_minor: 14800,
  reimbursements_minor: 0,
  worked_minutes: 480,
  payable_minutes: 480,
  guaranteed_minutes_per_week: null,
};

function makeTimesheetWeek(
  overrides: Partial<Record<string, unknown>> = {},
  earnings: unknown = okEarnings
) {
  return { ...makeTimesheet(overrides), earnings };
}

const listEntriesMock = mock(() => Promise.resolve([makeEntry()]));
const listTimesheetsMock = mock(() => Promise.resolve([makeTimesheet()]));
// Takes the id the real `getWeek` passes it, so a two-carer week can hand
// back a DIFFERENT week per timesheet row (F-B1-3).
const getByIdMock = mock((_timesheetId?: string) =>
  Promise.resolve(makeTimesheetWeek())
);
const updateEntryMock = mock(() => Promise.resolve(makeEntry()));
const voidEntryMock = mock(() =>
  Promise.resolve(makeEntry({ status: 'voided' }))
);
// Phase 4 (additive): the week's own expense/mileage claims + her pay
// arrangement (read only for the add sheet's mileage-rate hint). Mocked so
// this pre-existing suite never makes a real network call now that
// `NannyWeekView` fetches both.
const listExpensesForWeekMock = mock(
  (): Promise<Expense[]> => Promise.resolve([])
);
const createExpenseMock = mock(() =>
  Promise.resolve({ id: 'expense-new', status: 'pending' })
);
const updateExpenseMock = mock(() =>
  Promise.resolve({ id: 'expense-1', status: 'pending' })
);
const withdrawExpenseMock = mock(() => Promise.resolve(undefined));
const getCurrentArrangementMock = mock(() => Promise.resolve(null));
const listReimbursementSettlementsForWeekMock = mock(
  (): Promise<ReimbursementSettlement[]> => Promise.resolve([])
);
const listShiftsMock = mock((): Promise<unknown[]> => Promise.resolve([]));

function makeShift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    starts_at: '2026-08-07T08:00:00.000Z',
    ends_at: '2026-08-07T16:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-08-07',
    kind: 'recurring',
    status: 'confirmed',
    ...overrides,
  };
}

mock.module('@/src/api/endpoints/shifts', () => ({
  shiftApi: {
    range: listShiftsMock,
    getById: mock(),
  },
}));
mock.module('@/src/api/endpoints/reimbursementSettlements', () => ({
  reimbursementSettlementApi: {
    listForWeek: listReimbursementSettlementsForWeekMock,
    listUnsettled: mock(() => Promise.resolve([])),
    create: mock(),
  },
}));
mock.module('@/src/api/endpoints/expenses', () => {
  const shared = expenseSchemaModule;
  return {
    ...shared,
    expenseApi: {
      listForWeek: listExpensesForWeekMock,
      listPending: mock(() => Promise.resolve([])),
      create: createExpenseMock,
      update: updateExpenseMock,
      withdraw: withdrawExpenseMock,
      review: mock(),
    },
  };
});
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listHouseholdsMock,
    listPast: mock(() => Promise.resolve([])),
    listMembers: mock(() => Promise.resolve([])),
  },
}));
mock.module('@/src/api/endpoints/payArrangements', () => {
  const shared = payArrangementSchemaModule;
  return {
    ...shared,
    payArrangementApi: {
      getCurrent: getCurrentArrangementMock,
      getHistory: mock(() => Promise.resolve([])),
      create: mock(),
    },
  };
});

mock.module('@/src/api/endpoints/timeEntries', () => {
  const shared = timesheetSchemaModule;
  return {
    ...shared,
    timeEntryApi: {
      listForWeek: listEntriesMock,
      update: updateEntryMock,
      void: voidEntryMock,
    },
  };
});
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
      approve: mock(),
      query: mock(),
    },
  };
});

const showSuccessToastMock = mock((_m: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock((_m: string) => {}),
  showSuccessToast: showSuccessToastMock,
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

function renderNannyView({
  readOnly = false,
  isPastMember = false,
}: {
  readOnly?: boolean;
  isPastMember?: boolean;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const weekDates = getWeekDates(WEEK_START);
  const weekRangeLabel = formatWeekRangeLabel(weekDates);
  return render(
    <QueryClientProvider client={queryClient}>
      <NannyWeekView
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
        readOnly={readOnly}
        isPastMember={isPastMember}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  listEntriesMock.mockReset();
  listTimesheetsMock.mockReset();
  getByIdMock.mockReset();
  updateEntryMock.mockReset();
  voidEntryMock.mockReset();
  showSuccessToastMock.mockReset();
  listExpensesForWeekMock.mockReset();
  createExpenseMock.mockReset();
  updateExpenseMock.mockReset();
  withdrawExpenseMock.mockReset();
  getCurrentArrangementMock.mockReset();
  listReimbursementSettlementsForWeekMock.mockReset();
  listHouseholdsMock.mockReset();
  listShiftsMock.mockReset();
  routerPush.mockClear();

  listHouseholdsMock.mockImplementation(() =>
    Promise.resolve([makeHousehold()])
  );
  listShiftsMock.mockImplementation(() => Promise.resolve([]));
  listEntriesMock.mockImplementation(() => Promise.resolve([makeEntry()]));
  listTimesheetsMock.mockImplementation(() =>
    Promise.resolve([makeTimesheet()])
  );
  getByIdMock.mockImplementation(() => Promise.resolve(makeTimesheetWeek()));
  updateEntryMock.mockImplementation(() => Promise.resolve(makeEntry()));
  voidEntryMock.mockImplementation(() =>
    Promise.resolve(makeEntry({ status: 'voided' }))
  );
  listExpensesForWeekMock.mockImplementation(() => Promise.resolve([]));
  createExpenseMock.mockImplementation(() =>
    Promise.resolve({ id: 'expense-new', status: 'pending' })
  );
  updateExpenseMock.mockImplementation(() =>
    Promise.resolve({ id: 'expense-1', status: 'pending' })
  );
  withdrawExpenseMock.mockImplementation(() => Promise.resolve(undefined));
  getCurrentArrangementMock.mockImplementation(() => Promise.resolve(null));
  listReimbursementSettlementsForWeekMock.mockImplementation(() =>
    Promise.resolve([])
  );

  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    user: { id: NANNY_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('NannyWeekView — earnings arms', () => {
  it('estimated arm: shows the amount and her own StatusPill (Daylight P0-5)', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£148.00'
    );
    // U2: a submitted week is a three-step timeline, not the "With the
    // family" pill — that sentence hid whether anyone had opened the hours.
    expect(getByTestId('hours-status-timeline')).toBeTruthy();
    expect(getByTestId('hours-timeline-logged')).toBeTruthy();
    expect(getByTestId('hours-timeline-opened')).toBeTruthy();
    expect(getByTestId('hours-timeline-waiting')).toBeTruthy();
  });

  it('tapping the money line opens the breakdown sheet, read-only', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-pressable')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-earnings-line-pressable'));

    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-total')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-breakdown-total').props.children).toBe(
      '£148.00'
    );
  });

  it('no-arrangement arm: renders the sentence only, NO control (she cannot fix it)', async () => {
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

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line')).toBeTruthy()
    );
    expect(queryByTestId('hours-earnings-line-set-rate')).toBeNull();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('approved-frozen arm: label is "Approved gross" and the breakdown header reads "Approved"', async () => {
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

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(
        getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
      ).toContain('earningsApprovedGross')
    );

    fireEvent.press(getByTestId('hours-earnings-line-pressable'));
    await waitFor(() =>
      expect(
        getByTestId('hours-earnings-breakdown-subheader').props.children
      ).toContain('earningsBreakdownApproved')
    );
  });

  // Daylight P0-5 "nanny appreciated": once approved, her card names the
  // household and the date, and the gross her own week worked out to.
  // Daylight v2: the sentence no longer carries the money clause
  // (`approvedByHouseholdWithGross` is gone) — the gross is its own
  // `Figure28` line beside it, so the SAME two facts are still stated, just
  // not in one string.
  it('approved-frozen arm: shows the appreciation line naming the household, with the gross beside it', async () => {
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

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-approved-by-note')).toBeTruthy()
    );
    expect(getByTestId('hours-approved-by-note').props.children).toBe(
      'approvedByHousehold'
    );
    expect(getByTestId('hours-approved-by-amount').props.children).toBe(
      '£148.00'
    );
    // Both live in the status card, not the money card below.
    expect(
      within(getByTestId('hours-week-total')).getByTestId(
        'hours-approved-by-amount'
      )
    ).toBeTruthy();
  });

  // docs/11-MONEY.md: the money clause is OMITTED, never fabricated, when
  // the week has no server total. An approved week priced by no arrangement
  // still gets the appreciation sentence — and no figure at all.
  it('approved-frozen arm: omits the gross figure when earnings are not `ok`', async () => {
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek(
          {
            status: 'approved',
            approved_at: '2026-08-10T09:00:00.000Z',
          },
          {
            status: 'no_arrangement',
            week_start: WEEK_START,
            unpriced_dates: [WEEK_START],
          }
        )
      )
    );
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({
          status: 'approved',
          approved_at: '2026-08-10T09:00:00.000Z',
        }),
      ])
    );

    const { getByTestId, queryByTestId, queryAllByText } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-approved-by-note')).toBeTruthy()
    );
    expect(queryByTestId('hours-approved-by-amount')).toBeNull();
    expect(queryAllByText('£0.00')).toHaveLength(0);
  });
});

// False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): entries succeed
// but the timesheet read fails — `timesheetStatus={timesheet?.status ??
// null}` used to pre-coerce the unknown into a settled `null`, and
// `WeekTotal`'s `hasStatus` reads `null` as "genuinely not submitted",
// printing a false pill/timeline over a week whose real status the app
// simply failed to read.
describe('NannyWeekView — a timesheet-only failure (entries OK, timesheet errored)', () => {
  it('never prints a status pill or timeline off an unknown timesheet', async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.reject(new Error('timesheet boom'))
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    // The day rows still render, and the money line shows its own retry —
    // proves this is not the full-screen entriesQuery.isError gate.
    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-retry')).toBeTruthy()
    );
    // `WeekTotal` has nothing true left to say for the nanny viewer once
    // `hasStatus` is false (no pill/timeline props of its own to fall back
    // on) — it correctly disappears rather than showing a status card with
    // a false pill inside it.
    expect(queryByTestId('hours-week-total')).toBeNull();
    expect(queryByTestId('hours-timesheet-status')).toBeNull();
    expect(queryByTestId('hours-status-timeline')).toBeNull();
  });
});

// Daylight v2 (screens-hours.md §2/§3/§5): the statement is five blocks, and
// which block owns which fact is the whole point of the rebuild. These pin
// the placement, not just the presence.
describe('NannyWeekView — the statement blocks own the right facts', () => {
  it('the hero band owns the figure and the week nav — the status card owns neither', async () => {
    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());

    const hero = within(getByTestId('hours-hero-band'));
    expect(hero.getByTestId('hours-title')).toBeTruthy();
    expect(hero.getByTestId('hours-total').props.children).toBe('8h');
    expect(hero.getByTestId('hours-week-prev')).toBeTruthy();
    expect(hero.getByTestId('hours-week-label')).toBeTruthy();
    expect(hero.getByTestId('hours-week-next')).toBeTruthy();

    // `WeekTotal` is the STATUS card now: the figure and the nav moved out,
    // and a submitted week owns the timeline rather than the old pill.
    const statusCard = within(getByTestId('hours-week-total'));
    expect(statusCard.queryByTestId('hours-total')).toBeNull();
    expect(statusCard.queryByTestId('hours-week-prev')).toBeNull();
    expect(statusCard.getByTestId('hours-status-timeline')).toBeTruthy();
    expect(statusCard.queryByTestId('hours-timesheet-status')).toBeNull();
    // …and the money line moved down into the money card, not up into here.
    expect(statusCard.queryByTestId('hours-earnings-line-amount')).toBeNull();
    expect(queryByTestId('hours-past-member-note')).toBeNull();
  });

  it('the past-member note is the hero band’s, and is distinct from readOnly', async () => {
    const readOnlyOnly = renderNannyView({ readOnly: true });
    await waitFor(() =>
      expect(readOnlyOnly.getByTestId('hours-total')).toBeTruthy()
    );
    // `readOnly` alone hides the writes but says nothing.
    expect(readOnlyOnly.queryByTestId('hours-past-member-note')).toBeNull();
    readOnlyOnly.unmount();

    const pastMember = renderNannyView({ readOnly: true, isPastMember: true });
    await waitFor(() =>
      expect(pastMember.getByTestId('hours-past-member-note')).toBeTruthy()
    );
    expect(
      within(pastMember.getByTestId('hours-hero-band')).getByTestId(
        'hours-past-member-note'
      ).props.children
    ).toBe('pastMemberNote');
  });

  it('the gross resolves inside the money card, never loose in the footer', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    const moneyCard = within(getByTestId('hours-money-card'));
    expect(
      moneyCard.getByTestId('hours-earnings-line-amount').props.children
    ).toBe('£148.00');
    expect(moneyCard.getByTestId('hours-earnings-line-pressable')).toBeTruthy();
  });

  it('passes per-day minutes and scheduled minutes into the hero band', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    const hero = within(getByTestId('hours-hero-band'));
    expect(hero.getByTestId('hours-week-bars')).toBeTruthy();
    expect(hero.getByTestId('hours-split-track')).toBeTruthy();
    expect(hero.getByTestId('hours-lead').props.children).toBe('lead.nanny');
  });

  it('shows the skeleton, not a full-screen spinner, while the hours load', async () => {
    let releaseEntries: (entries: unknown[]) => void = () => {};
    listEntriesMock.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseEntries = resolve as (entries: unknown[]) => void;
        })
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-loading')).toBeTruthy());
    // The week label paints immediately — the skeleton replaces the figure
    // only.
    expect(getByTestId('hours-week-label')).toBeTruthy();
    expect(queryByTestId('hours-total')).toBeNull();

    releaseEntries([makeEntry()]);
    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
  });
});

// F-B1-3 (S0): `GET /households/:id/time-entries` and
// `GET /households/:id/timesheets` are household-wide, not self-scoped — a
// second carer's hours and a second carer's pay both come back on this
// nanny's own week read. "Your week" must mean HERS.
describe('NannyWeekView — a second carer in the same household (F-B1-3)', () => {
  const OTHER_CARER_ID = 'carer-bea';
  const OTHER_TIMESHEET_ID = 'ts-2';

  beforeEach(() => {
    listEntriesMock.mockImplementation(() =>
      Promise.resolve([
        makeEntry(),
        makeEntry({
          id: 'entry-2',
          carer_id: OTHER_CARER_ID,
          carer_display_name: 'Bea',
          clock_in_at: '2026-08-04T08:00:00.000Z',
          clock_out_at: '2026-08-04T12:00:00.000Z',
          scheduled_minutes: null,
          local_date: '2026-08-04',
        }),
      ])
    );
    // Bea's row sorts FIRST — today's find-by-week picks it.
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({
          id: OTHER_TIMESHEET_ID,
          carer_id: OTHER_CARER_ID,
          carer_display_name: 'Bea',
          total_minutes: 240,
        }),
        makeTimesheet(),
      ])
    );
    getByIdMock.mockImplementation((timesheetId?: string) =>
      Promise.resolve(
        timesheetId === OTHER_TIMESHEET_ID
          ? {
              ...makeTimesheet({
                id: OTHER_TIMESHEET_ID,
                carer_id: OTHER_CARER_ID,
                carer_display_name: 'Bea',
                total_minutes: 240,
              }),
              earnings: { ...okEarnings, gross_minor: 4440 },
            }
          : makeTimesheetWeek()
      )
    );
  });

  it('totals only her own hours, never the household', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(getByTestId('hours-total').props.children).toBe('8h');
  });

  // Fails CLOSED: with no signed-in user id there is no carer to scope to,
  // and the household's summed hours under "Your week" is worse than nothing.
  it('shows nothing rather than the household sum when there is no user id', async () => {
    useAuthStore.setState({
      session: { user: { id: NANNY_ID } } as unknown as never,
      user: null,
      isInitialized: true,
    } as never);

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(getByTestId('hours-total').props.children).toBe('0m');
    // …and no money either: `find(t => t.carer_id === undefined-ish)` must
    // not land on a DEPARTED carer's row (carer_id null) and show her pay.
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
  });

  it("never falls onto a departed carer's earnings when there is no user id", async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet({
          id: 'ts-departed',
          carer_id: null,
          carer_display_name: 'Bea',
          total_minutes: 240,
        }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve({
        ...makeTimesheet({
          id: 'ts-departed',
          carer_id: null,
          carer_display_name: 'Bea',
        }),
        earnings: { ...okEarnings, gross_minor: 4440 },
      })
    );
    useAuthStore.setState({
      session: { user: { id: NANNY_ID } } as unknown as never,
      user: null,
      isInitialized: true,
    } as never);

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
  });

  it("shows her own gross, never the other carer's", async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£148.00'
    );
  });
});

describe('NannyWeekView — earnings error (review finding 4)', () => {
  // TIER0-CX-SPEC.md §4.5 "Earnings error (hours OK)": a timesheet-fetch
  // failure must degrade only the money line to a retry affordance, never
  // silently drop it — the nanny is the person the number is FOR.
  // `ParentWeekView` already wires `earningsError`/`onRetryEarnings`
  // through to `WeekTotal`; `NannyWeekView` never did.
  it('shows the retry caption + control when the timesheet fetch fails, and hours still render', async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.reject(new Error('network down'))
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-retry')).toBeTruthy()
    );
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
    // Hours must still render — a money failure never blanks the record.
    expect(getByTestId(`hours-day-${WEEK_START}`)).toBeTruthy();
  });

  it('retry re-fetches the timesheet', async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.reject(new Error('network down'))
    );

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-retry')).toBeTruthy()
    );
    const callsBeforeRetry = listTimesheetsMock.mock.calls.length;

    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([makeTimesheet()])
    );
    fireEvent.press(getByTestId('hours-earnings-line-retry'));

    await waitFor(() =>
      expect(listTimesheetsMock.mock.calls.length).toBeGreaterThan(
        callsBeforeRetry
      )
    );
  });
});

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    local_date: WEEK_START,
    kind: 'expense',
    description: 'Soft play tickets',
    amount_minor: 1200,
    miles: null,
    currency: 'GBP',
    status: 'approved',
    reviewed_by: 'parent-1',
    reviewed_at: '2026-08-04T00:00:00.000Z',
    review_note: null,
    carer_display_name: 'Amara',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('NannyWeekView — expenses & the statement (Phase 4)', () => {
  it('the "Add an expense" button opens the add sheet', async () => {
    const { getByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('expenses-add')).toBeTruthy());
    fireEvent.press(getByTestId('expenses-add'));

    await waitFor(() => expect(getByTestId('expense-add-sheet')).toBeTruthy());
  });

  // Daylight P1: "Add an expense" moved from ParentWeekView-sibling JSX
  // (gated `{readOnly ? null : <Button .../>}`) into `ExpensesListCard`'s
  // own `onAddExpense` prop — confirm the readOnly/past-member gate
  // survived the move rather than assuming it did.
  it('omits the Add-an-expense button for a past member (readOnly)', async () => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([makeExpense()])
    );
    const { queryByTestId, getByTestId } = renderNannyView({
      readOnly: true,
    });

    await waitFor(() =>
      expect(getByTestId('expense-row-expense-1-description')).toBeTruthy()
    );
    expect(queryByTestId('expenses-add')).toBeNull();
  });

  it('no Reimbursements card when the week has no approved expenses', async () => {
    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(queryByTestId('reimbursements-card')).toBeNull();
  });

  it('renders the Reimbursements card for an approved expense, excluding pending/rejected rows', async () => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([
        makeExpense({ id: 'expense-approved', status: 'approved' }),
        makeExpense({
          id: 'expense-pending',
          status: 'pending',
          description: 'Nursery run',
        }),
        makeExpense({
          id: 'expense-rejected',
          status: 'rejected',
          description: 'Taxi',
          review_note: 'Already paid in cash',
        }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek({}, { ...okEarnings, reimbursements_minor: 1200 })
      )
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card')).toBeTruthy()
    );
    expect(getByTestId('reimbursements-card-total').props.children).toBe(
      '£12.00'
    );
    expect(
      getByTestId('reimbursements-card-line-expense-approved-value')
    ).toBeTruthy();
    expect(
      queryByTestId('reimbursements-card-line-expense-pending-value')
    ).toBeNull();
    expect(
      queryByTestId('reimbursements-card-line-expense-rejected-value')
    ).toBeNull();
  });

  it('her own expenses list shows every status, and submitting the add sheet creates a new claim', async () => {
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([makeExpense({ status: 'pending' })])
    );

    const { getByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('expenses-list')).toBeTruthy());

    fireEvent.press(getByTestId('expenses-add'));
    await waitFor(() => expect(getByTestId('expense-add-sheet')).toBeTruthy());

    fireEvent.changeText(
      getByTestId('expense-add-description-input'),
      'Soft play tickets'
    );
    fireEvent.changeText(getByTestId('expense-add-amount-input'), '12.00');
    fireEvent.press(getByTestId('expense-add-submit'));

    await waitFor(() => expect(createExpenseMock).toHaveBeenCalledTimes(1));
    expect(createExpenseMock).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ kind: 'expense', amount_minor: 1200 })
    );
  });

  // Phase 3+4 adversarial review, finding 7 (nanny half): a no_arrangement
  // week has no server-computed `reimbursements_minor` — the OLD `?? 0`
  // fallback rendered a fabricated "£0.00" above her real approved claim.
  it('finding 7: no_arrangement week — real approved expense, but NO fabricated £0.00 total', async () => {
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

    const { getByTestId, queryByTestId, queryAllByText } = renderNannyView();

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

  // D-37..D-39 (household currency + jurisdiction): the currency fallback
  // chain used to bottom out at a literal `'GBP'` regardless of the
  // household. A no_arrangement week with no earnings and no arrangement
  // currency must fall through to the HOUSEHOLD's currency, never a
  // hardcoded pound sign.
  it('a USD household falls through to USD formatting, never the old GBP literal, once earnings/arrangement are silent', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([makeHousehold({ currency: 'USD' })])
    );
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

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card')).toBeTruthy()
    );
    // en-GB's ICU disambiguates USD as "US$" (same as `money.test.ts`), so
    // this asserts the currency actually switched, not a literal '$'. Scoped
    // to the reimbursements card's own line — the expense's OWN `currency`
    // field (its own row in "her expenses" list, a separate card) is a
    // different, unrelated concern from this fallback chain.
    expect(
      getByTestId('reimbursements-card-line-expense-approved-value').props
        .children
    ).toBe('US$12.00');
  });

  it('shows the settled reimbursement state after settlement, with no mark-reimbursed control', async () => {
    listReimbursementSettlementsForWeekMock.mockImplementation(() =>
      Promise.resolve([
        {
          id: '00000000-0000-4000-8000-000000000001',
          household_id: HOUSEHOLD_ID,
          carer_id: NANNY_ID,
          week_start: WEEK_START,
          amount_minor: 1200,
          currency: 'GBP',
          settled_at: '2026-08-18',
          note: null,
          recorded_by: '00000000-0000-4000-8000-000000000002',
          created_at: now,
        },
      ])
    );
    listExpensesForWeekMock.mockImplementation(() =>
      Promise.resolve([
        makeExpense({ id: 'expense-approved', status: 'approved' }),
      ])
    );
    getByIdMock.mockImplementation(() =>
      Promise.resolve(
        makeTimesheetWeek(
          { status: 'approved' },
          { ...okEarnings, reimbursements_minor: 1200 }
        )
      )
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('reimbursements-card-state')).toBeTruthy()
    );
    // Global i18n mock echoes the key only — the with-amount settled key
    // proves both settlement date and amount_minor reached the card.
    expect(getByTestId('reimbursements-card-state').props.children).toBe(
      'reimbursements.stateSettled'
    );
    expect(
      queryByTestId('reimbursements-card-mark-reimbursed-button')
    ).toBeNull();
  });
});

describe('NannyWeekView — week-closed receipt', () => {
  it('renders the week-closed receipt under the week total when the week has closed', async () => {
    listShiftsMock.mockImplementation(() => Promise.resolve([makeShift()]));

    const { getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-week-closed-receipt')).toBeTruthy()
    );
    expect(getByTestId('hours-week-total')).toBeTruthy();
  });

  it('renders no receipt while a shift is still ahead', async () => {
    listShiftsMock.mockImplementation(() =>
      Promise.resolve([
        makeShift({
          starts_at: '2026-08-09T14:00:00.000Z',
          ends_at: '2026-08-09T18:00:00.000Z',
          local_date: '2026-08-09',
        }),
      ])
    );

    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() => expect(getByTestId('hours-week-total')).toBeTruthy());
    await waitFor(() => expect(listShiftsMock).toHaveBeenCalled());
    expect(queryByTestId('hours-week-closed-receipt')).toBeNull();
  });
});

describe('NannyWeekView — cold-mount reopen reason', () => {
  // Parent reopened Tuesday; carer opens the app Thursday. No approved→
  // submitted transition was watched on this mount — only `reopen_reason`
  // on the timesheet row can surface the caption.
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

    const { getByTestId } = renderNannyView();

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

    const { queryByTestId, getByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line')).toBeTruthy()
    );
    expect(queryByTestId('hours-earnings-line-reopened-note')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Landing from a payment — same contract as `ParentWeekView`: `HoursScreen`
// consumes `?breakdown=1` and bumps `openBreakdownSignal`, and this view
// opens the `EarningsBreakdownSheet` it already owns.
// ---------------------------------------------------------------------------
const PRIOR_WEEK = '2026-07-27';
const PRIOR_TIMESHEET_ID = 'ts-prior';

function renderNannyWeek(props: {
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
        <NannyWeekView
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

describe('NannyWeekView — breakdown on landing', () => {
  it('opens the breakdown on landing, with no second tap on the money card', async () => {
    const { getByTestId } = renderNannyWeek({ openBreakdownSignal: 1 });

    await waitFor(() =>
      expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
        true
      )
    );
    expect(getByTestId('hours-earnings-breakdown-total').props.children).toBe(
      '£148.00'
    );
  });

  it('does not open the breakdown without the signal', async () => {
    const { getByTestId, queryByTestId } = renderNannyWeek({});

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-breakdown-modal').props.visible).toBe(
      false
    );
  });

  it('closes the breakdown when the user pages to another priced week', async () => {
    listTimesheetsMock.mockImplementation(() =>
      Promise.resolve([
        makeTimesheet(),
        makeTimesheet({ id: PRIOR_TIMESHEET_ID, week_start: PRIOR_WEEK }),
      ])
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

    const { getByTestId, queryByTestId, rerenderWith } = renderNannyWeek({
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

  // An empty breakdown is worse than no breakdown — the sheet only ever
  // mounts under `earningsOk`, so the signal finds nothing to open here.
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

    const { getByTestId, queryByTestId } = renderNannyWeek({
      openBreakdownSignal: 1,
    });

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('hours-earnings-breakdown')).toBeNull();
  });
});

// Acknowledged tier (U7): correcting or voiding her own hours must confirm
// the same way logging a bus fare already does. GOLDEN-FIXES #40 — the toast
// fires only after closeEditor(), or it is invisible over the open sheet.
describe('NannyWeekView — acknowledging a correction', () => {
  async function openEditor(
    getByTestId: ReturnType<typeof renderNannyView>['getByTestId']
  ) {
    await waitFor(() =>
      expect(getByTestId('hours-edit-entry-entry-1')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-edit-entry-entry-1'));
    await waitFor(() =>
      expect(getByTestId('clockout-sheet-modal').props.visible).toBe(true)
    );
  }

  it('voiding an entry closes the editor and confirms with the entry-removed toast', async () => {
    const { getByTestId } = renderNannyView();
    await openEditor(getByTestId);

    fireEvent.press(getByTestId('clockout-void'));
    await waitFor(() =>
      expect(getByTestId('hours-void-dialog-confirm')).toBeTruthy()
    );
    fireEvent.press(getByTestId('hours-void-dialog-confirm'));

    await waitFor(() =>
      expect(getByTestId('clockout-sheet-modal').props.visible).toBe(false)
    );
    expect(showSuccessToastMock).toHaveBeenCalledWith('entryRemovedToast');
  });

  it('saving a correction confirms with the correction-saved toast', async () => {
    const { getByTestId } = renderNannyView();
    await openEditor(getByTestId);

    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() =>
      expect(showSuccessToastMock).toHaveBeenCalledWith('entryCorrectedToast')
    );
  });
});
