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
    // 065: null = these terms are still live (set only on member removal).
    valid_to: null,
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

  describe('guaranteed top-up — weekly shortfall, unconditional', () => {
    const guaranteed = (minutes: number) =>
      arrangement({
        overtime_threshold_minutes: null,
        guaranteed_minutes_per_week: minutes,
      });

    it('pays a zero-hours week as a topup-only breakdown when payable minutes are below the guarantee', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
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

    it('tops up the full shortfall when payable minutes fall short with no closure days', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [MON, TUE, WED].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 1440],
        ['guaranteed_topup', 960],
      ]);
      expect(result.gross_minor).toBe(74_000);
    });

    it('emits no top-up when payable minutes meet the guarantee', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular']);
      expect(result.gross_minor).toBe(74_000);
    });

    it('tops up only the remaining shortfall when paid cancellation minutes count toward payable', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(2400)],
            entries: [
              ...[MON, TUE, WED, THU].map(d => worked(d, 480)),
              cancelled(FRI, 240),
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
      expect(result.gross_minor).toBe(74_000);
    });

    it('tops up only the shortfall when payable minutes are partway to the guarantee', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [guaranteed(1800)],
            entries: [MON, TUE, WED].map(d => worked(d, 480)),
          })
        )
      );

      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 1440],
        ['guaranteed_topup', 360],
      ]);
      expect(result.gross_minor).toBe(55_500);
    });

    it('lets overtime and a topup coexist on an under-guarantee week', () => {
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
          minutes: 600,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 18500,
          from_date: MON,
          to_date: SUN,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(83_250);
    });

    it('never tops up when the arrangement sets no guaranteed minutes', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [worked(MON, 480)],
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

    it('prices worked minutes AND PTO on the SAME local_date — additively, never one instead of the other (F-B10-5)', () => {
      // The half-day case: four hours of booked leave, then she comes in for
      // the afternoon anyway (or the morning was leave and the shift moved).
      // Both are owed, and the engine keeps them in SEPARATE buckets —
      // `sumByDate(entries, WORKED_KINDS)` and `sumMinutesByDate(pto_usage)`
      // never see each other — so a shared date cannot make one swallow the
      // other. The same-date collision is the whole point: every other pto
      // test above puts the leave on a different day from the work.
      //
      // Hand-computed, rule I-15 `priceMinutes(m, r) = floor((2mr + 60) / 120)`:
      //   regular 480 @ 1850 -> (2*480*1850 + 60)/120 = 1_776_060/120
      //                       = 14_800.5 -> floor 14_800   (8h x £18.50)
      //   pto     240 @ 1850 -> (2*240*1850 + 60)/120 =   888_060/120
      //                       =  7_400.5 -> floor  7_400   (4h x £18.50)
      //   gross = 14_800 + 7_400 = 22_200
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [worked(MON, 480)],
            pto_usage: [pto(MON, 240)],
          })
        )
      );

      expect(result.lines).toEqual([
        {
          kind: 'regular',
          minutes: 480,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 14_800,
          from_date: MON,
          to_date: MON,
          arrangement_id: ARR_ID_A,
        },
        {
          kind: 'pto',
          minutes: 240,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 7400,
          from_date: MON,
          to_date: MON,
          arrangement_id: ARR_ID_A,
        },
      ]);
      expect(result.gross_minor).toBe(22_200);
      // PTO minutes are payable but NOT worked — they must never inflate
      // `worked_minutes` (which is what the overtime split consumes).
      expect(result.worked_minutes).toBe(480);
      expect(result.payable_minutes).toBe(720);
    });

    it('never counts same-date PTO toward the overtime threshold — only worked minutes do (F-B10-5)', () => {
      // 2400 worked minutes sits exactly ON the default threshold, so nothing
      // is overtime. Adding 480 PTO minutes on the last worked day pushes
      // `payable_minutes` to 2880 — and must still produce no overtime line,
      // because the split reads `workedByDate` alone. If PTO ever leaked into
      // that bucket, this week would pay 480 minutes at 1.5x it does not owe.
      const result = ok(
        computeWeekEarnings(
          input({
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
            pto_usage: [pto(FRI, 480)],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular', 'pto']);
      expect(result.worked_minutes).toBe(2400);
      expect(result.payable_minutes).toBe(2880);
      // 2400 @ 1850 = 74_000, plus 480 @ 1850 = 14_800.
      expect(result.gross_minor).toBe(88_800);
    });

    it('PTO suppresses a guaranteed top-up while ALSO paying its own line — the hazard case', () => {
      // Without the pto line, payable_minutes would have been 1920 (worked
      // only), the shortfall would be 480, and the topup would pay it. WITH
      // the pto line, the same 480 PTO minutes count toward payable_minutes
      // (suppressing the topup to zero) AND are themselves paid on a `pto`
      // line — no double pay, and no more "suppresses without paying."
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

    it('ignores an approved expense dated outside the week', () => {
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
          minutes: 380,
          rate_minor: 1957,
          multiplier: null,
          amount_minor: 12_394,
          from_date: MON,
          to_date: SUN,
          arrangement_id: ARR_ID_B,
        },
      ]);

      const summed = result.lines.reduce((t, l) => t + l.amount_minor, 0);
      expect(result.gross_minor).toBe(summed);
      expect(result.gross_minor).toBe(85_839);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });
  });

  // ===========================================================================
  // Sunday-start weeks (§5 D-8, `households.week_starts_on`, migration 075)
  // ===========================================================================
  //
  // The engine takes `week_start` as an INPUT and derives its span as
  // `[week_start, week_start + 6]` — so it is already week-start agnostic and
  // 3-E1 changed no engine code. That is a claim, and an untested claim about
  // the thing that computes people's pay is worth nothing, so these cases
  // prove it: a Sun..Sat week accumulates weekly overtime exactly as a
  // Mon..Sun week does, the LAST-DAY-governs rule lands on the Saturday, and
  // the reimbursement window moves with the week.
  //
  // FLSA overtime is a property of the designated 7-day workweek, so the same
  // seven shifts genuinely CAN be owed different money in a Sunday-start and a
  // Monday-start household. That is the law, not a rounding artifact — the
  // last case below hand-computes both answers.
  describe('Sunday-start workweek (§5 D-8)', () => {
    const SUN_WEEK_START = '2026-08-02'; // Sunday
    const SUN_1 = '2026-08-02';
    const SAT_END = '2026-08-08'; // the week's LAST day, week_start + 6

    /** The same arrangement, valid early enough to price a Sunday-start week. */
    function sundayArrangement(over: Partial<PayArrangement> = {}) {
      return arrangement({ valid_from: '2026-01-01', ...over });
    }

    it('accumulates weekly overtime across a Sun..Sat week exactly as it does Mon..Sun', () => {
      // 50h worked: 8h on each of Sun..Fri (48h) plus 2h on the Saturday.
      // Threshold 40h, so 40 regular + 10 overtime — the arithmetic is
      // identical to the Mon-start 50h case, which is the point.
      const result = ok(
        computeWeekEarnings({
          week_start: SUN_WEEK_START,
          arrangements: [sundayArrangement()],
          entries: [
            worked(SUN_1, 480), // Sun 02
            worked('2026-08-03', 480), // Mon 03
            worked('2026-08-04', 480), // Tue 04
            worked('2026-08-05', 480), // Wed 05
            worked('2026-08-06', 480), // Thu 06
            worked('2026-08-07', 480), // Fri 07
            worked(SAT_END, 120), // Sat 08
          ],
        })
      );

      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 2400],
        ['overtime', 600],
      ]);
      // 2400 x 1850/60 = 74000; 600 x 2775/60 = 27750.
      expect(result.gross_minor).toBe(74_000 + 27_750);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });

    it('treats the SATURDAY as inside the week: work there is the last worked day and its terms govern', () => {
      // The "terms in force on the last worked day govern" rule has to be
      // able to reach the Saturday at all — it is the seventh day of a
      // Sunday-start week. 42h worked, with the last two hours on Sat 08
      // under new 30h/2x terms.
      const result = ok(
        computeWeekEarnings({
          week_start: SUN_WEEK_START,
          arrangements: [
            sundayArrangement(),
            sundayArrangement({
              id: ARR_ID_C,
              overtime_threshold_minutes: 1800, // 30h
              overtime_multiplier: 2,
              valid_from: SAT_END,
              created_at: '2026-08-01T09:00:00.000Z',
            }),
          ],
          entries: [
            worked(SUN_1, 480),
            worked('2026-08-03', 480),
            worked('2026-08-04', 480),
            worked('2026-08-05', 480),
            worked('2026-08-06', 480), // 40h by here
            worked(SAT_END, 120), // 42h, and the last worked day
          ],
        })
      );

      // 42h against the NEW 30h threshold: 30 regular + 12 overtime at 2x.
      // Under the old 40h terms it would be 40 + 2 at 1.5x, so this pins the
      // rule rather than restating it.
      //
      // The overtime arrives as TWO lines, not one: the threshold and
      // multiplier come from the last worked day, but each day still prices
      // at ITS OWN arrangement, and Sat 08 is the first day on ARR_ID_C. One
      // merged line would be the bug — it would report the Saturday's two
      // hours under an arrangement that was not in force when they were
      // worked.
      expect(result.lines.map(l => [l.kind, l.minutes, l.multiplier])).toEqual([
        ['regular', 1800, null],
        ['overtime', 600, 2], // Sun..Thu, under ARR_ID_A
        ['overtime', 120, 2], // Sat 08, under ARR_ID_C
      ]);
      expect(
        result.lines
          .filter(l => l.kind === 'overtime')
          .reduce((total, l) => total + l.minutes, 0)
      ).toBe(720);
    });

    it('derives the week`s last day as week_start + 6: an arrangement starting that SATURDAY makes the week priceable', () => {
      // This is the one place `week_start + 6` is load-bearing on its own:
      // the week's last day must resolve to an arrangement or the WHOLE week
      // comes back `no_arrangement` (never GBP 0.00). For a Sunday-start
      // week that day is Sat 2026-08-08. An engine that computed the week's
      // end any other way would either refuse a priceable week or price an
      // unpriceable one.
      const priceable = computeWeekEarnings({
        week_start: SUN_WEEK_START,
        arrangements: [sundayArrangement({ valid_from: SAT_END })],
        entries: [],
      });
      expect(priceable.status).toBe('ok');

      // One day later — the FOLLOWING Sunday — and the same week has no
      // terms in force on any day it contains.
      const unpriceable = computeWeekEarnings({
        week_start: SUN_WEEK_START,
        arrangements: [sundayArrangement({ valid_from: '2026-08-09' })],
        entries: [],
      });
      expect(unpriceable.status).toBe('no_arrangement');
      if (unpriceable.status === 'no_arrangement') {
        expect(unpriceable.unpriced_dates).toEqual([SAT_END]);
      }
    });

    it('moves the reimbursement window with the week: the Saturday is IN, the next Sunday is OUT', () => {
      const result = ok(
        computeWeekEarnings({
          week_start: SUN_WEEK_START,
          arrangements: [sundayArrangement()],
          entries: [worked(SUN_1, 480)],
          reimbursements: [
            expense(SUN_1, 500), // the week's first day — in
            expense(SAT_END, 700), // the week's last day — in
            expense('2026-08-09', 900), // the NEXT week's Sunday — out
            expense('2026-08-01', 300), // the PREVIOUS week's Saturday — out
          ],
        })
      );

      expect(result.reimbursements_minor).toBe(1200);
    });

    it('the SAME seven days of work split differently under the two workweeks — and both answers are right', () => {
      // Six 8h days: Sun 2026-08-02 through Fri 2026-08-07. Threshold 40h.
      const days = [
        '2026-08-02', // Sun
        '2026-08-03', // Mon
        '2026-08-04', // Tue
        '2026-08-05', // Wed
        '2026-08-06', // Thu
        '2026-08-07', // Fri
      ];

      // A SUNDAY-start household sees all six days in ONE week: 48h, so 40
      // regular + 8 overtime.
      const sundayWeek = ok(
        computeWeekEarnings({
          week_start: SUN_WEEK_START,
          arrangements: [sundayArrangement()],
          entries: days.map(d => worked(d, 480)),
        })
      );
      expect(sundayWeek.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 2400],
        ['overtime', 480],
      ]);
      expect(sundayWeek.gross_minor).toBe(74_000 + 22_200);

      // A MONDAY-start household splits them: the Sunday belongs to the
      // PREVIOUS week, leaving Mon..Fri at exactly 40h — NO overtime at all.
      const mondayWeek = ok(
        computeWeekEarnings({
          week_start: '2026-08-03',
          arrangements: [sundayArrangement()],
          entries: days.slice(1).map(d => worked(d, 480)),
        })
      );
      expect(mondayWeek.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 2400],
      ]);
      expect(mondayWeek.gross_minor).toBe(74_000);

      // ...and the orphaned Sunday is a lone 8h day in the week before,
      // priced at plain time. Total across BOTH Monday-start weeks is
      // 74000 + 14800 = 88800, against the Sunday-start household's 96200 —
      // a real GBP 74.00 difference produced by nothing but the designated
      // workweek. This is why D-8 makes it immutable once hours exist.
      const priorMondayWeek = ok(
        computeWeekEarnings({
          week_start: '2026-07-27',
          arrangements: [sundayArrangement()],
          entries: [worked('2026-08-02', 480)],
        })
      );
      expect(priorMondayWeek.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 480],
      ]);
      expect(priorMondayWeek.gross_minor).toBe(14_800);
      expect(mondayWeek.gross_minor + priorMondayWeek.gross_minor).not.toBe(
        sundayWeek.gross_minor
      );
    });

    it('applies the guaranteed-hours top-up against the Sun..Sat week`s own total', () => {
      // 30h worked in a Sunday-start week against a 40h guarantee: the
      // shortfall is 10h, priced at the last day's rate. The top-up is a
      // WEEKLY term, so it must be measured over the household's own seven
      // days and no others.
      const result = ok(
        computeWeekEarnings({
          week_start: SUN_WEEK_START,
          arrangements: [
            sundayArrangement({ guaranteed_minutes_per_week: 2400 }),
          ],
          entries: [
            worked(SUN_1, 480),
            worked('2026-08-03', 480),
            worked('2026-08-04', 480),
            worked('2026-08-05', 480),
          ],
        })
      );

      expect(result.lines.map(l => [l.kind, l.minutes])).toEqual([
        ['regular', 1920],
        ['guaranteed_topup', 480],
      ]);
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
