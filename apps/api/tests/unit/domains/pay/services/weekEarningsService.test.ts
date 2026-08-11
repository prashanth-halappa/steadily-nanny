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
    // 065: null = these terms are still live (set only on member removal).
    valid_to: null,
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

function makeWeekEarningsService(
  overrides: {
    timeEntryRepo?: ReturnType<typeof makeTimeEntryRepo>;
    arrangementRepo?: ReturnType<typeof makeArrangementRepo>;
    ptoRepo?: ReturnType<typeof makePtoRepo>;
    expenseRepo?: ReturnType<typeof makeExpenseRepo>;
    holidayRepo?: ReturnType<typeof makeHolidayRepo>;
  } = {}
): WeekEarningsService {
  return new WeekEarningsService(
    overrides.timeEntryRepo ?? makeTimeEntryRepo(),
    overrides.arrangementRepo ?? makeArrangementRepo(),
    overrides.ptoRepo ?? makePtoRepo(),
    overrides.expenseRepo ?? makeExpenseRepo(),
    overrides.holidayRepo ?? makeHolidayRepo()
  );
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

/** 080's toggles. Empty by default — no household observes a holiday unless
 * the case under test says so, which is also what the table means (absence is
 * "nothing agreed"). */
function makeHolidayRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForHousehold: mock(async () => []),
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
      ptoLedgerRows: [],
      approvedExpenses: [],
    });
    expect(built.entries).toEqual([
      { kind: 'worked', local_date: '2026-08-03', minutes: 450 },
      { kind: 'cancellation_paid', local_date: '2026-08-04', minutes: 180 },
    ]);
  });

  it('prices a cancellation fragment from its stored scheduled_minutes, not its span (C7)', () => {
    // The residual the round-once rule writes. The paycheck and
    // `total_minutes` must read the SAME number — the twin assertion lives in
    // `workedMinutes.test.ts`.
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [
        entry({
          id: 'te-frag',
          kind: 'cancellation_paid',
          local_date: '2026-08-04',
          clock_in_at: '2026-08-04T12:00:40.000Z',
          clock_out_at: '2026-08-04T19:00:20.000Z', // rounds to 420 on its own
          scheduled_minutes: 419,
        }),
        entry({
          id: 'te-legacy',
          kind: 'cancellation_paid',
          local_date: '2026-08-05',
          clock_in_at: '2026-08-05T09:00:00.000Z',
          clock_out_at: '2026-08-05T12:00:00.000Z',
          scheduled_minutes: null,
        }),
        // A worked row's scheduled_minutes is the roster, never the pay.
        entry({
          id: 'te-worked',
          local_date: '2026-08-06',
          clock_in_at: '2026-08-06T09:00:00.000Z',
          clock_out_at: '2026-08-06T13:00:00.000Z',
          scheduled_minutes: 480,
        }),
      ],
      arrangements: [arrangement()],
      ptoLedgerRows: [],
      approvedExpenses: [],
    });
    expect(built.entries).toEqual([
      { kind: 'cancellation_paid', local_date: '2026-08-04', minutes: 419 },
      { kind: 'cancellation_paid', local_date: '2026-08-05', minutes: 180 },
      { kind: 'worked', local_date: '2026-08-06', minutes: 240 },
    ]);
  });

  it('skips a still-running entry rather than throwing — it has no minutes yet', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [entry({ clock_out_at: null, status: 'running' })],
      arrangements: [arrangement()],
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
      ptoLedgerRows: [],
      approvedExpenses: [],
    });
    expect(built.arrangements).toEqual(history);
  });

  it('prices zero gross money for a voided worked entry — voided minutes must not bank', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [
        entry({
          id: 'te-voided',
          status: 'voided',
          shift_id: 's1',
          local_date: '2026-08-05',
          clock_in_at: '2026-08-05T08:00:00.000Z',
          clock_out_at: '2026-08-05T14:00:00.000Z',
        }),
      ],
      arrangements: [arrangement()],
      ptoLedgerRows: [],
      approvedExpenses: [],
    });
    expect(built.entries).toEqual([]);
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
      ptoLedgerRows: [
        ptoLedgerRow({ effective_date: '2026-08-04', minutes: -120 }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([
      { local_date: '2026-08-04', minutes: 120 },
    ]);
  });

  it('keeps a worked entry and a PTO usage row on the SAME local date BOTH — the netting groups by time_off_id, never by date (F-B10-5)', () => {
    // The half-day: four hours of booked leave and a worked afternoon on the
    // same Tuesday. `netPtoUsage` groups by `time_off_id` and never looks at
    // `sources.entries` at all, so there is no path by which the worked
    // minutes could be netted away — but nothing pinned that, and the engine
    // downstream prices both buckets additively (see the same-date case in
    // earningsService.test.ts). One shared date, two separate outputs.
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [
        entry({
          local_date: '2026-08-04',
          clock_in_at: '2026-08-04T13:00:00.000Z',
          clock_out_at: '2026-08-04T17:00:00.000Z', // 4h worked
        }),
      ],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({ effective_date: '2026-08-04', minutes: -240 }), // 4h leave
      ],
      approvedExpenses: [],
    });

    expect(built.entries).toEqual([
      { kind: 'worked', local_date: '2026-08-04', minutes: 240 },
    ]);
    expect(built.pto_usage).toEqual([
      { local_date: '2026-08-04', minutes: 240 },
    ]);
  });

  it('excludes PTO usage rows dated outside the week', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        // Week is [2026-08-03, 2026-08-09]. Both of these fall outside it.
        ptoLedgerRow({ effective_date: '2026-08-02', minutes: -60 }),
        ptoLedgerRow({ effective_date: '2026-08-10', minutes: -60 }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
  });

  // UPDATED by the Phase 3/4 review (BLOCKER 2). The original version of this
  // test pinned "adjustment rows never reach the engine" as correct for ALL
  // adjustment rows. It is correct only for FREE-STANDING ones (no
  // `time_off_id`): an accrual is a grant, and an untied adjustment is a
  // balance correction — neither is time taken. An adjustment that carries a
  // `time_off_id` is the reversal (or re-pricing) of THAT time off's usage
  // row, and excluding it made a cancelled-then-worked day pay twice.
  it('excludes accrual rows and FREE-STANDING adjustment rows — neither is time taken', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
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

  // ===========================================================================
  // PTO netting (Phase 3/4 review, BLOCKER 2) — the reversal must reach the
  // engine, or a cancelled-then-worked day prices BOTH a `pto` line and a
  // `regular` line for the same eight hours and freezes at approval.
  // ===========================================================================

  it('nets a FULL reversing adjustment against its usage row — a cancelled paid day prices no PTO at all', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'usage',
          minutes: -480,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'reversal',
          kind: 'adjustment',
          minutes: 480,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
  });

  it('nets a PARTIAL reversal to the REMAINDER — not to zero, and never negative', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'usage',
          minutes: -480,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'partial',
          kind: 'adjustment',
          minutes: 120, // 8h marked, corrected down to 6h
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([
      { local_date: '2026-08-03', minutes: 360 },
    ]);
  });

  it('nets an UPWARD adjustment too — a marking corrected 6h → 8h prices 8h', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'usage',
          minutes: -360,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'topup',
          kind: 'adjustment',
          minutes: -120,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([
      { local_date: '2026-08-03', minutes: 480 },
    ]);
  });

  it('an over-reversal clamps at zero — never negative PTO minutes', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'usage',
          minutes: -480,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'over',
          kind: 'adjustment',
          minutes: 600,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
  });

  it('nets PER time_off_id — one reversed booking never cancels another week-mate', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'usage-a',
          minutes: -480,
          effective_date: '2026-08-03',
          time_off_id: 'to-a',
        }),
        ptoLedgerRow({
          id: 'reversal-a',
          kind: 'adjustment',
          minutes: 480,
          effective_date: '2026-08-03',
          time_off_id: 'to-a',
        }),
        ptoLedgerRow({
          id: 'usage-b',
          minutes: -240,
          effective_date: '2026-08-05',
          time_off_id: 'to-b',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([
      { local_date: '2026-08-05', minutes: 240 },
    ]);
  });

  it('an adjustment dated OUTSIDE the week still nets its in-week usage row', () => {
    // A reversal written days later carries the usage row's effective_date in
    // practice, but a hand-written correction need not — the group is dated
    // by the USAGE row, so the netting cannot be dodged by the date.
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'usage',
          minutes: -480,
          effective_date: '2026-08-03',
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'late-reversal',
          kind: 'adjustment',
          minutes: 480,
          effective_date: '2026-08-20',
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
  });

  // ===========================================================================
  // Multi-day markings (Phase 3/4 review, finding 15b) — one `time_off_id`
  // now carries one usage row PER COVERED DAY, so the netting must stay
  // per-date. Collapsing a group onto one date is the very bug 15b fixes.
  // ===========================================================================

  it('prices only the days of a multi-day marking that fall INSIDE this week', () => {
    // A fortnight from Mon 2026-08-03: days 1-7 are this week, 8-14 the next.
    const rows = Array.from({ length: 14 }, (_, index) => {
      const day = 3 + index;
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      return ptoLedgerRow({
        id: `usage-${index}`,
        effective_date: date,
        minutes: -343,
        time_off_id: 'to-1',
      });
    });
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: rows,
      approvedExpenses: [],
    });
    const priced = built.pto_usage ?? [];
    expect(priced).toHaveLength(7);
    expect(priced.reduce((total, entry) => total + entry.minutes, 0)).toBe(
      343 * 7
    );
    expect(priced[0]).toEqual({
      local_date: '2026-08-03',
      minutes: 343,
    });
  });

  it('nets a per-DAY correction against ITS day, not across the whole marking', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'u1',
          effective_date: '2026-08-03',
          minutes: -480,
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'u2',
          effective_date: '2026-08-04',
          minutes: -480,
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'a1',
          kind: 'adjustment',
          effective_date: '2026-08-04',
          minutes: 120,
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([
      { local_date: '2026-08-03', minutes: 480 },
      { local_date: '2026-08-04', minutes: 360 },
    ]);
  });

  it('a fully reversed multi-day marking prices nothing on any day', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'u1',
          effective_date: '2026-08-03',
          minutes: -480,
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'u2',
          effective_date: '2026-08-04',
          minutes: -480,
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'a1',
          kind: 'adjustment',
          effective_date: '2026-08-03',
          minutes: 480,
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'a2',
          kind: 'adjustment',
          effective_date: '2026-08-04',
          minutes: 480,
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    expect(built.pto_usage).toEqual([]);
  });

  it('an out-of-week reversal still cancels the whole marking, spread across its days', () => {
    // A hand-written correction that does not match any usage date reduces
    // the marking as a whole rather than being ignored — the group's netted
    // total stays the unit of truth (docs/11-MONEY.md 5).
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'u1',
          effective_date: '2026-08-03',
          minutes: -480,
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'u2',
          effective_date: '2026-08-04',
          minutes: -480,
          time_off_id: 'to-1',
        }),
        ptoLedgerRow({
          id: 'late',
          kind: 'adjustment',
          effective_date: '2026-08-30',
          minutes: 480,
          time_off_id: 'to-1',
        }),
      ],
      approvedExpenses: [],
    });
    const priced = built.pto_usage ?? [];
    expect(priced.reduce((total, entry) => total + entry.minutes, 0)).toBe(480);
    expect(priced.map(entry => entry.local_date)).toEqual([
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('an adjustment whose usage row is not in the fetched set prices nothing on its own', () => {
    const built = buildWeekEarningsInput({
      weekStart: WEEK_START,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [
        ptoLedgerRow({
          id: 'orphan',
          kind: 'adjustment',
          minutes: -240,
          effective_date: '2026-08-04',
          time_off_id: 'to-elsewhere',
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
    const ptoRepo = makePtoRepo();
    const expenseRepo = makeExpenseRepo();
    const svc = makeWeekEarningsService({
      timeEntryRepo,
      arrangementRepo,
      ptoRepo,
      expenseRepo,
    });

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

  it('tops up the full guaranteed shortfall on a zero-hours week', async () => {
    const svc = makeWeekEarningsService({
      timeEntryRepo: makeTimeEntryRepo({
        listForCarerWeek: mock(async () => []),
      }),
      arrangementRepo: makeArrangementRepo({
        listForCarer: mock(async () => [
          arrangement({ guaranteed_minutes_per_week: 2400 }),
        ]),
      }),
    });

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.gross_minor).toBe(80_000);
    expect(
      result.status === 'ok' &&
        result.lines.some(line => line.kind === 'guaranteed_topup')
    ).toBe(true);
  });

  it('returns the typed no_arrangement arm when the carer has no pay terms', async () => {
    const svc = makeWeekEarningsService({
      arrangementRepo: makeArrangementRepo({
        listForCarer: mock(async () => []),
      }),
    });

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('no_arrangement');
  });

  // D-16/§7.4 (M1) — the seam payArrangementCommandService uses to compare
  // a week's gross under the OLD terms vs the NEW ones for the
  // backdated-reduction walk-away fix.
  describe('computeForWeekWithArrangements', () => {
    it('prices the SUPPLIED arrangements, never fetching the repo’s own history', async () => {
      const arrangementRepo = makeArrangementRepo();
      const svc = makeWeekEarningsService({ arrangementRepo });

      const result = await svc.computeForWeekWithArrangements(
        HOUSEHOLD_ID,
        CARER_ID,
        WEEK_START,
        [arrangement({ rate_minor: 2000 })]
      );

      expect(arrangementRepo.listForCarer).not.toHaveBeenCalled();
      expect(result.status).toBe('ok');
    });

    it('the same week prices differently under two different arrangement lists — the before/after comparison', async () => {
      const svc = makeWeekEarningsService();

      const before = await svc.computeForWeekWithArrangements(
        HOUSEHOLD_ID,
        CARER_ID,
        WEEK_START,
        [arrangement({ rate_minor: 2000 })]
      );
      const after = await svc.computeForWeekWithArrangements(
        HOUSEHOLD_ID,
        CARER_ID,
        WEEK_START,
        [arrangement({ rate_minor: 1000 })]
      );

      expect(before.status).toBe('ok');
      expect(after.status).toBe('ok');
      expect(before.status === 'ok' && after.status === 'ok').toBe(true);
      if (before.status === 'ok' && after.status === 'ok') {
        expect(after.gross_minor).toBeLessThan(before.gross_minor);
      }
    });
  });

  it('prices a plain worked week end to end', async () => {
    const svc = makeWeekEarningsService();

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    // 8h at £20.00 = £160.00.
    expect(result.status === 'ok' && result.gross_minor).toBe(16_000);
    expect(result.week_start).toBe(WEEK_START);
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
    const svc = makeWeekEarningsService({
      timeEntryRepo: makeTimeEntryRepo({
        listForCarerWeek: mock(async () => []),
      }),
      arrangementRepo: makeArrangementRepo({
        listForCarer: mock(async () => [
          arrangement({ valid_from: '2025-01-01' }),
        ]),
      }),
      ptoRepo,
    });

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
    const svc = makeWeekEarningsService({
      timeEntryRepo: makeTimeEntryRepo({
        listForCarerWeek: mock(async () => []),
      }),
      arrangementRepo: makeArrangementRepo(),
      expenseRepo,
    });

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
    const svc = makeWeekEarningsService({
      arrangementRepo: makeArrangementRepo(),
      ptoRepo,
      expenseRepo,
    });

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

  it('prices TWO time offs on the SAME date additively — netting is per time_off_id, so neither cancels the other', async () => {
    // The per-time_off_id netting vector above uses different DATES, so the
    // same-date collision was unpinned: two separate bookings (a half-day of
    // annual leave and a half-day of sick, say) both landing on Tuesday.
    // `netPtoUsage` groups by `time_off_id`, so each survives as its own
    // `pto_usage` row on the same date, and `sumMinutesByDate` then folds
    // them into ONE 360-minute line. 360 x 1850 = 666_000; /60 = 11_100
    // exactly (6h at £18.50). A netting bug that keyed on date instead would
    // pay 5_550 — half her leave, silently.
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [
        ptoLedgerRow({
          id: 'pto-a',
          time_off_id: 'to-a',
          effective_date: '2026-08-04',
          minutes: -180,
        }),
        ptoLedgerRow({
          id: 'pto-b',
          time_off_id: 'to-b',
          effective_date: '2026-08-04',
          minutes: -180,
        }),
      ]),
    });
    const svc = makeWeekEarningsService({
      timeEntryRepo: makeTimeEntryRepo({
        listForCarerWeek: mock(async () => []),
      }),
      arrangementRepo: makeArrangementRepo({
        listForCarer: mock(async () => [arrangement({ rate_minor: 1850 })]),
      }),
      ptoRepo,
    });

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.gross_minor).toBe(11_100);
    expect(result.status === 'ok' && result.payable_minutes).toBe(360);
    expect(
      result.status === 'ok' && result.lines.filter(line => line.kind === 'pto')
    ).toEqual([
      {
        kind: 'pto',
        minutes: 360,
        rate_minor: 1850,
        multiplier: null,
        amount_minor: 11_100,
        from_date: '2026-08-04',
        to_date: '2026-08-04',
        arrangement_id: uuid(1),
      },
    ]);
  });

  it('a week with real PTO usage suppresses a guaranteed top-up it now pays for on its own pto line — no double pay', async () => {
    // Guaranteed 40h/week with 2h of paid PTO and no worked time: payable is
    // 120 minutes, shortfall is 2280, and the top-up pays that remainder while
    // the PTO itself prices on its own line.
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [
        ptoLedgerRow({ effective_date: '2026-08-04', minutes: -120 }),
      ]),
    });
    const svc = makeWeekEarningsService({
      timeEntryRepo: makeTimeEntryRepo({
        listForCarerWeek: mock(async () => []),
      }),
      arrangementRepo: makeArrangementRepo({
        listForCarer: mock(async () => [
          arrangement({ guaranteed_minutes_per_week: 2400 }),
        ]),
      }),
      ptoRepo,
    });

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, WEEK_START);

    expect(result.status).toBe('ok');
    // pto: 2h * £20 = £40.00. topup: 38h * £20 = £760.00. gross = £800.00.
    expect(result.status === 'ok' && result.gross_minor).toBe(80_000);
  });
});

