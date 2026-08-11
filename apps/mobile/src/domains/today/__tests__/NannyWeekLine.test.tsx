/**
 * @module domains/today/__tests__/NannyWeekLine
 *
 * The nanny's pay-at-a-glance line on Today: hours logged this week plus
 * timesheet status, pressable to Hours. Queried weeks earn a Card; every
 * other status stays a quiet line on the bare ground.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { fireEvent, render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const TIME_ZONE = 'UTC';
const WEEK_START = '2026-08-03';

setSystemTime(new Date('2026-08-06T12:00:00.000Z'));
afterAll(() => setSystemTime());

let NannyWeekLine: typeof import('../components/NannyWeekLine').NannyWeekLine;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;
let mockUseWeekTimesheet: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    carer_display_name: 'Ines',
    shift_id: null,
    clock_in_at: '2026-08-06T09:00:00.000Z',
    clock_out_at: '2026-08-06T17:00:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-06',
    timezone: TIME_ZONE,
    created_at: '2026-08-06T17:00:00.000Z',
    updated_at: '2026-08-06T17:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: (ns: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        ns === 'today' && options
          ? `${key}::${JSON.stringify(options)}`
          : `${ns}:${key}`,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock(), replace: mock() }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: mock((selector: (s: unknown) => unknown) =>
      selector({ user: { id: NANNY_ID } })
    ),
  }));
  mockUseWeekTimeEntries = mock(() => ({
    data: [makeEntry()],
    isLoading: false,
    isPending: false,
  }));
  mockUseWeekTimesheet = mock(() => ({
    data: [
      {
        id: 'ts-1',
        household_id: HOUSEHOLD_ID,
        carer_id: NANNY_ID,
        week_start: WEEK_START,
        status: 'submitted',
        total_minutes: 480,
        approved_at: null,
        approved_by: null,
        query_note: null,
        reopen_reason: null,
        earnings: null,
      },
    ],
    isLoading: false,
    isPending: false,
  }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));
  mock.module('@/src/hooks/queries/useWeekTimesheet', () => ({
    useWeekTimesheet: mockUseWeekTimesheet,
  }));

  NannyWeekLine = (await import('../components/NannyWeekLine')).NannyWeekLine;
});

beforeEach(() => {
  mockPush.mockClear();
  mockUseWeekTimeEntries.mockImplementation(() => ({
    data: [makeEntry()],
    isLoading: false,
    isPending: false,
  }));
  mockUseWeekTimesheet.mockImplementation(() => ({
    data: [
      {
        id: 'ts-1',
        household_id: HOUSEHOLD_ID,
        carer_id: NANNY_ID,
        week_start: WEEK_START,
        status: 'submitted',
        total_minutes: 480,
        approved_at: null,
        approved_by: null,
        query_note: null,
        reopen_reason: null,
        earnings: null,
      },
    ],
    isLoading: false,
    isPending: false,
  }));
});

describe('NannyWeekLine', () => {
  it('renders nothing while week queries are loading', () => {
    mockUseWeekTimeEntries.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isPending: true,
    }));
    const { queryByTestId } = render(
      <NannyWeekLine
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    expect(queryByTestId('today-week-line')).toBeNull();
    expect(queryByTestId('today-week-line-card')).toBeNull();
  });

  it('renders a pressable line with week duration and nanny status vocabulary', () => {
    const { getByTestId, getByText } = render(
      <NannyWeekLine
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    expect(getByTestId('today-week-line')).toBeTruthy();
    expect(
      getByText('weekLine::{"duration":"8h"} · hours:nannyStatusSubmitted')
    ).toBeTruthy();
    expect(queryCardAbsent(getByTestId)).toBe(true);
  });

  it('routes to Hours when pressed', () => {
    const { getByTestId } = render(
      <NannyWeekLine
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    fireEvent.press(getByTestId('today-week-line'));
    expect(mockPush).toHaveBeenCalledWith('/(private)/(tabs)/hours');
  });

  it('shows the in-week guaranteed-hours shortfall sub-line when the topup line is present (D-32, §2.3b)', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: [
        {
          id: 'ts-1',
          household_id: HOUSEHOLD_ID,
          carer_id: NANNY_ID,
          week_start: WEEK_START,
          status: 'submitted',
          total_minutes: 480,
          approved_at: null,
          approved_by: null,
          query_note: null,
          reopen_reason: null,
          earnings: {
            status: 'ok',
            week_start: WEEK_START,
            currency: 'GBP',
            lines: [
              {
                kind: 'guaranteed_topup',
                minutes: 120,
                rate_minor: 1850,
                multiplier: null,
                amount_minor: 3700,
                from_date: WEEK_START,
                to_date: '2026-08-09',
                arrangement_id: 'arr-1',
              },
            ],
            gross_minor: 12_100,
            reimbursements_minor: 0,
            worked_minutes: 480,
            payable_minutes: 480,
            guaranteed_minutes_per_week: 600,
          },
        },
      ],
      isLoading: false,
      isPending: false,
    }));

    const { getByTestId } = render(
      <NannyWeekLine
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    expect(getByTestId('today-week-line-guarantee-shortfall')).toBeTruthy();
  });

  it('shows no shortfall sub-line when the week is at/above the guarantee', () => {
    const { queryByTestId } = render(
      <NannyWeekLine
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    expect(queryByTestId('today-week-line-guarantee-shortfall')).toBeNull();
  });

  it('wraps a queried week in an attention Card instead of a bare line', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: [
        {
          id: 'ts-1',
          household_id: HOUSEHOLD_ID,
          carer_id: NANNY_ID,
          week_start: WEEK_START,
          status: 'queried',
          total_minutes: 480,
          approved_at: null,
          approved_by: null,
          query_note: 'Break looks long',
          reopen_reason: null,
          earnings: null,
        },
      ],
      isLoading: false,
      isPending: false,
    }));

    const { getByTestId, getByText, queryByTestId } = render(
      <NannyWeekLine
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    expect(getByTestId('today-week-line-card')).toBeTruthy();
    expect(queryByTestId('today-week-line')).toBeNull();
    expect(
      getByText('weekLine::{"duration":"8h"} · hours:nannyStatusQueried')
    ).toBeTruthy();
  });
});

function queryCardAbsent(
  getByTestId: ReturnType<typeof render>['getByTestId']
): boolean {
  try {
    getByTestId('today-week-line-card');
    return false;
  } catch {
    return true;
  }
}
