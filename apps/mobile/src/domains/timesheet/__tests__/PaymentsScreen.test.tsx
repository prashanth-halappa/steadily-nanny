/**
 * @module domains/timesheet/__tests__/PaymentsScreen.test
 *
 * The Payments screen — a RECORD, not a to-do list. Every assertion here is
 * about what the screen states rather than what it offers: there is no L1, no
 * primary action, and nothing on it can be edited.
 *
 * Three things are load-bearing and each has a discriminating pair:
 *  - a month holding two currencies renders TWO figures and never their sum
 *    (the app has no FX rate — docs/11-MONEY.md §4);
 *  - the "entered late" line appears only when `created_at` and `paid_at` are
 *    MORE than one day apart, and stays silent otherwise;
 *  - a payment whose timesheet is missing from the client-side join still
 *    renders, minus the week line — never "undefined", never a made-up range.
 *
 * `t` echoes its key and drops interpolation params (`bun.setup.ts`), so
 * every copy assertion is against a literal key string.
 *
 * Modules are imported at MODULE SCOPE, never `require()`d inside a
 * `mock.module` factory — a `require()` of an ES module from a factory races
 * on evaluation and fails the whole file with 0 tests run.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import {
  EARNINGS_LINE_KINDS,
  EARNINGS_LINE_ORDER,
  EARNINGS_RESULT_STATUSES,
  HOURS_ONLY_REASONS,
  humanizeEarningsLineKind,
  isKnownEarningsLineKind,
  TIMESHEET_STATUSES,
  WEEK_EARNINGS_STATES,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { fireEvent, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { renderWithProviders } from '@/src/test-utils';

// Same technique as WeekTotal.test.tsx: assert the rendered size/weight off
// the flattened style array rather than a snapshot.
function flatStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY).filter(Boolean))
    : (style ?? {});
}

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const PARENT_ID = '11111111-1111-4111-8111-111111111111';
const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';
const ORPHAN_TIMESHEET_ID = '55555555-5555-4555-8555-555555555555';

type QueryLike = {
  data: Payment[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

let paymentsResult: QueryLike;
let onboardingResult: { role: string | null; status: string };
let activeHouseholdResult: {
  householdId: string | null;
  household: { id: string; name: string } | null;
  households: { id: string; name: string }[];
  pastHouseholds: { id: string; name: string }[];
  isPastHousehold: boolean;
  isLoading: boolean;
};
let timesheetRows: unknown[];
let memberRows: unknown[];

const refetchMock = mock(() => {});
const timesheetListMock = mock((_householdId: string) =>
  Promise.resolve(timesheetRows)
);

mock.module('@/src/hooks/queries/useHouseholdPayments', () => ({
  useHouseholdPayments: () => paymentsResult,
}));
mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: () => onboardingResult,
}));
mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => activeHouseholdResult,
}));
mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: memberRows }),
}));
mock.module('@/src/domains/household/components/HouseholdSwitcher', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/api/endpoints/timesheets', () => ({
  timesheetApi: { list: timesheetListMock },
  // §11.1's `earningsStructureLine` (utils/earningsFormat.ts) now imports
  // these re-exported constants through the domain's `types` barrel — real,
  // pure, sync values from the shared schema, so this mock stays a complete
  // stand-in instead of throwing on a named export it never provided.
  EARNINGS_LINE_KINDS,
  EARNINGS_LINE_ORDER,
  EARNINGS_RESULT_STATUSES,
  HOURS_ONLY_REASONS,
  humanizeEarningsLineKind,
  isKnownEarningsLineKind,
  TIMESHEET_STATUSES,
  WEEK_EARNINGS_STATES,
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

// The export affordance's only native seam — mocked as one module so the
// screen's tests never touch expo-sharing / expo-file-system.
class FakeExportUnavailableError extends Error {}
const shareCsvMock = mock((_name: string, _contents: string, _title: string) =>
  Promise.resolve()
);
mock.module('../utils/weekExport', () => ({
  ExportUnavailableError: FakeExportUnavailableError,
  weekExportFileName: (carer: string, week: string, ext: string) =>
    `${carer}-${week}.${ext}`,
  shareCsv: shareCsvMock,
}));

const showErrorToastMock = mock((_message: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: mock(() => {}),
}));

let PaymentsScreen: typeof import('../components/PaymentsScreen').PaymentsScreen;

beforeAll(async () => {
  PaymentsScreen = (await import('../components/PaymentsScreen'))
    .PaymentsScreen;
});

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    timesheet_id: TIMESHEET_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    amount_minor: 62_400,
    kind: 'payment',
    corrects_payment_id: null,
    correction_reason: null,
    currency: 'GBP',
    paid_at: '2026-08-16',
    method_note: 'Bank transfer',
    recorded_by: PARENT_ID,
    created_at: '2026-08-16T09:30:00.000Z',
    ...overrides,
  };
}

function timesheetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TIMESHEET_ID,
    week_start: '2026-08-10',
    carer_display_name: 'Amara',
    ...overrides,
  };
}

beforeEach(() => {
  refetchMock.mockClear();
  timesheetListMock.mockClear();
  shareCsvMock.mockClear();
  showErrorToastMock.mockClear();
  paymentsResult = {
    data: [],
    isPending: false,
    isError: false,
    refetch: refetchMock,
  };
  onboardingResult = { role: 'parent', status: 'onboarded' };
  activeHouseholdResult = {
    householdId: HOUSEHOLD_ID,
    household: { id: HOUSEHOLD_ID, name: 'The Halappas' },
    households: [{ id: HOUSEHOLD_ID, name: 'The Halappas' }],
    pastHouseholds: [],
    isPastHousehold: false,
    isLoading: false,
  };
  timesheetRows = [timesheetRow()];
  memberRows = [
    {
      user_id: PARENT_ID,
      role: 'owner',
      display_name_override: null,
      profile_name: 'Priya',
    },
  ];
});

describe('PaymentsScreen — states', () => {
  it('paints the back button, title and subtitle on frame 1 while the ledger loads', () => {
    paymentsResult = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    expect(getByTestId('payments-back')).toBeTruthy();
    expect(getByTestId('payments-title').props.children).toBe(
      'payments.screenTitle'
    );
    expect(getByTestId('payments-subtitle').props.children).toBe(
      'payments.subtitleParent'
    );
    // Skeletons that match the rung they become — never a full-screen spinner.
    expect(getByTestId('payments-loading')).toBeTruthy();
    expect(getByTestId('payments-month-skeleton')).toBeTruthy();
    expect(getByTestId('payments-row-skeleton-0')).toBeTruthy();
    expect(getByTestId('payments-row-skeleton-2')).toBeTruthy();
    expect(queryByTestId('payments-empty')).toBeNull();
  });

  it('shows a retryable network error below the header, title and back button intact', () => {
    paymentsResult = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    expect(getByTestId('payments-back')).toBeTruthy();
    expect(getByTestId('payments-title')).toBeTruthy();
    expect(getByTestId('payments-error')).toBeTruthy();
    // "We could not load this" is NOT "nothing has been recorded".
    expect(queryByTestId('payments-empty')).toBeNull();
  });

  it('states the empty case with no figure at all — nothing recorded is not zero', () => {
    const { getByTestId, queryByText } = renderWithProviders(
      <PaymentsScreen />
    );

    expect(getByTestId('payments-empty')).toBeTruthy();
    expect(queryByText('payments.emptyTitle')).toBeTruthy();
    expect(queryByText('payments.emptyBodyParent')).toBeTruthy();
    expect(queryByText('£0.00')).toBeNull();
  });

  it('tells a past member her record is read-only', () => {
    activeHouseholdResult = {
      householdId: HOUSEHOLD_ID,
      household: { id: HOUSEHOLD_ID, name: 'The Halappas' },
      households: [{ id: HOUSEHOLD_ID, name: 'The Halappas' }],
      pastHouseholds: [],
      isPastHousehold: true,
      isLoading: false,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    expect(getByTestId('payments-read-only').props.children).toBe(
      'payments.readOnlyNote'
    );
  });

  it('omits the read-only note for a current member', () => {
    const { queryByTestId } = renderWithProviders(<PaymentsScreen />);

    expect(queryByTestId('payments-read-only')).toBeNull();
  });
});

describe('PaymentsScreen — month groups', () => {
  it('subtotals a single-currency month under one Recorded figure', async () => {
    paymentsResult = {
      data: [
        makePayment({ id: 'p-1', amount_minor: 62_400, paid_at: '2026-08-16' }),
        makePayment({ id: 'p-2', amount_minor: 62_400, paid_at: '2026-08-09' }),
      ],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() =>
      expect(getByTestId('payments-month-2026-08')).toBeTruthy()
    );
    expect(getByTestId('payments-month-2026-08-label').props.children).toBe(
      'payments.recordedLabel'
    );
    const total = getByTestId('payments-month-2026-08-total-GBP');
    expect(total.props.children).toBe('£1,248.00');
    expect(queryByTestId('payments-month-2026-08-total-EUR')).toBeNull();
    // The subtotal used to render at the same size as one payment row
    // (Figure, 16/400) beside a 17/600 month header — the money read
    // smaller and lighter than its own header. It is now Figure28,
    // 28/700, tabular.
    expect(flatStyle(total).fontSize).toBe(28);
    expect(flatStyle(total).fontWeight).toBe('700');
    expect(flatStyle(total).fontVariant).toContain('tabular-nums');
  });

  it('renders August 2026 as a humane month label, never the raw key', async () => {
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    await waitFor(() =>
      expect(getByTestId('payments-month-2026-08-label')).toBeTruthy()
    );
    expect(getByTestId('payments-month-2026-08-title').props.children).toBe(
      'August 2026'
    );
  });

  // The app has no FX rate. Collapsing two currencies into one figure would
  // invent a conversion that does not exist — docs/11-MONEY.md §4.
  it('renders TWO stacked figures for a two-currency month and never their sum', async () => {
    paymentsResult = {
      data: [
        makePayment({ id: 'p-1', amount_minor: 62_400, currency: 'GBP' }),
        makePayment({
          id: 'p-2',
          amount_minor: 50_000,
          currency: 'EUR',
          paid_at: '2026-08-09',
        }),
      ],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByText } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() =>
      expect(getByTestId('payments-month-2026-08-total-GBP')).toBeTruthy()
    );
    expect(getByTestId('payments-month-2026-08-total-GBP').props.children).toBe(
      '£624.00'
    );
    expect(getByTestId('payments-month-2026-08-total-EUR').props.children).toBe(
      '€500.00'
    );
    // 62400 + 50000 = 112400 minor. If that string is anywhere on screen,
    // somebody summed across currencies.
    expect(queryByText('£1,124.00')).toBeNull();
    expect(queryByText('€1,124.00')).toBeNull();
  });

  it('groups two months separately, newest first', async () => {
    paymentsResult = {
      data: [
        makePayment({ id: 'p-aug', paid_at: '2026-08-16' }),
        makePayment({ id: 'p-jul', paid_at: '2026-07-19' }),
      ],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    await waitFor(() =>
      expect(getByTestId('payments-month-2026-07')).toBeTruthy()
    );
    expect(getByTestId('payments-month-2026-08')).toBeTruthy();
  });
});

describe('PaymentsScreen — rows', () => {
  it('states the settlement date, the amount and the joined week', async () => {
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    await waitFor(() =>
      expect(getByTestId('payments-row-p-1-week')).toBeTruthy()
    );
    expect(getByTestId('payments-row-p-1-date').props.children).toBe(
      'Sun 16 Aug'
    );
    expect(getByTestId('payments-row-p-1-amount').props.children).toBe(
      '£624.00'
    );
    expect(getByTestId('payments-row-p-1-week').props.children).toBe(
      'payments.rowWeek'
    );
  });

  // A payment whose timesheet isn't in the list must still render. Omitting
  // the week line is the honest failure; "Week of undefined" is not.
  it('renders a payment whose timesheet is missing from the join, minus the week line', async () => {
    paymentsResult = {
      data: [makePayment({ id: 'p-1', timesheet_id: ORPHAN_TIMESHEET_ID })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId, queryByText } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() => expect(getByTestId('payments-row-p-1')).toBeTruthy());
    expect(getByTestId('payments-row-p-1-amount').props.children).toBe(
      '£624.00'
    );
    expect(queryByTestId('payments-row-p-1-week')).toBeNull();
    expect(queryByText('undefined')).toBeNull();
    // The method note is still true and still shows. The carer attribution
    // came only from the join, so it is silently absent — never fabricated.
    expect(getByTestId('payments-row-p-1-meta').props.children).toBe(
      'Bank transfer'
    );
  });

  // --- The entered-late line: a discriminating pair -------------------------
  it('says a payment was entered late when created_at is MORE than one day after paid_at', async () => {
    paymentsResult = {
      data: [
        makePayment({
          id: 'p-1',
          paid_at: '2026-08-16',
          created_at: '2026-08-20T09:00:00.000Z',
        }),
      ],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    await waitFor(() =>
      expect(getByTestId('payments-row-p-1-late')).toBeTruthy()
    );
    expect(getByTestId('payments-row-p-1-late').props.children).toBe(
      'payments.rowEnteredLate'
    );
  });

  it('stays silent when the entry is one day or less after the money moved', async () => {
    paymentsResult = {
      data: [
        makePayment({
          id: 'p-1',
          paid_at: '2026-08-16',
          created_at: '2026-08-17T09:00:00.000Z',
        }),
      ],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() => expect(getByTestId('payments-row-p-1')).toBeTruthy());
    expect(queryByTestId('payments-row-p-1-late')).toBeNull();
  });

  // `paid_at` is a DATE, `created_at` an instant. Comparing instants makes a
  // same-evening entry look a day late whenever the clock is near midnight.
  it('stays silent for a same-day late-evening entry — dates compared, not instants', async () => {
    paymentsResult = {
      data: [
        makePayment({
          id: 'p-1',
          paid_at: '2026-08-16',
          created_at: '2026-08-16T23:45:00.000Z',
        }),
      ],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() => expect(getByTestId('payments-row-p-1')).toBeTruthy());
    expect(queryByTestId('payments-row-p-1-late')).toBeNull();
  });
});

describe('PaymentsScreen — role', () => {
  it('names who was paid, for a parent', async () => {
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    // The carer name arrives with the timesheet join, a frame after the
    // payment itself — wait for the join, not merely for the row.
    await waitFor(() =>
      expect(getByTestId('payments-row-p-1-meta').props.children).toContain(
        'payments.rowPaidTo'
      )
    );
    expect(getByTestId('payments-row-p-1-meta').props.children).toContain(
      'Bank transfer'
    );
  });

  it('does not tell a nanny who she is — no "paid to" line, and her own subtitle', async () => {
    onboardingResult = { role: 'nanny', status: 'onboarded' };
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    // Wait for the JOIN, not merely the row: the week line proves the
    // timesheet (and therefore the carer name) was available and still went
    // unused. Asserting before it lands would pass against any bug.
    await waitFor(() =>
      expect(getByTestId('payments-row-p-1-week')).toBeTruthy()
    );
    expect(getByTestId('payments-subtitle').props.children).toBe(
      'payments.subtitleNanny'
    );
    expect(getByTestId('payments-row-p-1-meta').props.children).not.toContain(
      'payments.rowPaidTo'
    );
    // The method note is hers to read, though.
    expect(getByTestId('payments-row-p-1-meta').props.children).toContain(
      'Bank transfer'
    );
  });

  it('offers the nanny her own empty copy', () => {
    onboardingResult = { role: 'nanny', status: 'onboarded' };

    const { queryByText } = renderWithProviders(<PaymentsScreen />);

    expect(queryByText('payments.emptyBodyNanny')).toBeTruthy();
    expect(queryByText('payments.emptyBodyParent')).toBeNull();
  });

  it('names the family on each row for a nanny with two households', async () => {
    onboardingResult = { role: 'nanny', status: 'onboarded' };
    activeHouseholdResult = {
      householdId: HOUSEHOLD_ID,
      household: { id: HOUSEHOLD_ID, name: 'The Halappas' },
      households: [
        { id: HOUSEHOLD_ID, name: 'The Halappas' },
        {
          id: '77777777-7777-4777-8777-777777777777',
          name: 'The Patels',
        },
      ],
      pastHouseholds: [],
      isPastHousehold: false,
      isLoading: false,
    };
    paymentsResult = {
      data: [
        makePayment({ id: 'p-1' }),
        makePayment({ id: 'p-2', paid_at: '2026-08-09' }),
      ],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    await waitFor(() =>
      expect(getByTestId('payments-row-p-1-avatar')).toBeTruthy()
    );
    expect(
      getByTestId('payments-row-p-1-avatar').props.accessibilityLabel
    ).toBe('The Halappas');
    expect(
      getByTestId('payments-row-p-2-avatar').props.accessibilityLabel
    ).toBe('The Halappas');
  });

  it('names nobody for a nanny with a single household', async () => {
    onboardingResult = { role: 'nanny', status: 'onboarded' };
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    // Wait for the join so a missing avatar is a decision, not a race.
    await waitFor(() =>
      expect(getByTestId('payments-row-p-1-week')).toBeTruthy()
    );
    expect(queryByTestId('payments-row-p-1-avatar')).toBeNull();
  });
});

describe('PaymentsScreen — notes and the leaf sheet', () => {
  it('carries the three record notes below the list', async () => {
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByText } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() => expect(getByTestId('payments-notes')).toBeTruthy());
    expect(queryByText('payments.noPaymentWeeksNote')).toBeTruthy();
    expect(queryByText('payments.reimbursementsNote')).toBeTruthy();
    expect(queryByText('paid.note')).toBeTruthy();
  });

  it('opens the leaf sheet from a row and resolves who recorded it — never a uuid', async () => {
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByTestId, queryByText } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() => expect(getByTestId('payments-row-p-1')).toBeTruthy());
    expect(queryByTestId('payments-detail')).toBeNull();

    fireEvent.press(getByTestId('payments-row-p-1'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(
      getByTestId('payments-detail-recorded-by-value').props.children
    ).toBe('Priya');
    expect(queryByText(PARENT_ID)).toBeNull();
  });

  // NannyWeekView/ParentWeekView already resolve an unmatched recorder as
  // 'detail.someone' (schedule namespace), never a hand-rolled "no longer
  // in this household" claim that could be false about a present, active
  // parent (see NannyWeekView.tsx's module doc). PaymentsScreen must land
  // on the SAME word for the SAME fact — see buildInboxItems-style D-46
  // consistency, or here, GOLDEN-FIXES-worthy if it drifts again.
  it('says "Someone" rather than showing a uuid it cannot resolve — same word as the parent/nanny week views', async () => {
    memberRows = [];
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId, queryByText } = renderWithProviders(
      <PaymentsScreen />
    );

    await waitFor(() => expect(getByTestId('payments-row-p-1')).toBeTruthy());
    fireEvent.press(getByTestId('payments-row-p-1'));

    await waitFor(() => expect(getByTestId('payments-detail')).toBeTruthy());
    expect(
      getByTestId('payments-detail-recorded-by-value').props.children
    ).toBe('detail.someone');
    expect(
      getByTestId('payments-detail-recorded-by-value').props.children
    ).not.toBe('payments.detail.recordedByGone');
    expect(queryByText(PARENT_ID)).toBeNull();
  });
});

describe('PaymentsScreen — CSV export', () => {
  it('renders the export icon in the header row', () => {
    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    expect(getByTestId('payments-export-button')).toBeTruthy();
  });

  it('opens the export sheet when the icon is tapped', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    expect(queryByTestId('payments-export-sheet')).toBeNull();
    fireEvent.press(getByTestId('payments-export-button'));

    await waitFor(() =>
      expect(getByTestId('payments-export-sheet')).toBeTruthy()
    );
  });

  it('titles the export with payments copy, never the week-flavoured default — this screen is not one week', async () => {
    const { getByTestId, queryByText } = renderWithProviders(
      <PaymentsScreen />
    );

    fireEvent.press(getByTestId('payments-export-button'));
    await waitFor(() =>
      expect(getByTestId('payments-export-csv')).toBeTruthy()
    );

    expect(queryByText('export.sheetTitle')).toBeNull();
    expect(queryByText('export.csvHint')).toBeNull();
    expect(queryByText('payments.exportTitle')).toBeTruthy();
    expect(queryByText('payments.exportCsvHint')).toBeTruthy();
  });

  it('offers no PDF option — there is no ledger statement, and a dead button on a money surface reads as a bug', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaymentsScreen />
    );

    fireEvent.press(getByTestId('payments-export-button'));
    await waitFor(() =>
      expect(getByTestId('payments-export-csv')).toBeTruthy()
    );

    expect(queryByTestId('payments-export-pdf')).toBeNull();
  });

  it('shares a CSV of the payment ledger when CSV is chosen', async () => {
    paymentsResult = {
      data: [makePayment({ id: 'p-1' })],
      isPending: false,
      isError: false,
      refetch: refetchMock,
    };

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    fireEvent.press(getByTestId('payments-export-button'));
    await waitFor(() =>
      expect(getByTestId('payments-export-csv')).toBeTruthy()
    );
    fireEvent.press(getByTestId('payments-export-csv'));

    await waitFor(() => expect(shareCsvMock).toHaveBeenCalledTimes(1));
    const csv = shareCsvMock.mock.calls[0]?.[1] as string;
    expect(csv.split('\r\n')[0]).toBe(
      'paid_at,week_start,carer,amount_minor,currency,method_note,correction_reason,recorded_by,created_at'
    );
  });

  it('surfaces export.unavailable when sharing is not available on this device', async () => {
    shareCsvMock.mockImplementationOnce(() =>
      Promise.reject(new FakeExportUnavailableError())
    );

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    fireEvent.press(getByTestId('payments-export-button'));
    await waitFor(() =>
      expect(getByTestId('payments-export-csv')).toBeTruthy()
    );
    fireEvent.press(getByTestId('payments-export-csv'));

    await waitFor(() =>
      expect(showErrorToastMock).toHaveBeenCalledWith('export.unavailable')
    );
  });

  it('surfaces export.failed on any other export error', async () => {
    shareCsvMock.mockImplementationOnce(() =>
      Promise.reject(new Error('disk full'))
    );

    const { getByTestId } = renderWithProviders(<PaymentsScreen />);

    fireEvent.press(getByTestId('payments-export-button'));
    await waitFor(() =>
      expect(getByTestId('payments-export-csv')).toBeTruthy()
    );
    fireEvent.press(getByTestId('payments-export-csv'));

    await waitFor(() =>
      expect(showErrorToastMock).toHaveBeenCalledWith('export.failed')
    );
  });
});
