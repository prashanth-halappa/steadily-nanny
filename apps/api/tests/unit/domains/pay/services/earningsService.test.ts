/**
 * The earnings engine case table (TIER0-PLAN.md Phase 2).
 *
 * Every row of the plan's case table is a test here. The engine is pure, so
 * there is no mocking, no `mock.module()`, and no dynamic import: plain data
 * in, a `WeekEarnings` out.
 *
 * The week under test is always Mon 2026-08-03 .. Sun 2026-08-09.
 */
import { describe, expect, it } from 'bun:test';
import { WeekEarningsSchema } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  type ComputeWeekEarningsInput,
  computeWeekEarnings,
} from '../../../../../src/domains/pay/services/earningsService';
import type { PayArrangement } from '../../../../../src/domains/pay/types';

const WEEK_START = '2026-08-03'; // Monday
const MON = '2026-08-03';
const TUE = '2026-08-04';
const WED = '2026-08-05';
const THU = '2026-08-06';
const FRI = '2026-08-07';
const SAT = '2026-08-08';
const SUN = '2026-08-09';

/** Distinct, schema-valid uuids so engine output can be parsed by the wire schema. */
function uuid(n: number): string {
  return `11111111-1111-4111-8111-1111111111${String(n).padStart(2, '0')}`;
}

const ARR_ID_A = uuid(1);
const ARR_ID_B = uuid(2);
const ARR_ID_C = uuid(3);

