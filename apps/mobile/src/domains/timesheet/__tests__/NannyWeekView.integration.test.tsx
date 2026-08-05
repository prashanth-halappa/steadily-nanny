/**
 * @module domains/timesheet/__tests__/NannyWeekView.integration.test
 *
 * D15 real-render — renders the ACTUAL `NannyWeekView`, mocked at the API
 * endpoint boundary. Complements `ParentWeekView.integration.test.tsx`:
 * covers the nanny-role-specific rendering the parent test can't (the
 * no-arrangement arm's sentence-only, no-control nudge; the breakdown sheet
 * reachable read-only) rather than repeating every arm twice.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
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
const getByIdMock = mock(() => Promise.resolve(makeTimesheetWeek()));
const updateEntryMock = mock(() => Promise.resolve(makeEntry()));

mock.module('@/src/api/endpoints/timeEntries', () => {
  const shared = require('@steadily-nanny/shared-types/schemas/timesheet.schema');
  return {
    ...shared,
    timeEntryApi: { listForWeek: listEntriesMock, update: updateEntryMock },
  };
});
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
      approve: mock(),
      query: mock(),
    },
  };
});

let NannyWeekView: typeof import('../components/NannyWeekView').NannyWeekView;
let getWeekDates: typeof import('../utils/week').getWeekDates;
let formatWeekRangeLabel: typeof import('../utils/week').formatWeekRangeLabel;

beforeAll(async () => {
  NannyWeekView = (await import('../components/NannyWeekView')).NannyWeekView;
  const weekUtils = await import('../utils/week');
  getWeekDates = weekUtils.getWeekDates;
  formatWeekRangeLabel = weekUtils.formatWeekRangeLabel;
});

function renderNannyView() {
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
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  listEntriesMock.mockReset();
  listTimesheetsMock.mockReset();
  getByIdMock.mockReset();
  updateEntryMock.mockReset();
  routerPush.mockClear();

  listEntriesMock.mockImplementation(() => Promise.resolve([makeEntry()]));
  listTimesheetsMock.mockImplementation(() =>
    Promise.resolve([makeTimesheet()])
  );
  getByIdMock.mockImplementation(() => Promise.resolve(makeTimesheetWeek()));

  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    user: { id: NANNY_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('NannyWeekView — earnings arms', () => {
  it('estimated arm: shows the amount and no StatusPill row (nanny view never got one)', async () => {
    const { getByTestId, queryByTestId } = renderNannyView();

    await waitFor(() =>
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy()
    );
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£148.00'
    );
    expect(queryByTestId('hours-timesheet-status')).toBeNull();
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