// =============================================================================
// Observed holidays — the household's toggles become this week's dates.
//
// The engine takes DATES, never holiday keys (see `observed_holidays`'s doc on
// `ComputeWeekEarningsInput`). This is the ONLY place the key-to-date rule is
// applied, and these cases are what stop it drifting: a toggle switched off
// must not price, a key this build cannot resolve must not price, and a week
// straddling New Year must resolve BOTH years or a worked Jan 1 silently loses
// its premium — the same trap the calendar-year PTO fetch documents.
// =============================================================================

/** Week Mon 2026-06-29 .. Sun 2026-07-05 — it contains 2026-07-04. */
const JULY_WEEK = '2026-06-29';

describe('buildWeekEarningsInput — observed holidays (3-E4)', () => {
  /** A `household_holidays` row (080), defaulting to observed. */
  function holidayRow(over: Record<string, unknown> = {}): any {
    return {
      id: 'hh1',
      household_id: HOUSEHOLD_ID,
      holiday_key: 'independence_day',
      observed: true,
      // Both serialisations across the fixtures (GOLDEN-FIXES #25).
      created_at: '2026-01-01T00:00:00+00:00',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...over,
    };
  }

  function build(householdHolidays: any[], weekStart = JULY_WEEK) {
    return buildWeekEarningsInput({
      weekStart,
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [],
      approvedExpenses: [],
      householdHolidays,
    });
  }

  it('resolves an observed key to its date in the week it falls in', () => {
    expect(build([holidayRow()]).observed_holidays).toEqual(['2026-07-04']);
  });

  it('drops a key the family switched OFF', () => {
    // The per-family toggle is the whole point of D-12; an `observed: false`
    // row that still priced would make the switch decorative.
    expect(build([holidayRow({ observed: false })]).observed_holidays).toEqual(
      []
    );
  });

  it('drops a key whose date falls outside this week', () => {
    expect(
      build([holidayRow({ holiday_key: 'christmas_day' })]).observed_holidays
    ).toEqual([]);
  });

  it('drops a key this build cannot resolve to a date', () => {
    // A row written by a newer server (a state holiday, a custom day) parses
    // on read — see `householdHoliday.schema.ts` — but this build has no rule
    // for it, and guessing a date would be inventing when a premium is owed.
    expect(
      build([holidayRow({ holiday_key: 'cesar_chavez_day' })]).observed_holidays
    ).toEqual([]);
  });

  it('resolves the NEXT year for a week that starts in December', () => {
    // Mon 2026-12-28 .. Sun 2027-01-03. The only holiday in it is New Year's
    // Day 2027, and resolving keys against the WEEK-START's year alone (2026)
    // would look up 2026-01-01, miss the week entirely, and silently leave a
    // worked Jan 1 with no premium. Christmas is in the payload and correctly
    // does NOT price — Dec 25 and Jan 1 are exactly seven days apart, so no
    // seven-day week can ever hold both.
    const built = buildWeekEarningsInput({
      weekStart: '2026-12-28',
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [],
      approvedExpenses: [],
      householdHolidays: [
        holidayRow({ holiday_key: 'christmas_day' }),
        holidayRow({ id: 'hh2', holiday_key: 'new_years_day' }),
      ],
    });
    expect(built.observed_holidays).toEqual(['2027-01-01']);
  });

  it('resolves the PREVIOUS year for the same span read from the other end', () => {
    // The mirror: Mon 2026-12-21 .. Sun 2026-12-27 holds Christmas 2026
    // (Friday the 25th) and not New Year. Together with the case above, the
    // pair pins that the resolver walks every year the week touches rather
    // than guessing one.
    const built = buildWeekEarningsInput({
      weekStart: '2026-12-21',
      entries: [],
      arrangements: [arrangement()],
      ptoLedgerRows: [],
      approvedExpenses: [],
      householdHolidays: [
        holidayRow({ holiday_key: 'christmas_day' }),
        holidayRow({ id: 'hh2', holiday_key: 'new_years_day' }),
      ],
    });
    expect(built.observed_holidays).toEqual(['2026-12-25']);
  });

  it('passes an empty list when the household has no rows at all', () => {
    // Absence means "nothing agreed" (080's header), never "all of them".
    expect(build([]).observed_holidays).toEqual([]);
    expect(
      buildWeekEarningsInput({
        weekStart: WEEK_START,
        entries: [],
        arrangements: [arrangement()],
        ptoLedgerRows: [],
        approvedExpenses: [],
      }).observed_holidays
    ).toEqual([]);
  });
});

