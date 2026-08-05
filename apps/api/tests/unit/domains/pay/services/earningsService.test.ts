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

function pto(local_date: string, minutes: number) {
  return { local_date, minutes };
}

function expense(local_date: string, amount_minor: number, currency = 'GBP') {
  return { local_date, amount_minor, currency };
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

  describe('pto', () => {
    it('prices a dated PTO day at the week’s single effective rate', () => {
      const result = ok(
        computeWeekEarnings(input({ pto_usage: [pto(WED, 240)] }))
      );

      expect(result.lines).toEqual([
        {
          kind: 'pto',
          minutes: 240,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 7400,
          from_date: WED,
          to_date: WED,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(7400);
      expect(result.worked_minutes).toBe(0);
      expect(result.payable_minutes).toBe(240);
    });

    it('prices PTO per-day across a mid-week rate change, one line per rate', () => {
      const raise = [
        arrangement(),
        arrangement({
          id: ARR_ID_B,
          rate_minor: 1950,
          valid_from: WED,
          created_at: '2026-08-01T09:00:00.000Z',
        }),
      ];

      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: raise,
            pto_usage: [pto(TUE, 120), pto(WED, 120)],
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'pto',
          minutes: 120,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 3700,
          from_date: TUE,
          to_date: TUE,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'pto',
          minutes: 120,
          rate_minor: 1950,
          multiplier: null,
          amount_minor: 3900,
          from_date: WED,
          to_date: WED,
          arrangement_id: ARR_ID_B,
        },
      ]);
      expect(result.gross_minor).toBe(7600);
      expect(result.payable_minutes).toBe(240);
    });

    it('sums PTO and worked minutes correctly in gross', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [worked(MON, 480)],
            pto_usage: [pto(TUE, 480)],
          })
        )
      );

      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 480],
        ['pto', 480],
      ]);
      expect(result.worked_minutes).toBe(480);
      expect(result.payable_minutes).toBe(960);
      expect(result.gross_minor).toBe(29600);
    });

    it('PTO suppresses a guaranteed top-up while ALSO paying its own line — the hazard case', () => {
      // Without the pto line, payable_minutes would have been 1920 (worked
      // only), the closure-day shortfall would be 480, and the topup would
      // pay it. WITH the pto line, the same 480 PTO minutes count toward
      // payable_minutes (suppressing the topup to zero) AND are themselves
      // paid on a `pto` line — no double pay, and no more "suppresses
      // without paying."
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              arrangement({
                overtime_threshold_minutes: null,
                guaranteed_minutes_per_week: 2400,
              }),
            ],
            entries: [MON, TUE, WED, THU].map(d => worked(d, 480)),
            pto_usage: [pto(FRI, 480)],
            closure_dates: [FRI],
            closure_day_shifts: [closureShift(FRI, 480)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular', 'pto']);
      const ptoLine = result.lines.find(l => l.kind === 'pto');
      expect(ptoLine?.minutes).toBe(480);
      expect(ptoLine?.amount_minor).toBe(14800);
      expect(result.payable_minutes).toBe(2400);
      expect(result.gross_minor).toBe(74000);
    });

    it('returns the no_arrangement arm for a PTO day with no effective arrangement', () => {
      const result = computeWeekEarnings(
        input({ arrangements: [], pto_usage: [pto(MON, 240)] })
      );

      expect(result).toEqual({
        status: 'no_arrangement',
        week_start: WEEK_START,
        unpriced_dates: [MON, SUN],
      });
    });

    describe('the deprecated undated pto_usage_minutes fallback', () => {
      it('stays a no-op at zero — the existing caller’s hard-zero is unaffected', () => {
        const result = ok(
          computeWeekEarnings(
            input({
              entries: [worked(MON, 480)],
              pto_usage_minutes: 0,
            })
          )
        );

        expect(result.lines.map(l => l.kind)).toEqual(['regular']);
        expect(result.payable_minutes).toBe(480);
      });

      it('prices a non-zero legacy count as ONE week-spanning line at the last day’s rate', () => {
        const raise = [
          arrangement(),
          arrangement({
            id: ARR_ID_B,
            rate_minor: 1950,
            valid_from: WED,
            created_at: '2026-08-01T09:00:00.000Z',
          }),
        ];

        const result = ok(
          computeWeekEarnings(
            input({ arrangements: raise, pto_usage_minutes: 120 })
          )
        );

        expect(result.lines).toEqual([
          {
            kind: 'pto',
            minutes: 120,
            rate_minor: 1950,
            multiplier: null,
            amount_minor: 3900,
            from_date: WEEK_START,
            to_date: SUN,
            arrangement_id: ARR_ID_B,
          },
        ]);
        expect(result.payable_minutes).toBe(120);
      });

      it('is ignored whenever pto_usage is provided, even as an empty array', () => {
        const result = ok(
          computeWeekEarnings(input({ pto_usage: [], pto_usage_minutes: 480 }))
        );

        expect(result.lines).toEqual([]);
        expect(result.payable_minutes).toBe(0);
      });
    });

    it('emits a pto line the shared wire schema accepts', () => {
      const result = computeWeekEarnings(input({ pto_usage: [pto(MON, 240)] }));
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('reimbursements', () => {
    it('renders alongside a zero-hours week — gross 0, reimbursements > 0, both present', () => {
      const result = ok(
        computeWeekEarnings(input({ reimbursements: [expense(WED, 3480)] }))
      );

      expect(result.lines).toEqual([
        {
          kind: 'reimbursements',
          minutes: 0,
          rate_minor: 0,
          multiplier: null,
          amount_minor: 3480,
          from_date: WED,
          to_date: WED,
          arrangement_id: null,
        },
      ]);
      expect(result.gross_minor).toBe(0);
      expect(result.reimbursements_minor).toBe(3480);
      expect(result.worked_minutes).toBe(0);
      expect(result.payable_minutes).toBe(0);
    });

    it('never counts toward the overtime threshold — a week just under threshold stays out of overtime', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 470)), // 2350 < 2400 threshold
            reimbursements: [expense(FRI, 100000)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual([
        'regular',
        'reimbursements',
      ]);
      expect(result.worked_minutes).toBe(2350);
      expect(result.payable_minutes).toBe(2350);
      const regularLine = result.lines.find(l => l.kind === 'regular');
      if (!regularLine) {
        throw new Error('expected a regular line');
      }
      expect(result.gross_minor).toBe(regularLine.amount_minor);
      expect(result.reimbursements_minor).toBe(100000);
    });

    it('is excluded from gross — gross equals the wage lines only', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [worked(MON, 480)],
            reimbursements: [expense(MON, 5000)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual([
        'regular',
        'reimbursements',
      ]);
      expect(result.gross_minor).toBe(14800); // NOT 19800
      expect(result.reimbursements_minor).toBe(5000);
    });

    it('gross still equals the sum of the wage lines when overtime, and reimbursements, all coexist', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [
              ...[MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
              worked(SAT, 240),
            ],
            reimbursements: [expense(SUN, 2500)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual([
        'regular',
        'overtime',
        'reimbursements',
      ]);
      const wageTotal = result.lines
        .filter(l => l.kind !== 'reimbursements')
        .reduce((sum, l) => sum + l.amount_minor, 0);
      expect(result.gross_minor).toBe(wageTotal);
      expect(result.gross_minor).toBe(85100);
      expect(result.reimbursements_minor).toBe(2500);
    });

    it('returns the currency_change arm rather than silently summing a mismatched expense currency', () => {
      const result = computeWeekEarnings(
        input({
          entries: [worked(MON, 480)],
          reimbursements: [expense(MON, 5000, 'EUR')],
        })
      );

      expect(result).toEqual({
        status: 'currency_change',
        week_start: WEEK_START,
        currencies: ['GBP', 'EUR'],
      });
    });

    it('ignores an approved expense dated outside the week, same convention as closure_dates', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [worked(MON, 480)],
            reimbursements: [expense('2026-07-31', 999)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular']);
      expect(result.reimbursements_minor).toBe(0);
    });

    it('sorts reimbursement lines chronologically regardless of input order', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            reimbursements: [expense(FRI, 100), expense(MON, 200)],
          })
        )
      );

      expect(result.lines.map(l => l.from_date)).toEqual([MON, FRI]);
    });

    it('emits a reimbursements line the shared wire schema accepts', () => {
      const result = computeWeekEarnings(
        input({ reimbursements: [expense(MON, 100)] })
      );
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

// =============================================================================
// The overtime rate is money, so it is rounded in INTEGERS (Phase 2 review,
// finding 2 / `docs/11-MONEY.md` §1).
//
// `Math.floor(rate_minor * multiplier + 0.5)` looks like half-up and is not:
// `multiplier` is a `numeric(3,2)` that almost never has an exact binary
// form, so the product lands a hair BELOW its exact decimal value and the
// half-up step silently truncates. Verified exhaustively over
// rate_minor 1..20000 x multiplier 1.00..9.99: 16,337 (rate, multiplier)
// pairs round low, and NOT ONE rounds high — every error is a penny off the
// nanny's hourly overtime rate, in the same direction, forever.
//
// The week below is built so the arithmetic is impossible to misread: the
// threshold is 60 minutes and exactly 120 are worked, so there are exactly 60
// overtime minutes and `amount_minor === rate_minor` for the overtime line.
// =============================================================================

/** The overtime line of a week with exactly 60 overtime minutes at `rate`x`multiplier`. */
function overtimeLineFor(rate_minor: number, overtime_multiplier: number) {
  const result = ok(
    computeWeekEarnings(
      input({
        entries: [worked(MON, 120)],
        arrangements: [
          arrangement({
            rate_minor,
            overtime_multiplier,
            overtime_threshold_minutes: 60,
          }),
        ],
      })
    )
  );
  const line = result.lines.find(l => l.kind === 'overtime');
  if (!line) {
    throw new Error('expected an overtime line');
  }
  return line;
}

describe('earningsService — the overtime rate rounds half-up in integers', () => {
  // Each row: [rate_minor, multiplier, the exact half-up minor amount].
  // Every one of these has an EXACT decimal product ending in .5 — the case
  // half-up exists for — and every one is priced a penny low by the float
  // form.
  const cases: ReadonlyArray<readonly [number, number, number]> = [
    [1290, 1.15, 1484], // 12.90 x 1.15 = 14.835 -> 1483.5 minor
    [1250, 1.13, 1413], // 12.50 x 1.13 = 14.125 -> 1412.5 minor
    [1075, 1.38, 1484], // 10.75 x 1.38 = 14.835 -> 1483.5 minor
    [850, 2.05, 1743], //   8.50 x 2.05 = 17.425 -> 1742.5 minor
  ];

  for (const [rate_minor, multiplier, expected] of cases) {
    it(`prices ${rate_minor} x ${multiplier} as ${expected} minor, not ${expected - 1}`, () => {
      const line = overtimeLineFor(rate_minor, multiplier);
      expect(line.rate_minor).toBe(expected);
      // 60 overtime minutes at an hourly rate IS that rate, so the amount
      // pins the same defect a second way — a wrong rate cannot hide behind
      // a coincidentally-right total.
      expect(line.amount_minor).toBe(expected);
    });
  }

  it('is unchanged where the float form already happened to be right', () => {
    // 1230 x 1.15: the exact product is 1414.5 and the double rounds to
    // exactly 1414.5 too (the representation error is under half an ulp at
    // this magnitude), so this case was never wrong. Pinned so the integer
    // rewrite is proved to be a fix, not a different answer.
    expect(overtimeLineFor(1230, 1.15).rate_minor).toBe(1415);
    // No fractional part at all — the boring majority of real arrangements.
    expect(overtimeLineFor(1850, 1.5).rate_minor).toBe(2775);
    expect(overtimeLineFor(1850, 1.25).rate_minor).toBe(2313); // 2312.5 -> up
  });

  it('rounds a strictly-below-half product DOWN — half-up, not always-up', () => {
    // 1000 x 1.234 is impossible (numeric(3,2)); 1010 x 1.02 = 1030.2.
    expect(overtimeLineFor(1010, 1.02).rate_minor).toBe(1030);
  });
});