function arrangement(over: Partial<PayArrangement> = {}): PayArrangement {
  return {
    id: ARR_ID_A,
    household_id: uuid(90),
    carer_id: uuid(91),
    rate_minor: 1850,
    bill_rate_minor: null,
    currency: 'GBP',
    overtime_threshold_minutes: 2400,
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

function worked(local_date: string, minutes: number) {
  return { kind: 'worked' as const, local_date, minutes };
}

function adjustment(local_date: string, minutes: number) {
  return { kind: 'manual_adjustment' as const, local_date, minutes };
}

function cancelled(local_date: string, minutes: number) {
  return { kind: 'cancellation_paid' as const, local_date, minutes };
}

function closureShift(
  local_date: string,
  scheduled_minutes: number,
  became_payable = false
) {
  return { local_date, scheduled_minutes, became_payable };
}

function input(
  over: Partial<ComputeWeekEarningsInput>
): ComputeWeekEarningsInput {
  return {
    week_start: WEEK_START,
    entries: [],
    arrangements: [arrangement()],
    closure_dates: [],
    closure_day_shifts: [],
    ...over,
  };
}

/** Narrow to the ok arm, failing loudly (not silently zeroing) if it is not. */
function ok(result: ReturnType<typeof computeWeekEarnings>) {
  if (result.status !== 'ok') {
    throw new Error(`expected the ok arm, got "${result.status}"`);
  }
  return result;
}

describe('earningsService.computeWeekEarnings', () => {
  describe('plain week, single rate', () => {
    it('prices 40h at one rate as a single regular line spanning Mon-Fri', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 2400,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 74000,
          from_date: MON,
          to_date: FRI,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(74000);
      expect(result.worked_minutes).toBe(2400);
      expect(result.payable_minutes).toBe(2400);
      expect(result.currency).toBe('GBP');
    });

    it('counts manual_adjustment as worked minutes', () => {
      const result = ok(
        computeWeekEarnings(
          input({ entries: [worked(MON, 420), adjustment(MON, 60)] })
        )
      );

      expect(result.worked_minutes).toBe(480);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.kind).toBe('regular');
      expect(result.lines[0]?.amount_minor).toBe(14800);
    });

    it('emits output the shared wire schema accepts', () => {
      const result = computeWeekEarnings(
        input({ entries: [worked(MON, 480)] })
      );
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('mid-week raise', () => {
    const raise = [
      arrangement(),
      arrangement({
        id: ARR_ID_B,
        rate_minor: 1950,
        valid_from: WED,
        created_at: '2026-08-01T09:00:00.000Z',
      }),
    ];

    it('splits regular into one line per rate, each carrying its own date span', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: raise,
            entries: [MON, TUE, WED, THU].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 960,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 29600,
          from_date: MON,
          to_date: TUE,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'regular',
          minutes: 960,
          rate_minor: 1950,
          multiplier: null,
          amount_minor: 31200,
          from_date: WED,
          to_date: THU,
          arrangement_id: ARR_ID_B,
        },
      ]);
      expect(result.gross_minor).toBe(60800);
    });

    it('resolves the rate by created_at desc when two rows share a valid_from (the same-day typo correction)', () => {
      const typo = arrangement({
        id: ARR_ID_B,
        rate_minor: 1000,
        valid_from: WED,
        created_at: '2026-08-05T09:00:00.000Z',
      });
      const correction = arrangement({
        id: ARR_ID_C,
        rate_minor: 1950,
        valid_from: WED,
        created_at: '2026-08-05T10:00:00.000Z',
      });

      // Deliberately unsorted input: the engine resolves, the caller does not.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [correction, arrangement(), typo],
            entries: [worked(WED, 480)],
          })
        )
      );

      expect(result.lines[0]?.rate_minor).toBe(1950);
      expect(result.lines[0]?.arrangement_id).toBe(ARR_ID_C);
    });

    it('prices an overnight entry wholly at its clock-in date rate, even across a rate-change midnight', () => {
      // The 017 trigger files an overnight entry under its clock-in
      // local_date, so a Tue 20:00 -> Wed 06:00 span is a Tuesday entry and
      // never sees Wednesday's new rate.
      const result = ok(
        computeWeekEarnings(
          input({ arrangements: raise, entries: [worked(TUE, 600)] })
        )
      );

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.rate_minor).toBe(1850);
      expect(result.lines[0]?.amount_minor).toBe(18500);
      expect(result.lines[0]?.from_date).toBe(TUE);
      expect(result.lines[0]?.to_date).toBe(TUE);
    });
  });

  describe('overtime', () => {
    it('splits worked minutes at the weekly threshold and prices the excess at rate x multiplier', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [
              ...[MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
              worked(SAT, 240),
            ],
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 2400,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 74000,
          from_date: MON,
          to_date: FRI,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'overtime',
          minutes: 240,
          rate_minor: 2775,
          multiplier: 1.5,
          amount_minor: 11100,
          from_date: SAT,
          to_date: SAT,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(85100);
    });

    it('takes the threshold and multiplier from the arrangement effective on the LAST WORKED day', () => {
      // Mon-Tue are under the old 40h/1.5x terms; Wed's arrangement moves to
      // 30h/2x. The last worked day is Friday, so the NEW terms govern the
      // whole week: under the old 2400 threshold there would be no overtime
      // at all, which is what makes this test pin the rule.
      const arrangements = [
        arrangement(),
        arrangement({
          id: ARR_ID_C,
          rate_minor: 1950,
          overtime_threshold_minutes: 1800,
          overtime_multiplier: 2,
          valid_from: WED,
          created_at: '2026-08-01T09:00:00.000Z',
        }),
      ];

      const result = ok(
        computeWeekEarnings(
          input({
            arrangements,
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 960,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 29600,
          from_date: MON,
          to_date: TUE,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'regular',
          minutes: 840,
          rate_minor: 1950,
          multiplier: null,
          amount_minor: 27300,
          from_date: WED,
          to_date: THU,
          arrangement_id: ARR_ID_C,
        },
        {
          kind: 'overtime',
          minutes: 600,
          rate_minor: 3900,
          multiplier: 2,
          amount_minor: 39000,
          from_date: THU,
          to_date: FRI,
          arrangement_id: ARR_ID_C,
        },
      ]);
      expect(result.gross_minor).toBe(95900);
    });

    it('never pays overtime when the arrangement has no threshold', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [arrangement({ overtime_threshold_minutes: null })],
            entries: [MON, TUE, WED, THU, FRI, SAT].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular']);
      expect(result.lines[0]?.minutes).toBe(2880);
    });
  });

  describe('cancellation_paid', () => {
    it('prices cancellation_paid entries at their entry-date rate on their own line', () => {
      const result = ok(
        computeWeekEarnings(
          input({ entries: [worked(MON, 480), cancelled(WED, 240)] })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 480,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 14800,
          from_date: MON,
          to_date: MON,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'cancellation_paid',
          minutes: 240,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 7400,
          from_date: WED,
          to_date: WED,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(22200);
      expect(result.worked_minutes).toBe(480);
      expect(result.payable_minutes).toBe(720);
    });

    it('never lets cancellation_paid push the week into overtime', () => {
      // Overtime compensates work actually done (TIER0-PLAN.md Phase 2).
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [arrangement({ overtime_threshold_minutes: 600 })],
            entries: [worked(MON, 480), cancelled(WED, 240)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual([
        'regular',
        'cancellation_paid',
      ]);
    });
  });

  describe('guaranteed top-up — closure days only', () => {
    const guaranteed = (minutes: number) =>
      arrangement({
        overtime_threshold_minutes: null,
        guaranteed_minutes_per_week: minutes,
      });

    it('pays a full-closure zero-hours week as a topup-only breakdown', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            closure_dates: [MON, TUE, WED, THU, FRI],
            closure_day_shifts: [MON, TUE, WED, THU, FRI].map(d =>
              closureShift(d, 480)
            ),
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'guaranteed_topup',
          minutes: 2400,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 74000,
          from_date: MON,
          to_date: SUN,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(74000);
      expect(result.worked_minutes).toBe(0);
      expect(result.guaranteed_minutes_per_week).toBe(2400);
    });

    it('excludes closure-day shifts already paid as cancellation_paid — no double pay', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [
              ...[MON, TUE, WED, THU].map(d => worked(d, 480)),
              cancelled(FRI, 240),
            ],
            closure_dates: [FRI],
            closure_day_shifts: [
              closureShift(FRI, 240, true),
              closureShift(FRI, 240, false),
            ],
          })
        )
      );

      expect(result.payable_minutes).toBe(2160);
      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 1920],
        ['cancellation_paid', 240],
        ['guaranteed_topup', 240],
      ]);
      // 40h at £18.50 exactly — the paid cancellation reduced the topup
      // rather than stacking on top of it.
      expect(result.gross_minor).toBe(74000);
    });

    it('contributes nothing for a closure day with no materialized shifts', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [MON, TUE, WED, THU].map(d => worked(d, 480)),
            closure_dates: [FRI],
            closure_day_shifts: [],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular']);
      expect(result.gross_minor).toBe(59200);
    });

    it('caps the topup at closure-day lost minutes when the shortfall is larger', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [MON, TUE, WED].map(d => worked(d, 480)),
            closure_dates: [THU],
            closure_day_shifts: [closureShift(THU, 480)],
          })
        )
      );

      // Shortfall is 960 minutes; only 480 were lost to the closure.
      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 1440],
        ['guaranteed_topup', 480],
      ]);
      expect(result.gross_minor).toBe(59200);
    });

    it('pays only the shortfall when closure-day lost minutes exceed it', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(1800)],
            entries: [MON, TUE, WED].map(d => worked(d, 480)),
            closure_dates: [THU, FRI],
            closure_day_shifts: [
              closureShift(THU, 480),
              closureShift(FRI, 480),
            ],
          })
        )
      );

      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 1440],
        ['guaranteed_topup', 360],
      ]);
      expect(result.gross_minor).toBe(55500);
    });

    it('never tops up a shortfall with no closure days, whatever its size', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [MON, TUE, WED].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular']);
      expect(result.gross_minor).toBe(44400);
    });

    it('lets overtime and a topup coexist — overtime Mon-Thu, closure Friday', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              arrangement({
                overtime_threshold_minutes: 1200,
                guaranteed_minutes_per_week: 2400,
              }),
            ],
            entries: [MON, TUE, WED, THU].map(d => worked(d, 450)),
            closure_dates: [FRI],
            closure_day_shifts: [closureShift(FRI, 480)],
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 1200,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 37000,
          from_date: MON,
          to_date: WED,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'overtime',
          minutes: 600,
          rate_minor: 2775,
          multiplier: 1.5,
          amount_minor: 27750,
          from_date: WED,
          to_date: THU,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'guaranteed_topup',
          minutes: 480,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 14800,
          from_date: MON,
          to_date: SUN,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(79550);
    });

    it('ignores shifts on days that are not closure days', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [MON, TUE, WED].map(d => worked(d, 480)),
            closure_dates: [THU],
            closure_day_shifts: [closureShift(THU, 60), closureShift(FRI, 480)],
          })
        )
      );

      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 1440],
        ['guaranteed_topup', 60],
      ]);
    });

    it('never tops up when the arrangement sets no guaranteed minutes', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [worked(MON, 480)],
            closure_dates: [FRI],
            closure_day_shifts: [closureShift(FRI, 480)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular']);
    });
  });

  describe('no arrangement', () => {
    it('returns the no_arrangement arm rather than zeros when no arrangement exists at all', () => {
      const result = computeWeekEarnings(
        input({ arrangements: [], entries: [worked(MON, 480)] })
      );

      expect(result).toEqual({
        status: 'no_arrangement',
        week_start: WEEK_START,
        unpriced_dates: [MON, SUN],
      });
    });

    it('returns the no_arrangement arm for the WHOLE week when only some days are covered', () => {
      // Never partial zeros: a week half-priced is a wrong number, not a
      // partial one.
      const result = computeWeekEarnings(
        input({
          arrangements: [arrangement({ valid_from: WED })],
          entries: [worked(MON, 480), worked(WED, 480)],
        })
      );

      expect(result).toEqual({
        status: 'no_arrangement',
        week_start: WEEK_START,
        unpriced_dates: [MON],
      });
    });

    it('emits a no_arrangement arm the shared wire schema accepts', () => {
      const result = computeWeekEarnings(input({ arrangements: [] }));
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('currency change', () => {
    it('returns the currency_change arm with no numbers when the week spans two currencies', () => {
      const result = computeWeekEarnings(
        input({
          arrangements: [
            arrangement(),
            arrangement({
              id: ARR_ID_B,
              currency: 'EUR',
              rate_minor: 1900,
              valid_from: WED,
              created_at: '2026-08-01T09:00:00.000Z',
            }),
          ],
          entries: [worked(MON, 480), worked(WED, 480)],
        })
      );

      expect(result).toEqual({
        status: 'currency_change',
        week_start: WEEK_START,
        currencies: ['GBP', 'EUR'],
      });
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('zero-everything week', () => {
    it('is a valid, empty ok result — not no_arrangement — when an arrangement exists', () => {
      const result = ok(computeWeekEarnings(input({})));

      expect(result).toEqual({
        status: 'ok',
        week_start: WEEK_START,
        currency: 'GBP',
        lines: [],
        gross_minor: 0,
        reimbursements_minor: 0,
        worked_minutes: 0,
        payable_minutes: 0,
        guaranteed_minutes_per_week: null,
      });
    });
  });

  describe('rounding', () => {
    it('rounds half-up once, at the final multiplication', () => {
      // 50 min x 1851p / 60 = 1542.5p exactly. Half-up -> 1543, never 1542.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [arrangement({ rate_minor: 1851 })],
            entries: [worked(MON, 50)],
          })
        )
      );

      expect(result.lines[0]?.amount_minor).toBe(1543);
      expect(result.gross_minor).toBe(1543);
    });

    it('rounds the overtime rate half-up before pricing, so the displayed rate reproduces the amount', () => {
      // 1851p x 1.5 = 2776.5p -> 2777p. 60 min at 2777p = 2777p.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              arrangement({ rate_minor: 1851, overtime_threshold_minutes: 60 }),
            ],
            entries: [worked(MON, 120)],
          })
        )
      );

      const overtime = result.lines.find(l => l.kind === 'overtime');
      expect(overtime?.rate_minor).toBe(2777);
      expect(overtime?.amount_minor).toBe(2777);
    });

    it('makes the total the sum of the rounded lines for a messy week', () => {
      const arrangements = [
        arrangement({
          rate_minor: 1851,
          overtime_threshold_minutes: 1200,
          guaranteed_minutes_per_week: 2400,
        }),
        arrangement({
          id: ARR_ID_B,
          rate_minor: 1957,
          overtime_threshold_minutes: 1200,
          guaranteed_minutes_per_week: 2400,
          valid_from: THU,
          created_at: '2026-08-01T09:00:00.000Z',
        }),
      ];

      const result = ok(
        computeWeekEarnings(
          input({
            arrangements,
            entries: [
              ...[MON, TUE, WED, THU].map(d => worked(d, 455)),
              cancelled(FRI, 200),
            ],
            closure_dates: [SAT],
            closure_day_shifts: [closureShift(SAT, 300)],
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 1200,
          rate_minor: 1851,
          multiplier: null,
          amount_minor: 37020,
          from_date: MON,
          to_date: WED,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'overtime',
          minutes: 165,
          rate_minor: 2777,
          multiplier: 1.5,
          amount_minor: 7637,
          from_date: WED,
          to_date: WED,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'overtime',
          minutes: 455,
          rate_minor: 2936,
          multiplier: 1.5,
          amount_minor: 22265,
          from_date: THU,
          to_date: THU,
          arrangement_id: ARR_ID_B,
        },
        {
          kind: 'cancellation_paid',
          minutes: 200,
          rate_minor: 1957,
          multiplier: null,
          amount_minor: 6523,
          from_date: FRI,
          to_date: FRI,
          arrangement_id: ARR_ID_B,
        },
        {
          kind: 'guaranteed_topup',
          minutes: 300,
          rate_minor: 1957,
          multiplier: null,
          amount_minor: 9785,
          from_date: MON,
          to_date: SUN,
          arrangement_id: ARR_ID_B,
        },
      ]);

      const summed = result.lines.reduce((t, l) => t + l.amount_minor, 0);
      expect(result.gross_minor).toBe(summed);
      expect(result.gross_minor).toBe(83230);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });
  });
});
