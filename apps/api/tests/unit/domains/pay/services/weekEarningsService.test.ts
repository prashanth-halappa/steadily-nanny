/**
 * The impure wrapper around the pure earnings engine (TIER0-PLAN.md Phase 2,
 * "Wiring"; Phase 3/4 PTO and reimbursements wiring).
 *
 * The engine itself is exhaustively case-tabled in `earningsService.test.ts`.
 * NOTHING here re-tests arithmetic. What is pinned here is the fetch-and-map:
 * which queries run, how they are scoped, and — the money-critical ones —
 * that a PTO ledger `usage` row's NEGATIVE minutes are converted to the
 * engine's POSITIVE `pto_usage` minutes (never the reverse), that only
 * `usage` rows dated inside the week become PTO (accrual/adjustment rows and
 * out-of-week usage rows never do), and that only APPROVED expenses ever
 * reach the engine as `reimbursements`.
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

/** A `pto_ledger` row (043_pto_ledger.sql). `minutes` defaults to a USAGE
 * row's stored-negative convention — accrual +, usage −. */
function ptoLedgerRow(over: Record<string, unknown> = {}): any {
  return {
    id: 'pto1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    kind: 'usage',
    minutes: -120,
    effective_date: '2026-08-04',
    time_off_id: 'timeoff-1',
    carer_display_name: 'Nia Rowe',
    note: null,
    created_by: null,
    created_at: 't',
    ...over,
  };
}

/** An `expenses` row (044_expenses.sql), defaulting to an APPROVED claim. */
function approvedExpense(over: Record<string, unknown> = {}): any {
  return {
    id: 'exp1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    local_date: '2026-08-04',
    kind: 'expense',
    description: 'Petrol',
    amount_minor: 1500,
    miles: null,
    currency: 'GBP',
    status: 'approved',
    reviewed_by: 'parent-1',
    reviewed_at: 't',
    review_note: null,
    carer_display_name: 'Nia Rowe',
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarerWeek: mock(async () => [entry()]),
    ...overrides,
  };
}

function makeArrangementRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarer: mock(async () => [arrangement()]),
    ...overrides,
  };
}

function makeClosureRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listByHousehold: mock(async () => []),
    ...overrides,
  };
}

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByHouseholdAndLocalDate: mock(async () => []),
    ...overrides,
  };
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => ({
      id: HOUSEHOLD_ID,
      timezone: 'Europe/London',
    })),
    ...overrides,
  };
}

function makePtoRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarerYear: mock(async () => []),
    ...overrides,
  };
}

function makeExpenseRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listApprovedForWeek: mock(async () => []),
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
      ptoLedgerRows: [],
      approvedExpenses: [],
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
      ptoLedgerRows: [],
      approvedExpenses: [],
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
      ptoLedgerRows: [],
      approvedExpenses: [],
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
      ptoLedgerRows: [],
      approvedExpenses: [],
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
      ptoLedgerRows: [],
      approvedExpenses: [],
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
      ptoLedgerRows: [],
      approvedExpenses: [],
    });
    expect(built.closure_day_shifts.map(s => s.scheduled_minutes)).toEqual([
      360,
    ]);
  });

  // ===========================================================================
  // PTO usage — the sign pin. `pto_ledger` stores usage rows NEGATIVE
  // (accrual +, usage −, 043_pto_ledger.sql); the engine's `PtoUsageInput`
  // expects POSITIVE minutes to price (earningsService.ts's doc on
  // `pto_usage`). Getting this backwards would pay negative PTO or, with a
  // clamp, silently suppress nothing at all.
  // ===========================================================================

  it("converts a PTO ledger USAGE row's stored-negative minutes to a dated POSITIVE pto_usage entry", () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
      ptoLedgerRows: [
        ptoLedgerRow({ effective_date: '2026-08-04', minutes: -120 }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([
      { local_date: '2026-08-04', minutes: 120 },
    ]);
  });

  it('excludes PTO usage rows dated outside the week', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
      ptoLedgerRows: [
        // Week is [2026-08-03, 2026-08-09]. Both of these fall outside it.
        ptoLedgerRow({ effective_date: '2026-08-02', minutes: -60 }),
        ptoLedgerRow({ effective_date: '2026-08-10', minutes: -60 }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
  });

  it("excludes accrual and adjustment ledger rows — only kind='usage' prices as PTO", () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'pto-accrual',
          kind: 'accrual',
          minutes: 480,
          effective_date: '2026-08-04',
          time_off_id: null,
        }),
        ptoLedgerRow({
          id: 'pto-adjustment',
          kind: 'adjustment',
          minutes: -30,
          effective_date: '2026-08-05',
          time_off_id: null,
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
  });

  it('passes an empty pto_usage array — never the deprecated pto_usage_minutes — for a week with no PTO', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [entry()],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
      ptoLedgerRows: [],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
    expect(built.pto_usage_minutes).toBeUndefined();
  });

  // ===========================================================================
  // Reimbursements — approved expenses only, mapped straight through.
  // ===========================================================================

  it('maps an approved expense to local_date/amount_minor/currency', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
      ptoLedgerRows: [],
      approvedExpenses: [
        approvedExpense({
          local_date: '2026-08-06',
          amount_minor: 2500,
          currency: 'GBP',
        }),
      ],
    });
    expect(built.reimbursements).toEqual([
      { local_date: '2026-08-06', amount_minor: 2500, currency: 'GBP' },
    ]);
  });

  it('excludes pending and rejected expenses — approved only ever reaches the engine', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
      ptoLedgerRows: [],
      approvedExpenses: [
        approvedExpense({
          id: 'exp-pending',
          status: 'pending',
          reviewed_by: null,
          reviewed_at: null,
        }),
        approvedExpense({
          id: 'exp-rejected',
          status: 'rejected',
        }),
      ],
    });
    expect(built.reimbursements).toEqual([]);
  });

  it('builds a normal engine input for a week with neither PTO usage nor expenses', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [entry()],
      arrangements: [arrangement()],
      closureDates: [],
      closureDayShifts: [],
      ptoLedgerRows: [],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
    expect(built.reimbursements).toEqual([]);
    expect(built.pto_usage_minutes).toBeUndefined();
    expect(built.entries).toEqual([
      { kind: 'worked', local_date: '2026-08-03', minutes: 480 },
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
    const ptoRepo = makePtoRepo();
    const expenseRepo = makeExpenseRepo();
    const svc = new WeekEarningsService(
      timeEntryRepo,
      arrangementRepo,
      closureRepo,
      makeShiftRepo(),
      makeHouseholdRepo(),
      ptoRepo,
      expenseRepo
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
    // The week is entirely inside 2026, so exactly one year is fetched — and
    // BOTH household id and carer id are passed, since `listForCarerYear`
    // (unlike `listApprovedForWeek`) carries no other scoping of its own.
    expect(ptoRepo.listForCarerYear).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID,
      2026
    );
    expect(expenseRepo.listApprovedForWeek).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      WEEK_START,
      WEEK_END_EXCLUSIVE
    );
  });

  it('never queries shifts when the week has no closure days', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new WeekEarningsService(
      makeTimeEntryRepo(),
      makeArrangementRepo(),
      makeClosureRepo(),
      shiftRepo,
      makeHouseholdRepo(),
      makePtoRepo(),
      makeExpenseRepo()
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
      makeHouseholdRepo(),
      makePtoRepo(),
      makeExpenseRepo()
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
      makeHouseholdRepo(),
      makePtoRepo(),
      makeExpenseRepo()
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
      makeHouseholdRepo(),
      makePtoRepo(),
      makeExpenseRepo()
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
      makeHouseholdRepo({ findById: mock(async () => null) }),
      makePtoRepo(),
      makeExpenseRepo()
    );

    await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    // In UTC the closure starts on the 4th, not the 5th.
    expect(shiftRepo.findByHouseholdAndLocalDate).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-08-04'
    );
  });

  // ===========================================================================
  // PTO usage and reimbursements — the Phase 3+4 wiring this file exists to
  // pin. `buildWeekEarningsInput`'s own describe block already covers the
  // pure mapping (sign conversion, date/kind/status filtering); these tests
  // cover the impure fetch: which repositories are called, how they are
  // scoped, and that the priced result actually reflects real PTO and real
  // approved expenses.
  // ===========================================================================

  it('fetches PTO ledger rows from BOTH years when the week spans a year boundary', async () => {
    const ptoRepo = makePtoRepo();
    const svc = new WeekEarningsService(
      makeTimeEntryRepo({ listForCarerWeek: mock(async () => []) }),
      makeArrangementRepo({
        listForCarer: mock(async () => [
          arrangement({ valid_from: '2025-01-01' }),
        ]),
      }),
      makeClosureRepo(),
      makeShiftRepo(),
      makeHouseholdRepo(),
      ptoRepo,
      makeExpenseRepo()
    );

    // Monday 2025-12-29 .. Sunday 2026-01-04 — spans 2025 and 2026.
    await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, '2025-12-29');

    expect(ptoRepo.listForCarerYear).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID,
      2025
    );
    expect(ptoRepo.listForCarerYear).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID,
      2026
    );
    expect(ptoRepo.listForCarerYear).toHaveBeenCalledTimes(2);
  });

  it('narrows approved expenses to THIS carer in process — the repository call is household-scoped, not carer-scoped (D12)', async () => {
    const expenseRepo = makeExpenseRepo({
      listApprovedForWeek: mock(async () => [
        approvedExpense({ local_date: '2026-08-04', amount_minor: 1_000 }),
        approvedExpense({
          id: 'exp-other-carer',
          carer_id: 'carer-2',
          local_date: '2026-08-04',
          amount_minor: 5_000,
        }),
      ]),
    });
    const svc = new WeekEarningsService(
      makeTimeEntryRepo({ listForCarerWeek: mock(async () => []) }),
      makeArrangementRepo(),
      makeClosureRepo(),
      makeShiftRepo(),
      makeHouseholdRepo(),
      makePtoRepo(),
      expenseRepo
    );

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('ok');
    // Only the £10.00 claim belonging to THIS carer counts — carer-2's
    // £50.00 claim must never leak into this carer's week.
    expect(result.status === 'ok' && result.reimbursements_minor).toBe(1_000);
  });

  it('prices a week with PTO usage and an approved expense end to end', async () => {
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [
        // 2h of usage, stored negative per the ledger convention.
        ptoLedgerRow({ effective_date: '2026-08-04', minutes: -120 }),
      ]),
    });
    const expenseRepo = makeExpenseRepo({
      listApprovedForWeek: mock(async () => [
        approvedExpense({ local_date: '2026-08-06', amount_minor: 3_000 }),
      ]),
    });
    const svc = new WeekEarningsService(
      makeTimeEntryRepo(),
      makeArrangementRepo(),
      makeClosureRepo(),
      makeShiftRepo(),
      makeHouseholdRepo(),
      ptoRepo,
      expenseRepo
    );

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('ok');
    // 8h worked at £20/h = £160.00 (regular) + 2h PTO at £20/h = £40.00.
    expect(result.status === 'ok' && result.gross_minor).toBe(20_000);
    // The expense is reimbursed separately — never folded into gross.
    expect(result.status === 'ok' && result.reimbursements_minor).toBe(3_000);
    expect(
      result.status === 'ok' &&
        result.lines.some(line => line.kind === 'pto' && line.minutes === 120)
    ).toBe(true);
    expect(
      result.status === 'ok' &&
        result.lines.some(line => line.kind === 'reimbursements')
    ).toBe(true);
  });

  it('a week with real PTO usage suppresses a guaranteed top-up it now pays for on its own pto line — no double pay', async () => {
    // Guaranteed 40h/week, closure day loses a 6h shift, but 2h of paid PTO
    // already counts toward payable minutes, so the topup shrinks by that
    // much AND the carer is paid for the PTO itself on its own line.
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [
        ptoLedgerRow({ effective_date: '2026-08-04', minutes: -120 }),
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
      makeShiftRepo({
        findByHouseholdAndLocalDate: mock(async () => [shift()]),
      }),
      makeHouseholdRepo(),
      ptoRepo,
      makeExpenseRepo()
    );

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('ok');
    // pto: 2h * £20 = £40.00. topup: min(360 lost, max(0, 2400 - 120)) = 360
    // min * £20 = £120.00. gross = £160.00.
    expect(result.status === 'ok' && result.gross_minor).toBe(16_000);
  });
});
