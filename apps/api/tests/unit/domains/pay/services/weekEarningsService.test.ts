/**
 * The impure wrapper around the pure earnings engine (TIER0-PLAN.md Phase 2,
 * "Wiring").
 *
 * The engine itself is exhaustively case-tabled in `earningsService.test.ts`.
 * NOTHING here re-tests arithmetic. What is pinned here is the fetch-and-map:
 * which queries run, how they are scoped, and — the money-critical one — that
 * `pto_usage_minutes` is passed as ZERO until Phase 3 prices a `pto` line.
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  buildWeekEarningsInput,
  closureDatesInWeek,
  WeekEarningsService,
} from '../../../../../src/domains/pay/services/weekEarningsService';
import type { PayArrangement } from '../../../../../src/domains/pay/types';

const WEEK_START = '2026-08-03'; // Monday
const WEEK_END_EXCLUSIVE = '2026-08-10';
const HOUSEHOLD_ID = 'h1';
const CARER_ID = 'carer-1';

function uuid(n: number): string {
  return `11111111-1111-4111-8111-1111111111${String(n).padStart(2, '0')}`;
}

function arrangement(over: Partial<PayArrangement> = {}): PayArrangement {
  return {
    id: uuid(1),
    household_id: uuid(90),
    carer_id: uuid(91),
    rate_minor: 2000,
    bill_rate_minor: null,
    currency: 'GBP',
    overtime_threshold_minutes: null,
    overtime_multiplier: 1.5,
    guaranteed_minutes_per_week: null,
    pto_entitlement_minutes_per_year: null,
    mileage_rate_per_mile_minor: null,
    cancellation_paid_within_hours: null,
    valid_from: '2026-01-01',
    carer_display_name: 'Nia Rowe',
    note: null,
    created_by: uuid(92),
    created_at: '2026-01-01T09:00:00.000Z',
    ...over,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: test fixture, shaped like a DB row
function entry(over: Record<string, unknown> = {}): any {
  return {
    id: 'te1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    carer_display_name: 'Nia Rowe',
    shift_id: null,
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-03',
    timezone: 'Europe/London',
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: test fixture, shaped like a DB row
function shift(over: Record<string, unknown> = {}): any {
  return {
    id: 's1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    starts_at: '2026-08-05T08:00:00.000Z',
    ends_at: '2026-08-05T14:00:00.000Z', // 6h
    timezone: 'Europe/London',
    local_date: '2026-08-05',
    status: 'confirmed',
    ...over,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: test fixture, shaped like a DB row
function closure(over: Record<string, unknown> = {}): any {
  return {
    id: 'c1',
    household_id: HOUSEHOLD_ID,
    // All-day convention: exclusive local-midnight end (see
    // apps/mobile/src/domains/timeOff/utils/timeOffDate.ts `toAllDayRange`).
    starts_at: '2026-08-05T00:00:00.000+01:00',
    ends_at: '2026-08-06T00:00:00.000+01:00',
    message: null,
    created_by: null,
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: mock repo
function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarerWeek: mock(async () => [entry()]),
    ...overrides,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: mock repo
function makeArrangementRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarer: mock(async () => [arrangement()]),
    ...overrides,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: mock repo
function makeClosureRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listByHousehold: mock(async () => []),
    ...overrides,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: mock repo
function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByHouseholdAndLocalDate: mock(async () => []),
    ...overrides,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: mock repo
function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => ({
      id: HOUSEHOLD_ID,
      timezone: 'Europe/London',
    })),
    ...overrides,
  };
}

// =============================================================================
// closureDatesInWeek — instants in, household-local dates out
// =============================================================================

describe('closureDatesInWeek', () => {
  it('expands an all-day closure to its local dates, treating ends_at as EXCLUSIVE', () => {
    const dates = closureDatesInWeek(
      [
        closure({
          starts_at: '2026-08-05T00:00:00.000+01:00',
          ends_at: '2026-08-07T00:00:00.000+01:00',
        }),
      ],
      WEEK_START,
      'Europe/London'
    );
    expect(dates).toEqual(['2026-08-05', '2026-08-06']);
  });

  it('clips a closure that overhangs the week to the week itself', () => {
    const dates = closureDatesInWeek(
      [
        closure({
          starts_at: '2026-08-01T00:00:00.000+01:00',
          ends_at: '2026-08-20T00:00:00.000+01:00',
        }),
      ],
      WEEK_START,
      'Europe/London'
    );
    expect(dates).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
  });

  it('ignores a closure entirely outside the week', () => {
    expect(
      closureDatesInWeek(
        [
          closure({
            starts_at: '2026-09-01T00:00:00.000+01:00',
            ends_at: '2026-09-03T00:00:00.000+01:00',
          }),
        ],
        WEEK_START,
        'Europe/London'
      )
    ).toEqual([]);
  });

  it('still counts a sub-day closure as one closure date', () => {
    expect(
      closureDatesInWeek(
        [
          closure({
            starts_at: '2026-08-05T09:00:00.000+01:00',
            ends_at: '2026-08-05T17:00:00.000+01:00',
          }),
        ],
        WEEK_START,
        'Europe/London'
      )
    ).toEqual(['2026-08-05']);
  });

  it('resolves the local date in the HOUSEHOLD timezone, not UTC', () => {
    // 23:30 UTC on Tue 4th is already Wed 5th in Auckland.
    expect(
      closureDatesInWeek(
        [
          closure({
            starts_at: '2026-08-04T23:30:00.000Z',
            ends_at: '2026-08-05T23:30:00.000Z',
          }),
        ],
        WEEK_START,
        'Pacific/Auckland'
      )
    ).toEqual(['2026-08-05']);
  });

  it('dedupes overlapping closures and returns dates ascending', () => {
    expect(
      closureDatesInWeek(
        [
          closure({
            id: 'c2',
            starts_at: '2026-08-06T00:00:00.000+01:00',
            ends_at: '2026-08-08T00:00:00.000+01:00',
          }),
          closure({
            starts_at: '2026-08-05T00:00:00.000+01:00',
            ends_at: '2026-08-07T00:00:00.000+01:00',
          }),
        ],
        WEEK_START,
        'Europe/London'
      )
    ).toEqual(['2026-08-05', '2026-08-06', '2026-08-07']);
  });
});

// =============================================================================
// buildWeekEarningsInput — rows in, engine input out. No arithmetic of its own
// beyond the minutes the roll-up already owns.
// =============================================================================

describe('buildWeekEarningsInput', () => {
  it('passes pto_usage_minutes as ZERO — the Phase 3 hazard', () => {
    // Non-zero PTO minutes would enter `payable_minutes` and suppress a
    // guaranteed top-up WITHOUT any `pto` line being paid for it: the carer
    // would silently lose the top-up and gain nothing. Zero until Phase 3
    // prices the line (earningsService's `ComputeWeekEarningsInput` doc).
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [entry()],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
    });
    expect(built.pto_usage_minutes).toBe(0);
  });

  it('maps each finished entry to kind, local_date and clocked-span-minus-break minutes', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [
        entry({ break_minutes: 30 }),
        entry({
          id: 'te2',
          kind: 'cancellation_paid',
          local_date: '2026-08-04',
          clock_in_at: '2026-08-04T09:00:00.000Z',
          clock_out_at: '2026-08-04T12:00:00.000Z',
        }),
      ],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
    });
    expect(built.entries).toEqual([
      { kind: 'worked', local_date: '2026-08-03', minutes: 450 },
      { kind: 'cancellation_paid', local_date: '2026-08-04', minutes: 180 },
    ]);
  });

  it('skips a still-running entry rather than throwing — it has no minutes yet', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [entry({ clock_out_at: null, status: 'running' })],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
    });
    expect(built.entries).toEqual([]);
  });

  it('hands the engine the FULL arrangement history, unfiltered and unsorted', () => {
    const history = [
      arrangement({ id: uuid(2), valid_from: '2026-08-05' }),
      arrangement({ id: uuid(1), valid_from: '2026-01-01' }),
    ];
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: history,
      closureDates: [],
      closureDayShifts: [],
    });
    expect(built.arrangements).toEqual(history);
  });

  it('derives closure-day shift scheduled_minutes from the shift span', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      closureDates: ['2026-08-05'],
      closureDayShifts: [shift()],
    });
    expect(built.closure_day_shifts).toEqual([
      {
        local_date: '2026-08-05',
        scheduled_minutes: 360,
        became_payable: false,
      },
    ]);
  });

  it('marks a closure-day shift payable when a week entry references it — no double pay', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [
        entry({
          id: 'te9',
          shift_id: 's1',
          kind: 'cancellation_paid',
          local_date: '2026-08-05',
          clock_in_at: '2026-08-05T08:00:00.000Z',
          clock_out_at: '2026-08-05T14:00:00.000Z',
        }),
      ],
      arrangements: [arrangement()],
      closureDates: ['2026-08-05'],
      closureDayShifts: [shift()],
    });
    expect(built.closure_day_shifts[0]?.became_payable).toBe(true);
  });

  it('drops draft and declined shifts — never agreed, so nothing was lost', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      closureDates: ['2026-08-05'],
      closureDayShifts: [
        shift({ id: 's-draft', status: 'draft' }),
        shift({ id: 's-declined', status: 'declined' }),
        shift({ id: 's-cancelled', status: 'cancelled' }),
      ],
    });
    expect(built.closure_day_shifts.map(s => s.scheduled_minutes)).toEqual([
      360,
    ]);
  });
});

// =============================================================================
// WeekEarningsService.computeForWeek — the orchestration
// =============================================================================

describe('WeekEarningsService.computeForWeek', () => {
  it('scopes every fetch to this household, this carer and this week', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const arrangementRepo = makeArrangementRepo();
    const closureRepo = makeClosureRepo();
    const svc = new WeekEarningsService(
      timeEntryRepo,
      arrangementRepo,
      closureRepo,
      makeShiftRepo(),
      makeHouseholdRepo()
    );

    await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(timeEntryRepo.listForCarerWeek).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID,
      WEEK_START,
      WEEK_END_EXCLUSIVE
    );
    expect(arrangementRepo.listForCarer).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID
    );
    expect(closureRepo.listByHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('never queries shifts when the week has no closure days', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new WeekEarningsService(
      makeTimeEntryRepo(),
      makeArrangementRepo(),
      makeClosureRepo(),
      shiftRepo,
      makeHouseholdRepo()
    );

    await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(shiftRepo.findByHouseholdAndLocalDate).not.toHaveBeenCalled();
  });

  it('fetches shifts for each closure day and keeps only THIS carer’s (D12 scoping)', async () => {
    const shiftRepo = makeShiftRepo({
      findByHouseholdAndLocalDate: mock(async () => [
        shift(),
        shift({ id: 's-other', carer_id: 'carer-2' }),
        shift({ id: 's-unassigned', carer_id: null }),
      ]),
    });
    const svc = new WeekEarningsService(
      makeTimeEntryRepo({ listForCarerWeek: mock(async () => []) }),
      makeArrangementRepo({
        listForCarer: mock(async () => [
          arrangement({ guaranteed_minutes_per_week: 2400 }),
        ]),
      }),
      makeClosureRepo({ listByHousehold: mock(async () => [closure()]) }),
      shiftRepo,
      makeHouseholdRepo()
    );

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(shiftRepo.findByHouseholdAndLocalDate).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-08-05'
    );
    expect(shiftRepo.findByHouseholdAndLocalDate).toHaveBeenCalledTimes(1);
    // Only the carer's own 6h shift is lost: 360 min at £20/h = £120.00.
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.gross_minor).toBe(12_000);
  });

  it('returns the typed no_arrangement arm when the carer has no pay terms', async () => {
    const svc = new WeekEarningsService(
      makeTimeEntryRepo(),
      makeArrangementRepo({ listForCarer: mock(async () => []) }),
      makeClosureRepo(),
      makeShiftRepo(),
      makeHouseholdRepo()
    );

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('no_arrangement');
  });

  it('prices a plain worked week end to end', async () => {
    const svc = new WeekEarningsService(
      makeTimeEntryRepo(),
      makeArrangementRepo(),
      makeClosureRepo(),
      makeShiftRepo(),
      makeHouseholdRepo()
    );

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    // 8h at £20.00 = £160.00.
    expect(result.status === 'ok' && result.gross_minor).toBe(16_000);
    expect(result.week_start).toBe(WEEK_START);
  });

  it('falls back to UTC when the household row has gone missing', async () => {
    const closureRepo = makeClosureRepo({
      listByHousehold: mock(async () => [
        closure({
          starts_at: '2026-08-04T23:30:00.000Z',
          ends_at: '2026-08-05T23:30:00.000Z',
        }),
      ]),
    });
    const shiftRepo = makeShiftRepo();
    const svc = new WeekEarningsService(
      makeTimeEntryRepo({ listForCarerWeek: mock(async () => []) }),
      makeArrangementRepo(),
      closureRepo,
      shiftRepo,
      makeHouseholdRepo({ findById: mock(async () => null) })
    );

    await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    // In UTC the closure starts on the 4th, not the 5th.
    expect(shiftRepo.findByHouseholdAndLocalDate).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-08-04'
    );
  });
});
