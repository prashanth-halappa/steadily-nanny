/**
 * @module domains/today/__tests__/AddMissedHoursCard.firstRun
 *
 * The hole `ClockInBlockedCard`'s footnote promises its way out of. The
 * shift-derived gate (`AddMissedHoursCard.gating.test`) needs a scheduled
 * shift with no entry — but the account that hits the clock-in block hardest
 * has NO pattern and therefore ZERO shifts, so that gate can never fire and
 * the hours she worked while blocked have no entry point at all.
 *
 * Terms agreed with a backdated `valid_from` are the only remaining signal
 * that those days exist. This file pins that second condition: her current
 * arrangement starting BEFORE today, with a day in `[valid_from..today]`
 * carrying no entry of hers, is enough on its own.
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
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const TIME_ZONE = 'UTC';

/** Thursday 6 Aug 2026. Monday-start week ⇒ this week is 03–09 Aug. */
setSystemTime(new Date('2026-08-06T12:00:00.000Z'));
afterAll(() => setSystemTime());

const THIS_WEEK_START = '2026-08-03';
const PREV_WEEK_START = '2026-07-27';
const TODAY = '2026-08-06';
/** Three days before today, inside this business week. */
const THREE_DAYS_AGO = '2026-08-03';
/** Last week — the "agreement dragged past the week boundary" case. */
const LAST_WEEK_DAY = '2026-07-30';

let AddMissedHoursCard: typeof import('../components/AddMissedHoursCard').AddMissedHoursCard;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;
let mockUseShiftsRange: ReturnType<typeof mock>;
/** Every `weekStart` the component asked entries for, in call order. */
let requestedWeekStarts: Array<string | null | undefined>;

function makeEntry(localDate: string, overrides: Partial<TimeEntry> = {}) {
  return {
    id: `entry-${localDate}`,
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    carer_display_name: 'Ines',
    shift_id: null,
    clock_in_at: `${localDate}T09:00:00.000Z`,
    clock_out_at: `${localDate}T17:00:00.000Z`,
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: localDate,
    timezone: TIME_ZONE,
    created_at: `${localDate}T17:00:00.000Z`,
    updated_at: `${localDate}T17:00:00.000Z`,
    ...overrides,
  } as TimeEntry;
}

/** Entries keyed by the week they belong to, so the two reads stay honest. */
function entriesByWeek(byWeek: Record<string, TimeEntry[]>) {
  return (_householdId: string, weekStart: string | null) => {
    requestedWeekStarts.push(weekStart);
    return {
      data: weekStart ? (byWeek[weekStart] ?? []) : undefined,
      isLoading: false,
      isPending: !weekStart,
    };
  };
}

beforeAll(async () => {
  mock.module('@/src/hooks/mutations/useCreateRetroactiveEntry', () => ({
    useCreateRetroactiveEntry: () => ({
      mutateAsync: mock(() => Promise.resolve()),
      isPending: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: mock((selector: (s: unknown) => unknown) =>
      selector({ user: { id: NANNY_ID } })
    ),
  }));
  mockUseWeekTimeEntries = mock(entriesByWeek({}));
  // ZERO shifts — no pattern was ever built. This is the reported account.
  mockUseShiftsRange = mock(() => ({
    data: [],
    isLoading: false,
    isPending: false,
  }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));

  AddMissedHoursCard = (await import('../components/AddMissedHoursCard'))
    .AddMissedHoursCard;
});

beforeEach(() => {
  requestedWeekStarts = [];
  mockUseWeekTimeEntries.mockImplementation(entriesByWeek({}));
});

function renderCard(arrangementValidFrom?: string | null) {
  return render(
    <AddMissedHoursCard
      householdId={HOUSEHOLD_ID}
      timeZone={TIME_ZONE}
      weekStartsOn={1}
      arrangementValidFrom={arrangementValidFrom}
    />
  );
}

describe('AddMissedHoursCard — the arrangement-first-run condition', () => {
  it('renders the CTA with zero shifts when terms start three days ago and nothing is logged', () => {
    expect(
      renderCard(THREE_DAYS_AGO).getByTestId('today-missed-hours-cta')
    ).toBeTruthy();
  });

  it('still renders nothing with zero shifts and no arrangement at all', () => {
    expect(renderCard(null).queryByTestId('today-missed-hours-cta')).toBeNull();
  });

  it('renders nothing when the terms start today — there is nothing to backfill', () => {
    expect(
      renderCard(TODAY).queryByTestId('today-missed-hours-cta')
    ).toBeNull();
  });

  it('renders nothing once every day from valid_from to today carries an entry', () => {
    mockUseWeekTimeEntries.mockImplementation(
      entriesByWeek({
        [THIS_WEEK_START]: [
          makeEntry('2026-08-03'),
          makeEntry('2026-08-04'),
          makeEntry('2026-08-05'),
          makeEntry('2026-08-06'),
        ],
      })
    );

    expect(
      renderCard(THREE_DAYS_AGO).queryByTestId('today-missed-hours-cta')
    ).toBeNull();
  });

  it('ignores a voided entry — a voided day is still an unlogged day', () => {
    mockUseWeekTimeEntries.mockImplementation(
      entriesByWeek({
        [THIS_WEEK_START]: [
          makeEntry('2026-08-03', { status: 'voided' }),
          makeEntry('2026-08-04'),
          makeEntry('2026-08-05'),
          makeEntry('2026-08-06'),
        ],
      })
    );

    expect(
      renderCard(THREE_DAYS_AGO).getByTestId('today-missed-hours-cta')
    ).toBeTruthy();
  });

  it("reads the previous week's entries when the agreement dragged past the week boundary", () => {
    renderCard(LAST_WEEK_DAY);

    expect(requestedWeekStarts).toContain(THIS_WEEK_START);
    expect(requestedWeekStarts).toContain(PREV_WEEK_START);
  });

  it('renders the CTA for a day stranded in last week', () => {
    mockUseWeekTimeEntries.mockImplementation(
      entriesByWeek({
        // Every day of THIS week is logged; 30 and 31 July are not.
        [THIS_WEEK_START]: [
          makeEntry('2026-08-03'),
          makeEntry('2026-08-04'),
          makeEntry('2026-08-05'),
          makeEntry('2026-08-06'),
        ],
        [PREV_WEEK_START]: [makeEntry('2026-08-01'), makeEntry('2026-08-02')],
      })
    );

    expect(
      renderCard(LAST_WEEK_DAY).getByTestId('today-missed-hours-cta')
    ).toBeTruthy();
  });

  it('does not read the previous week when the terms started inside this one', () => {
    renderCard(THREE_DAYS_AGO);

    expect(requestedWeekStarts).not.toContain(PREV_WEEK_START);
  });
});
