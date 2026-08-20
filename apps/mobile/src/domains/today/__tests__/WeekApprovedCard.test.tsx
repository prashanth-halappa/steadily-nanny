/**
 * @module domains/today/__tests__/WeekApprovedCard
 *
 * D78's plain feed card. The rule under test is `docs/11-MONEY.md` §3/§4:
 * the gross renders only under the "Approved" state label, and when the week
 * is not in the `ok` earnings state — the read failed, or the union is on
 * `no_arrangement`/`hours_only` — there is NO money line at all. A £0.00
 * here is the figure that invites a second payment.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const WEEK_START = '2026-08-10';
const TIMESHEET_ID = 'ts-week-approved-1';

let WeekApprovedCard: typeof import('../components/WeekApprovedCard').WeekApprovedCard;
let mockUseWeekTimesheet: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

function weekRow(earnings: unknown) {
  return {
    id: TIMESHEET_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    week_start: WEEK_START,
    status: 'approved',
    total_minutes: 2310,
    approved_at: '2026-08-17T10:00:00.000Z',
    earnings,
  };
}

const OK_EARNINGS = {
  status: 'ok',
  week_start: WEEK_START,
  currency: 'GBP',
  lines: [],
  gross_minor: 46200,
  reimbursements_minor: 0,
  worked_minutes: 2310,
  payable_minutes: 2310,
  guaranteed_minutes_per_week: null,
};

function renderCard() {
  return render(
    <WeekApprovedCard
      householdId={HOUSEHOLD_ID}
      weekStart={WEEK_START}
      carerId={NANNY_ID}
      totalMinutes={2310}
      approvedAt="2026-08-17T10:00:00.000Z"
      timesheetId={TIMESHEET_ID}
    />
  );
}

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: (ns: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        options ? `${ns}:${key}::${JSON.stringify(options)}` : `${ns}:${key}`,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock(), replace: mock() }),
  }));
  mockUseWeekTimesheet = mock(() => ({
    data: [weekRow(OK_EARNINGS)],
    isLoading: false,
    isError: false,
  }));
  mock.module('@/src/hooks/queries/useWeekTimesheet', () => ({
    useWeekTimesheet: mockUseWeekTimesheet,
  }));

  WeekApprovedCard = (await import('../components/WeekApprovedCard'))
    .WeekApprovedCard;
});

beforeEach(() => {
  mockPush.mockClear();
  mockUseWeekTimesheet.mockImplementation(() => ({
    data: [weekRow(OK_EARNINGS)],
    isLoading: false,
    isError: false,
  }));
});

describe('WeekApprovedCard', () => {
  it('renders the hours and the amount under the Approved state label', () => {
    const tree = renderCard();

    expect(tree.getByTestId('today-week-approved-state').props.children).toBe(
      'today:weekApproved.state'
    );
    expect(tree.getByTestId('today-week-approved-amount').props.children).toBe(
      '£462.00'
    );
    expect(
      String(tree.getByTestId('today-week-approved-hours').props.children)
    ).toContain('38h 30m');
  });

  it('renders NO money line when the earnings read errors', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
    }));

    const tree = renderCard();
    const rendered = JSON.stringify(tree.toJSON());

    expect(tree.queryByTestId('today-week-approved-amount')).toBeNull();
    expect(rendered).not.toContain('£');
    expect(rendered).not.toContain('0.00');
    // The hours and the state label still stand — a failed money read is not
    // a reason to deny that the week was approved.
    expect(
      String(tree.getByTestId('today-week-approved-hours').props.children)
    ).toContain('38h 30m');
    expect(tree.getByTestId('today-week-approved-state')).toBeTruthy();
  });

  it('renders NO money line on the no_arrangement arm', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: [
        weekRow({
          status: 'no_arrangement',
          week_start: WEEK_START,
          unpriced_dates: ['2026-08-10'],
        }),
      ],
      isLoading: false,
      isError: false,
    }));

    const tree = renderCard();
    const rendered = JSON.stringify(tree.toJSON());

    expect(tree.queryByTestId('today-week-approved-amount')).toBeNull();
    expect(rendered).not.toContain('£');
    expect(rendered).not.toContain('0.00');
  });

  it('renders NO money line while the earnings read is still loading', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isError: false,
    }));

    const tree = renderCard();

    expect(tree.queryByTestId('today-week-approved-amount')).toBeNull();
    expect(JSON.stringify(tree.toJSON())).not.toContain('£');
  });

  it('ignores another carer’s row in the same household week', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: [{ ...weekRow(OK_EARNINGS), carer_id: 'someone-else' }],
      isLoading: false,
      isError: false,
    }));

    const tree = renderCard();

    expect(tree.queryByTestId('today-week-approved-amount')).toBeNull();
  });

  it('opens the same week the push resolver opens', () => {
    const tree = renderCard();

    fireEvent.press(tree.getByTestId('today-week-approved-cta'));

    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/(tabs)/hours?householdId=${HOUSEHOLD_ID}&weekStart=${WEEK_START}&timesheetId=${TIMESHEET_ID}`
    );
  });
});