describe('WeekEarningsService.computeForWeek — holiday fetch', () => {
  it('fetches this household’s holiday toggles and prices the premium', async () => {
    const holidayRepo = {
      listForHousehold: mock(async () => [
        {
          id: 'hh1',
          household_id: HOUSEHOLD_ID,
          holiday_key: 'independence_day',
          observed: true,
          created_at: '2026-01-01T00:00:00+00:00',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
    } as any;
    const svc = new WeekEarningsService(
      makeTimeEntryRepo({
        listForCarerWeek: mock(async () => [
          entry({
            local_date: '2026-07-04',
            clock_in_at: '2026-07-04T09:00:00.000Z',
            clock_out_at: '2026-07-04T17:00:00.000Z',
            break_minutes: 0,
          }),
        ]),
      }),
      makeArrangementRepo({
        listForCarer: mock(async () => [
          arrangement({
            rate_minor: 2000,
            overtime_threshold_minutes: 2400,
            worked_holiday_multiplier: 1.5,
          }),
        ]),
      }),
      makePtoRepo(),
      makeExpenseRepo(),
      holidayRepo
    );

    const result = await svc.computeForWeek(HOUSEHOLD_ID, CARER_ID, JULY_WEEK);

    // Household-scoped only — the calendar belongs to the family, not to one
    // carer, so there is no carer argument to get wrong here.
    expect(holidayRepo.listForHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(result.status).toBe('ok');
    // 8h at £20 = £160.00 regular, plus the £10.00/h uplift x 8h = £80.00.
    expect(result.status === 'ok' && result.gross_minor).toBe(24_000);
    expect(
      result.status === 'ok' &&
        result.lines.some(line => line.kind === 'holiday_premium')
    ).toBe(true);
  });
});
