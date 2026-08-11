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
import { COMMON_DEFAULTS_PRESET } from '@steadily-nanny/shared-types/payTermsPresets';
import { WeekEarningsSchema } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  type ComputeWeekEarningsInput,
  computeWeekEarnings,
  weeklyEquivalentMinor,
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

  // ===========================================================================
  // Daily overtime, double time, and the seventh consecutive day (3-E2).
  //
  // READ FIRST: `docs/design/screens-pay-terms.md` §10.1 (the non-duplication
  // invariant) and §5.3 (the preset's figures). Every gross below is
  // hand-computed in the comment above it, in integer minor units, from
  // `docs/design/screens-pay-terms.md`'s canonical weeks — $28.00/hr, which
  // is the rate every worked example in that spec uses, so a figure here can
  // be checked against a figure there without converting anything.
  //
  // THE ORDER UNDER TEST, stated once:
  //   1. The seventh consecutive day, if the rule is on AND all seven days of
  //      THIS household's workweek were worked. That day is priced whole and
  //      contributes NOTHING to the weekly threshold.
  //   2. Every other worked day splits into regular / daily overtime / double
  //      time against the DAILY thresholds.
  //   3. Weekly overtime accumulates over the REMAINDER only — the minutes no
  //      daily tier already promoted. An hour is never both.
  // ===========================================================================
  describe('daily overtime, double time, seventh day (3-E2)', () => {
    /**
     * The launch preset's figures (`payTermsPresets.ts` — CA Wage Order 15,
     * never named in the UI), at the spec's canonical $28.00/hr.
     *
     * Written out as literals rather than spread from the preset module ON
     * PURPOSE: this is the ENGINE's case table, and it must pin what the
     * engine does with a set of numbers, not what one particular data file
     * currently holds. The preset-vs-manual case below is the one place the
     * two are asserted equal, which is exactly where that assertion belongs.
     */
    function tieredArrangement(over: Partial<PayArrangement> = {}) {
      return arrangement({
        rate_minor: 2800,
        currency: 'USD',
        overtime_threshold_minutes: 2400, // 40h
        overtime_multiplier: 1.5,
        overtime_daily_threshold_minutes: 480, // 8h
        doubletime_daily_threshold_minutes: 720, // 12h
        doubletime_multiplier: 2,
        seventh_day_multiplier: 1.5,
        seventh_day_doubletime_after_minutes: 480, // 8h
        ...over,
      });
    }

    /** [kind, minutes, rate_minor, amount_minor] — the whole line, compactly. */
    function shape(result: ReturnType<typeof ok>) {
      return result.lines.map(l => [
        l.kind,
        l.minutes,
        l.rate_minor,
        l.amount_minor,
      ]);
    }

    // -----------------------------------------------------------------------
    // §10.1's three canonical weeks, and its named test.
    // -----------------------------------------------------------------------

    it('an hour is never both daily and weekly overtime', () => {
      // §10.1's NAMED case. Five 10-hour days = 50h.
      //   per day: 480 regular + 120 daily OT
      //   week:    regular 2400, daily OT 600, remainder 2400 = the weekly
      //            threshold exactly, so weekly OT adds NOTHING.
      //   2400m x 2800/60 = 112_000
      //    600m x 4200/60 =  42_000   (OT rate 2800 x 1.5 = 4200)
      //   gross           = 154_000 = $1,540.00
      // Fails at 40 + 20 (double-counting) and at any priced total above 50h.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 600)),
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 600, 4200, 42_000],
      ]);
      expect(result.gross_minor).toBe(154_000);
      // The invariant itself, stated independently of the lines: every worked
      // minute is priced exactly once.
      expect(result.lines.reduce((sum, l) => sum + l.minutes, 0)).toBe(3000);
      expect(result.worked_minutes).toBe(3000);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });

    it('prices a 13-hour day in three tiers in one day (§10.1, the 53h week)', () => {
      // 4 x 10h + 1 x 13h = 53h.
      //   Mon..Thu: 480 regular + 120 daily OT each -> 1920 reg, 480 OT
      //   Fri 780:  480 regular, 240 daily OT (8h->12h), 60 double time
      //   week:     regular 2400, OT 720, DT 60; remainder 2400 = threshold,
      //             so weekly OT adds nothing. §10.1: weekly says 53 - 40 =
      //             13 premium hours; the daily route says 12 + 1 = 13. Same
      //             thirteen hours, reached two ways, counted ONCE.
      //   2400m x 2800/60 = 112_000
      //    720m x 4200/60 =  50_400
      //     60m x 5600/60 =   5_600   (DT rate 2800 x 2 = 5600)
      //   gross           = 168_000 = $1,680.00
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [
              ...[MON, TUE, WED, THU].map(d => worked(d, 600)),
              worked(FRI, 780),
            ],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 720, 4200, 50_400],
        ['doubletime', 60, 5600, 5_600],
      ]);
      expect(result.gross_minor).toBe(168_000);
      expect(result.lines.reduce((sum, l) => sum + l.minutes, 0)).toBe(3180);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });

    it('pays daily overtime in a SHORT week, where no weekly threshold is near', () => {
      // Three 10-hour days = 30h, well under the 40h weekly threshold. This
      // is the case a weekly-only engine gets wrong and cannot be talked out
      // of: it sees 30 regular hours. The daily tier sees six premium hours.
      //   per day:   480 regular + 120 daily OT
      //   remainder: 1440, nowhere near 2400 -> no weekly OT
      //   1440m x 2800/60 = 67_200
      //    360m x 4200/60 = 25_200
      //   gross           = 92_400 = $924.00
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [MON, TUE, WED].map(d => worked(d, 600)),
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 1440, 2800, 67_200],
        ['overtime', 360, 4200, 25_200],
      ]);
      expect(result.gross_minor).toBe(92_400);
    });

    it('pays double time on one long day in an otherwise empty week', () => {
      // A single 13-hour Monday, 13h in the week. Three tiers in one day with
      // no weekly rule in sight.
      //   480 regular, 240 daily OT (8h->12h), 60 double time
      //   480m x 2800/60 = 22_400
      //   240m x 4200/60 = 16_800
      //    60m x 5600/60 =  5_600
      //   gross          = 44_800 = $448.00
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [worked(MON, 780)],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 480, 2800, 22_400],
        ['overtime', 240, 4200, 16_800],
        ['doubletime', 60, 5600, 5_600],
      ]);
      expect(result.gross_minor).toBe(44_800);
    });

    it('prices a plain 5 x 8h week as all regular, with the daily tiers armed', () => {
      // §10.1's third canonical week. 40h, nothing over any threshold.
      //   2400m x 2800/60 = 112_000 = $1,120.00
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
          })
        )
      );

      expect(shape(result)).toEqual([['regular', 2400, 2800, 112_000]]);
      expect(result.gross_minor).toBe(112_000);
    });

    it('fires WEEKLY overtime on the remainder once the daily tiers are done with it', () => {
      // Six 9-hour days = 54h — the case the three canonical weeks do NOT
      // cover, because in all three the remainder lands exactly on 40h.
      //   per day:   480 regular + 60 daily OT
      //   remainder: 6 x 480 = 2880, threshold 2400 -> Mon..Fri fill it, so
      //              the WHOLE of Saturday's 480 remainder is weekly OT.
      //   premium:   360 daily OT + 480 weekly OT = 840m, all at 1.5x
      //   2400m x 2800/60 = 112_000
      //    840m x 4200/60 =  58_800
      //   gross           = 170_800 = $1,708.00
      // Note the single overtime line: Saturday carries BOTH a daily-OT and a
      // weekly-OT segment, at the same rate under the same arrangement, so
      // they merge — the split is arithmetic, not two rows for a nanny to
      // reconcile.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [MON, TUE, WED, THU, FRI, SAT].map(d => worked(d, 540)),
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 840, 4200, 58_800],
      ]);
      expect(result.gross_minor).toBe(170_800);
      expect(result.lines.reduce((sum, l) => sum + l.minutes, 0)).toBe(3240);
    });

    // -----------------------------------------------------------------------
    // The seventh consecutive day.
    // -----------------------------------------------------------------------

    it('prices the seventh day of a fully-worked workweek at 1.5x, then 2x beyond 8h', () => {
      // Mon..Sat 8h + Sun 10h = 58h, every day of the workweek worked.
      //   Sunday is the SEVENTH DAY (week_start + 6), priced whole:
      //     480m at 1.5x, then 120m at 2x. It contributes NOTHING to the
      //     weekly threshold — those hours already carry a premium.
      //   remainder: Mon..Sat 6 x 480 = 2880 -> Mon..Fri regular (2400),
      //              Saturday's 480 is weekly OT.
      //   2400m x 2800/60 = 112_000
      //    960m x 4200/60 =  67_200   (Sat 480 weekly + Sun 480 seventh-day)
      //    120m x 5600/60 =  11_200
      //   gross           = 190_400 = $1,904.00
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [
              ...[MON, TUE, WED, THU, FRI, SAT].map(d => worked(d, 480)),
              worked(SUN, 600),
            ],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 960, 4200, 67_200],
        ['doubletime', 120, 5600, 11_200],
      ]);
      expect(result.gross_minor).toBe(190_400);
      expect(result.worked_minutes).toBe(3480);
      expect(result.lines.reduce((sum, l) => sum + l.minutes, 0)).toBe(3480);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });

    it('does NOT fire the seventh-day rule when a mid-week day was missed', () => {
      // The same Sunday, the same 10 hours — but Saturday off, so only six of
      // the workweek's seven days were worked and Sunday is an ordinary day.
      //   Sun 600: 480 regular-eligible remainder + 120 DAILY OT (no double
      //            time: 600 < the 720 daily DT threshold).
      //   remainder: Mon..Fri 2400 fills the weekly threshold exactly, so
      //              Sunday's 480 remainder is weekly OT.
      //   2400m x 2800/60 = 112_000
      //    600m x 4200/60 =  42_000   (120 daily + 480 weekly, one line)
      //   gross           = 154_000 = $1,540.00, and NO doubletime line.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [
              ...[MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
              worked(SUN, 600),
            ],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 600, 4200, 42_000],
      ]);
      expect(result.lines.some(l => l.kind === 'doubletime')).toBe(false);
      expect(result.gross_minor).toBe(154_000);
    });

    it('prices a single-tier seventh day wholly at its multiplier', () => {
      // `seventh_day_doubletime_after_minutes` null = the rule has ONE tier
      // (the §3 shape a non-CA state would use). The whole 10-hour Sunday
      // prices at 1.5x and no double-time line is fabricated.
      //   remainder 2880 -> 2400 regular + 480 weekly OT (Saturday)
      //   Sunday 600 at 1.5x joins the same overtime line: 1080m total
      //   2400m x 2800/60 = 112_000
      //   1080m x 4200/60 =  75_600
      //   gross           = 187_600 = $1,876.00
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              tieredArrangement({ seventh_day_doubletime_after_minutes: null }),
            ],
            entries: [
              ...[MON, TUE, WED, THU, FRI, SAT].map(d => worked(d, 480)),
              worked(SUN, 600),
            ],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 1080, 4200, 75_600],
      ]);
      expect(result.gross_minor).toBe(187_600);
    });

    it('leaves the seventh day ordinary when the arrangement has no seventh-day rule', () => {
      // `seventh_day_multiplier` null = explicit no. Same seven worked days
      // as the seventh-day case, priced by the daily/weekly tiers alone.
      //   Sun 600: 480 remainder + 120 daily OT.
      //   remainder 7 x 480 = 3360 -> 2400 regular (Mon..Fri), Sat 480 and
      //   Sun 480 weekly OT.
      //   premium: 480 + 480 + 120 = 1080m at 1.5x
      //   gross = 112_000 + 75_600 = 187_600 = $1,876.00
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              tieredArrangement({
                seventh_day_multiplier: null,
                seventh_day_doubletime_after_minutes: null,
              }),
            ],
            entries: [
              ...[MON, TUE, WED, THU, FRI, SAT].map(d => worked(d, 480)),
              worked(SUN, 600),
            ],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 1080, 4200, 75_600],
      ]);
      expect(result.gross_minor).toBe(187_600);
    });

    // -----------------------------------------------------------------------
    // Which day is the seventh depends on the HOUSEHOLD's workweek (3-E1).
    // -----------------------------------------------------------------------

    it('moves the seventh day with the household week start — same hours, different answer', () => {
      // Seven identical recorded days, Mon 03 .. Sun 09, the last one long.
      // The hours do not move; the workweek boundary does.
      const entries = [
        ...[MON, TUE, WED, THU, FRI, SAT].map(d => worked(d, 480)),
        worked(SUN, 600),
      ];

      // Monday-start household: the workweek IS Mon 03 .. Sun 09, all seven
      // days worked, so Sunday is the seventh day -> 480 at 1.5x, 120 at 2x.
      // gross 190_400 = $1,904.00 (the seventh-day case above).
      const mondayStart = ok(
        computeWeekEarnings(
          input({ arrangements: [tieredArrangement()], entries })
        )
      );

      // Sunday-start household: the workweek is Sun 02 .. Sat 08. Sunday 02
      // was NOT worked, so the seventh-day rule cannot fire, and Sunday 09
      // belongs to the NEXT workweek — it is still priced here because the
      // engine prices the entries it is handed (the caller owns which entries
      // belong to which week), but it is priced by the ordinary daily and
      // weekly tiers: 480 remainder + 120 daily OT.
      //   remainder 7 x 480 = 3360 -> 2400 regular (Mon 03..Fri 07),
      //   Sat 08 480 and Sun 09 480 weekly OT, plus Sun 09's 120 daily OT.
      //   gross = 112_000 + 75_600 = 187_600 = $1,876.00
      const sundayStart = ok(
        computeWeekEarnings({
          week_start: '2026-08-02',
          arrangements: [tieredArrangement({ valid_from: '2026-01-01' })],
          entries,
        })
      );

      expect(shape(mondayStart)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 960, 4200, 67_200],
        ['doubletime', 120, 5600, 11_200],
      ]);
      expect(shape(sundayStart)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 1080, 4200, 75_600],
      ]);
      expect(mondayStart.gross_minor).toBe(190_400);
      expect(sundayStart.gross_minor).toBe(187_600);
    });

    // -----------------------------------------------------------------------
    // Null is an explicit no; nothing is ever fabricated.
    // -----------------------------------------------------------------------

    it('never emits a doubletime line when the arrangement has no doubletime multiplier', () => {
      // A daily double-time THRESHOLD with no multiplier is a row 078's CHECK
      // forbids, so this can only arrive from a hand-written row or an older
      // client. The engine does not guess a rate and does not drop the
      // minutes: everything above the daily overtime threshold is overtime.
      //   13h day: 480 regular + 300 daily OT. Four 8h days: 1920 remainder.
      //   remainder 2400 = threshold -> no weekly OT.
      //   2400m x 2800/60 = 112_000
      //    300m x 4200/60 =  21_000
      //   gross           = 133_000
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement({ doubletime_multiplier: null })],
            entries: [
              ...[MON, TUE, WED, THU].map(d => worked(d, 480)),
              worked(FRI, 780),
            ],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 300, 4200, 21_000],
      ]);
      expect(result.gross_minor).toBe(133_000);
      expect(result.lines.reduce((sum, l) => sum + l.minutes, 0)).toBe(2700);
    });

    it('prices double time with NO daily overtime tier beneath it without double-counting', () => {
      // A legal 078 row: `overtime_daily_threshold_minutes` null (no daily
      // overtime band) but a double-time threshold set. 078's ordering CHECK
      // passes vacuously when the lower threshold is null, so this row can
      // exist and the engine must not treat the day's minutes as BOTH
      // remainder and double time. A 13-hour day is 720m of ordinary
      // remainder and 60m of double time — 780 priced minutes, never 840.
      //   remainder: 4 x 480 + 720 = 2640, threshold 2400 -> 2400 regular,
      //              240 weekly OT (all on Friday).
      //   2400m x 2800/60 = 112_000
      //    240m x 4200/60 =  16_800
      //     60m x 5600/60 =   5_600
      //   gross           = 134_400
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              tieredArrangement({ overtime_daily_threshold_minutes: null }),
            ],
            entries: [
              ...[MON, TUE, WED, THU].map(d => worked(d, 480)),
              worked(FRI, 780),
            ],
          })
        )
      );

      expect(result.lines.reduce((sum, l) => sum + l.minutes, 0)).toBe(2700);
      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 240, 4200, 16_800],
        ['doubletime', 60, 5600, 5_600],
      ]);
      expect(result.gross_minor).toBe(134_400);
    });

    it('prices a week exactly as before when no daily tier is configured', () => {
      // The pre-078 arrangement, unchanged: five 10-hour days, weekly
      // threshold only. 50h -> 40 regular + 10 weekly OT, the SAME split the
      // daily route reaches, but it must still reach it with the daily
      // columns null.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              tieredArrangement({
                overtime_daily_threshold_minutes: null,
                doubletime_daily_threshold_minutes: null,
                doubletime_multiplier: null,
                seventh_day_multiplier: null,
                seventh_day_doubletime_after_minutes: null,
              }),
            ],
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 600)),
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 600, 4200, 42_000],
      ]);
      expect(result.gross_minor).toBe(154_000);
    });

    it('leaves PTO, paid cancellations and reimbursements outside every daily tier', () => {
      // A daily tier prices WORKED minutes. PTO and a paid cancellation are
      // not worked minutes: they must not push a day over a daily threshold,
      // and they must not be promoted by one. Fri: 10h worked (480 + 120
      // daily OT) plus 8h PTO on Saturday and a 4h paid cancellation on
      // Sunday, neither of which changes a single premium minute.
      //   worked Mon..Fri 600 each: regular 2400, daily OT 600, remainder
      //   2400 = threshold, no weekly OT — identical to the named case.
      //   pto 480m x 2800/60          = 22_400
      //   cancellation 240m x 2800/60 = 11_200
      //   gross = 112_000 + 42_000 + 22_400 + 11_200 = 187_600
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [tieredArrangement()],
            entries: [
              ...[MON, TUE, WED, THU, FRI].map(d => worked(d, 600)),
              cancelled(SUN, 240),
            ],
            pto_usage: [pto(SAT, 480)],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 600, 4200, 42_000],
        ['cancellation_paid', 240, 2800, 11_200],
        ['pto', 480, 2800, 22_400],
      ]);
      expect(result.gross_minor).toBe(187_600);
      // Seven days have a record but only five were WORKED, so the
      // seventh-day rule stays off — PTO is not a worked day.
      expect(result.lines.some(l => l.kind === 'doubletime')).toBe(false);
      expect(result.worked_minutes).toBe(3000);
      expect(result.payable_minutes).toBe(3000 + 240 + 480);
    });
  });

  // =========================================================================
  // The worked-holiday premium (3-E4, §5 D-12).
  //
  // THE COMPOSITION RULE THIS BLOCK EXISTS TO PIN, stated once:
  //
  //   Hours worked on a household-observed holiday are ORDINARY WORKED TIME
  //   for every purpose the engine already had. They price through the daily
  //   bands, the seventh-day rule and the weekly threshold exactly as if the
  //   day were not a holiday, they appear on whichever tier line they earned,
  //   and they count toward every threshold. The premium is then an ADDITIVE
  //   INCREMENT on top: one `holiday_premium` line carrying THE SAME MINUTES
  //   a second time at `rate x (multiplier - 1)`.
  //
  // Why an increment and not a re-pricing. §10.1's non-duplication invariant
  // says weekly overtime must never re-examine an hour a daily tier already
  // promoted, because those are the same hours. A holiday is a different KIND
  // of fact about an hour: "this hour was above the daily threshold" and
  // "this hour was worked on the Fourth of July" are two independent things,
  // both true, and each was separately agreed. Pricing the holiday hours
  // WHOLE at the premium (the way the seventh day is priced whole) would have
  // to either pull them out of the weekly threshold — silently shrinking the
  // week and destroying overtime she earned — or leave them in and pay some
  // of them twice. The increment does neither: the hour is priced once at its
  // own tier, and the agreed holiday uplift is paid once on top.
  //
  // The consequence a reader must hold on to: `minutes` on a
  // `holiday_premium` line is NOT disjoint from the minutes above it. It is
  // the only kind where that is true, and it is why
  // `docs/design/screens-pay-terms.md` §12.2's export gives it its own
  // `holiday_premium_minutes` column.
  //
  // `observed_holidays` reaches the engine as DATES, never as holiday keys —
  // the engine takes priced facts, not storage, the same boundary the PTO
  // netting sits on. Resolving this household's toggles into this week's
  // dates is `weekEarningsService`'s job and is tested there. Which is also
  // why these cases can put a holiday on any date in the canonical week.
  // =========================================================================
  describe('worked-holiday premium (3-E4)', () => {
    /** [kind, minutes, rate_minor, amount_minor] — the whole line, compactly. */
    function shape(result: ReturnType<typeof ok>) {
      return result.lines.map(l => [
        l.kind,
        l.minutes,
        l.rate_minor,
        l.amount_minor,
      ]);
    }

    /** $28.00/hr, 40h weekly threshold at 1.5x — the spec's canonical rate. */
    function holidayArrangement(over: Partial<PayArrangement> = {}) {
      return arrangement({
        rate_minor: 2800,
        currency: 'USD',
        overtime_threshold_minutes: 2400,
        overtime_multiplier: 1.5,
        worked_holiday_multiplier: 1.5,
        ...over,
      });
    }

    it('pays a premium for hours worked on an observed holiday', () => {
      // 5 x 8h = 40h, Friday observed. Nothing crosses a threshold.
      //   regular  2400m x 2800/60 = 112_000
      //   premium rate = 2800 x 1.5 - 2800 = 1400 (the uplift ALONE)
      //   premium   480m x 1400/60 =  11_200
      //   gross                    = 123_200 = $1,232.00
      // By hand the other way: 32 ordinary hours at $28 = $896, plus 8
      // holiday hours at $42 = $336. $896 + $336 = $1,232. The two readings
      // agree, which is the whole point of pricing the uplift separately.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
            observed_holidays: [FRI],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['holiday_premium', 480, 1400, 11_200],
      ]);
      expect(result.gross_minor).toBe(123_200);
      // The premium is an uplift on hours already counted — it must not
      // inflate either minute total. Worked is 40h, not 48h.
      expect(result.worked_minutes).toBe(2400);
      expect(result.payable_minutes).toBe(2400);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });

    it('states the agreed multiplier on the line, beside the uplift-only rate', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries: [worked(FRI, 480)],
            observed_holidays: [FRI],
          })
        )
      );
      const premium = result.lines.find(l => l.kind === 'holiday_premium');
      // `multiplier` is what was AGREED (1.5); `rate_minor` is what this row
      // ADDS (the uplift). A reader who multiplies 2800 by 1.5 and expects
      // 4200 here is reading the wrong row — the base 2800 is on the
      // `regular` line above.
      expect(premium?.multiplier).toBe(1.5);
      expect(premium?.rate_minor).toBe(1400);
      expect(premium?.from_date).toBe(FRI);
      expect(premium?.to_date).toBe(FRI);
      expect(premium?.arrangement_id).toBe(ARR_ID_A);
    });

    it('emits NOTHING when the premium is null — never a fabricated 0.00 row', () => {
      // Null means "a worked holiday pays the normal rate" (§4.3's own copy).
      // A zero-amount row would tell a nanny her family agreed a holiday
      // premium and then paid her nothing for it (§2.9: never render a
      // fabricated figure).
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              holidayArrangement({ worked_holiday_multiplier: null }),
            ],
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
            observed_holidays: [FRI],
          })
        )
      );

      expect(shape(result)).toEqual([['regular', 2400, 2800, 112_000]]);
      expect(result.gross_minor).toBe(112_000);
    });

    it('emits nothing for a PRE-080 arrangement that omits the column entirely', () => {
      // Undefined and null must read the same: the terms it was agreed under
      // said nothing about holidays (§5 D-9 — no backfill, no default).
      const { worked_holiday_multiplier: _omitted, ...preMigration } =
        holidayArrangement();
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [preMigration as PayArrangement],
            entries: [worked(FRI, 480)],
            observed_holidays: [FRI],
          })
        )
      );
      expect(result.lines.some(l => l.kind === 'holiday_premium')).toBe(false);
    });

    it('emits nothing at a multiplier of exactly 1 — an uplift of zero is not a term', () => {
      // 1.00 is storable (the column floors at 1) and it means the same thing
      // null does. The gate is `> 1`, not `!== null`, so a family that typed
      // 1 rather than clearing the field gets the same honest week.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              holidayArrangement({ worked_holiday_multiplier: 1 }),
            ],
            entries: [worked(FRI, 480)],
            observed_holidays: [FRI],
          })
        )
      );
      expect(result.lines.some(l => l.kind === 'holiday_premium')).toBe(false);
      expect(result.gross_minor).toBe(22_400); // 480m x 2800/60
    });

    it('prices a DISABLED holiday as an ordinary day', () => {
      // The family toggled it off, so the date never reaches the engine. Same
      // week, same premium on the arrangement, and the day pays the ordinary
      // rate — which is what "per-family toggles" has to mean to be worth
      // anything (D-12).
      const entries = [MON, TUE, WED, THU, FRI].map(d => worked(d, 480));
      const disabled = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries,
            observed_holidays: [],
          })
        )
      );
      expect(shape(disabled)).toEqual([['regular', 2400, 2800, 112_000]]);

      // Omitting the field entirely is the same as an empty list: a caller
      // that has not wired holidays through cannot accidentally pay one.
      const omitted = ok(
        computeWeekEarnings(
          input({ arrangements: [holidayArrangement()], entries })
        )
      );
      expect(shape(omitted)).toEqual(shape(disabled));
    });

    it('pays nothing for an observed holiday NOBODY WORKED', () => {
      // THE DELIBERATE GAP, and it is a gap in the model, not in this code.
      // Nothing on the arrangement, on the household, or in D-12 says how
      // many hours a paid-but-not-worked holiday is worth — not her scheduled
      // hours, not a fixed eight, not an average. Pricing one would mean the
      // engine inventing a number, which is the one thing it must never do
      // (§2.9). What ALREADY pays an unworked holiday is the guaranteed-hours
      // top-up (the companion case below) or a time-off day marked paid.
      // Carried to the owner as this slice's open question.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries: [MON, TUE, WED, THU].map(d => worked(d, 480)),
            observed_holidays: [FRI],
          })
        )
      );

      expect(result.lines.map(l => l.kind)).toEqual(['regular']);
      expect(result.gross_minor).toBe(89_600); // 1920m x 2800/60
    });

    it('lets the guaranteed-hours top-up pay the unworked holiday, unchanged', () => {
      // Same week, but the family guaranteed 40h. The Friday off produces an
      // 8h shortfall and the existing top-up covers it at the ordinary rate —
      // the mechanism that already existed, still working, with no holiday
      // line and no double pay.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              holidayArrangement({ guaranteed_minutes_per_week: 2400 }),
            ],
            entries: [MON, TUE, WED, THU].map(d => worked(d, 480)),
            observed_holidays: [FRI],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 1920, 2800, 89_600],
        ['guaranteed_topup', 480, 2800, 22_400],
      ]);
      expect(result.gross_minor).toBe(112_000);
    });

    // -----------------------------------------------------------------------
    // The composition case. This is the one that pins the rule.
    // -----------------------------------------------------------------------

    it('a holiday hour is still an overtime hour — the premium stacks, the tiers do not move', () => {
      // CA-shaped terms plus a 1.5x holiday premium. Mon-Thu 8h, Fri 13h, and
      // FRIDAY IS THE HOLIDAY. 45h in the week.
      //
      //   Mon..Thu 480 each: entirely below the 8h daily threshold -> 1920 in
      //                      the remainder.
      //   Fri 780:  480 regular | 240 daily OT (8h-12h) | 60 double time
      //             -> 480 joins the remainder.
      //   remainder 1920 + 480 = 2400 = the weekly threshold exactly, so the
      //             weekly rule adds nothing (§10.1).
      //   regular   2400m x 2800/60 = 112_000
      //   overtime   240m x 4200/60 =  16_800
      //   doubletime  60m x 5600/60 =   5_600
      //   premium    780m x 1400/60 =  18_200   <- ALL 13 holiday hours
      //   gross                     = 152_600 = $1,526.00
      //
      // Read the premium line: it is 780 minutes, the WHOLE holiday day,
      // including the four overtime hours and the double-time hour. Those
      // hours were promoted by the daily tiers AND worked on a holiday; both
      // facts are true and both were separately agreed. What must NOT happen
      // is the holiday pulling those 780 minutes out of the daily bands (Fri
      // would stop producing overtime) or out of the weekly remainder (the
      // week would shrink to 32h and lose overtime she earned).
      const tiers: Partial<PayArrangement> = {
        overtime_daily_threshold_minutes: 480,
        doubletime_daily_threshold_minutes: 720,
        doubletime_multiplier: 2,
      };
      const entries = [
        ...[MON, TUE, WED, THU].map(d => worked(d, 480)),
        worked(FRI, 780),
      ];
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement(tiers)],
            entries,
            observed_holidays: [FRI],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 240, 4200, 16_800],
        ['doubletime', 60, 5600, 5_600],
        ['holiday_premium', 780, 1400, 18_200],
      ]);
      expect(result.gross_minor).toBe(152_600);
      // The tier split is byte-identical to the same week with the holiday
      // toggled off — the premium changes what is PAID, never how the hours
      // are CLASSIFIED. That is the invariant, asserted directly.
      const ordinary = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement(tiers)],
            entries,
            observed_holidays: [],
          })
        )
      );
      expect(shape(ordinary)).toEqual(
        shape(result).filter(([kind]) => kind !== 'holiday_premium')
      );
      expect(result.worked_minutes).toBe(2700);
      expect(result.payable_minutes).toBe(2700);
      expect(WeekEarningsSchema.safeParse(result).success).toBe(true);
    });

    it('the seventh consecutive day can also be a holiday, and both apply', () => {
      // All seven days worked at 8h, Sunday (the seventh day of this
      // Monday-start week) observed. The seventh-day rule prices Sunday whole
      // at 1.5x and keeps it out of the weekly remainder; the holiday premium
      // then adds its uplift on top of that, because the two are independent
      // agreements about the same hours.
      //   Mon..Sat remainder 2880, weekly threshold 2400
      //             -> 2400 regular + 480 weekly OT
      //   Sun 480 priced whole at the seventh-day tier -> 480 OT
      //   overtime line = 480 (weekly, Sat) + 480 (Sun) = 960 at 4200
      //   regular    2400m x 2800/60 = 112_000
      //   overtime    960m x 4200/60 =  67_200
      //   premium     480m x 1400/60 =  11_200
      //   gross                      = 190_400
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement({ seventh_day_multiplier: 1.5 })],
            entries: [MON, TUE, WED, THU, FRI, SAT, SUN].map(d =>
              worked(d, 480)
            ),
            observed_holidays: [SUN],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 2400, 2800, 112_000],
        ['overtime', 960, 4200, 67_200],
        ['holiday_premium', 480, 1400, 11_200],
      ]);
      expect(result.gross_minor).toBe(190_400);
      expect(result.worked_minutes).toBe(3360);
    });

    // -----------------------------------------------------------------------
    // Which arrangement supplies which number.
    // -----------------------------------------------------------------------

    it('takes the RATE per day and the MULTIPLIER from the week, like every other premium', () => {
      // Arrangement A ($28.00, 1.5x) until Tuesday; B ($30.00, 2x) from
      // Wednesday. Monday AND Friday are observed.
      //
      // The multiplier comes from the LAST WORKED DAY's arrangement (B, 2x) —
      // the same "a multiplier is a TERM, and the week is negotiated and
      // signed off as one unit" rule the weekly threshold, the daily tiers and
      // the seventh-day rule all already follow. The base RATE stays per-day,
      // exactly as it does on the `regular` lines beside it.
      //   Mon premium: (2800 x 2) - 2800 = 2800 uplift; 480m -> 22_400
      //   Fri premium: (3000 x 2) - 3000 = 3000 uplift; 480m -> 24_000
      //   regular A Mon..Tue  960m x 2800/60 = 44_800
      //   regular B Wed..Fri 1440m x 3000/60 = 72_000
      //   gross                              = 163_200
      const arrA = holidayArrangement({ valid_from: '2026-01-01' });
      const arrB = holidayArrangement({
        id: ARR_ID_B,
        rate_minor: 3000,
        worked_holiday_multiplier: 2,
        valid_from: WED,
        created_at: '2026-08-05T09:00:00+00:00',
      });

      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [arrB, arrA], // any order — the engine resolves
            entries: [MON, TUE, WED, THU, FRI].map(d => worked(d, 480)),
            observed_holidays: [MON, FRI],
          })
        )
      );

      expect(shape(result)).toEqual([
        ['regular', 960, 2800, 44_800],
        ['regular', 1440, 3000, 72_000],
        ['holiday_premium', 480, 2800, 22_400],
        ['holiday_premium', 480, 3000, 24_000],
      ]);
      expect(result.gross_minor).toBe(163_200);
      // Two rows, not one merged row: they were priced by different
      // arrangements, and merging them would make the line unable to
      // reproduce its own amount.
      const premiums = result.lines.filter(l => l.kind === 'holiday_premium');
      expect(premiums.map(l => l.arrangement_id)).toEqual([ARR_ID_A, ARR_ID_B]);
      expect(premiums.every(l => l.multiplier === 2)).toBe(true);
    });

    it('merges consecutive observed days priced by one arrangement into one dated row', () => {
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries: [THU, FRI].map(d => worked(d, 480)),
            observed_holidays: [THU, FRI],
          })
        )
      );
      const premium = result.lines.find(l => l.kind === 'holiday_premium');
      expect(premium?.minutes).toBe(960);
      expect(premium?.from_date).toBe(THU);
      expect(premium?.to_date).toBe(FRI);
      expect(premium?.amount_minor).toBe(22_400); // 960m x 1400/60
    });

    // -----------------------------------------------------------------------
    // Refusals and rounding.
    // -----------------------------------------------------------------------

    it('still fails the WHOLE week when a holiday is worked on an unpriceable date', () => {
      // The holiday changes nothing about refuse-don't-clamp: a week with a
      // day it cannot price returns no numbers at all, never a premium beside
      // a fabricated 0.00 (§2.9, docs/11-MONEY.md §4).
      const result = computeWeekEarnings(
        input({
          arrangements: [holidayArrangement({ valid_from: THU })],
          entries: [worked(MON, 480), worked(FRI, 480)],
          observed_holidays: [FRI],
        })
      );
      expect(result.status).toBe('no_arrangement');
      expect(
        result.status === 'no_arrangement' && result.unpriced_dates
      ).toEqual([MON]);
    });

    it('an observed holiday with no worked minutes never makes a week unpriceable', () => {
      // The date needs no rate, because it prices nothing. Adding observed
      // holidays to the set of dates that must resolve would fail a week for
      // a Christmas nobody worked and nobody was owed for.
      const result = computeWeekEarnings(
        input({
          arrangements: [holidayArrangement({ valid_from: THU })],
          entries: [worked(FRI, 480)],
          observed_holidays: [MON, FRI],
        })
      );
      expect(result.status).toBe('ok');
    });

    it('rounds the uplift half-up, once, in integers', () => {
      // 1250 x 1.13 is exactly 1412.5 in decimal and 1412.4999999999998 as a
      // double — the documented float trap `overtimeRateMinor` exists to
      // avoid. The uplift must be 1413 - 1250 = 163, not 162.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [
              holidayArrangement({
                rate_minor: 1250,
                worked_holiday_multiplier: 1.13,
              }),
            ],
            entries: [worked(FRI, 60)],
            observed_holidays: [FRI],
          })
        )
      );
      const premium = result.lines.find(l => l.kind === 'holiday_premium');
      expect(premium?.rate_minor).toBe(163);
      expect(premium?.amount_minor).toBe(163); // exactly one hour
      // The uplift is the full premium rate minus the base, exactly — the two
      // roundings can never leave a penny between them.
      const regular = result.lines.find(l => l.kind === 'regular');
      expect((regular?.rate_minor ?? 0) + (premium?.rate_minor ?? 0)).toBe(
        1413
      );
    });

    it('leaves a PTO or cancelled day alone even when it is an observed holiday', () => {
      // The premium is for hours WORKED (D-12: "worked-holiday premium"). A
      // day the nanny did not work — paid leave, a paid cancellation — earns
      // no uplift, and pricing one would pay a premium for a holiday she
      // spent at home.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries: [cancelled(FRI, 240)],
            pto_usage: [pto(THU, 480)],
            observed_holidays: [THU, FRI],
          })
        )
      );
      expect(result.lines.some(l => l.kind === 'holiday_premium')).toBe(false);
      expect(result.lines.map(l => l.kind)).toEqual([
        'cancellation_paid',
        'pto',
      ]);
    });

    it('counts a manual adjustment on a holiday as worked time for the premium', () => {
      // A `manual_adjustment` is a correction of WORKED time and folds into
      // the worked bucket everywhere else in this engine; the premium must
      // read the same bucket or a corrected holiday would silently lose its
      // uplift.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries: [worked(FRI, 480), adjustment(FRI, 60)],
            observed_holidays: [FRI],
          })
        )
      );
      const premium = result.lines.find(l => l.kind === 'holiday_premium');
      expect(premium?.minutes).toBe(540);
      expect(premium?.amount_minor).toBe(12_600); // 540m x 1400/60
    });

    it('ignores an observed date outside the week', () => {
      // Belt and braces on the wrapper's window: a stray date cannot price,
      // because there are no worked minutes on it inside this week.
      const result = ok(
        computeWeekEarnings(
          input({
            arrangements: [holidayArrangement()],
            entries: [worked(MON, 480)],
            observed_holidays: ['2026-07-04', '2026-12-25'],
          })
        )
      );
      expect(result.lines.some(l => l.kind === 'holiday_premium')).toBe(false);
    });
  });
});

// =============================================================================
// The preset is DATA: applying one must be indistinguishable from typing the
// same numbers by hand (`docs/design/screens-pay-terms.md` §5.1 — "Applying a
// preset fills fields").
//
// This is the one place the engine's case table is allowed to reach into
// `payTermsPresets.ts`, and it is the assertion that keeps the preset honest:
// if someone edits a figure in the data file, this test does not fail — it
// pins the EQUIVALENCE, and the hand-computed cases above pin the figures.
// =============================================================================

describe('earningsService — a preset prices identically to the same terms typed by hand', () => {
  const PRESET_WEEK_START = '2026-08-03';

  function withTerms(over: Partial<PayArrangement>): PayArrangement {
    return {
      id: '11111111-1111-4111-8111-111111111101',
      household_id: '11111111-1111-4111-8111-111111111190',
      carer_id: '11111111-1111-4111-8111-111111111191',
      rate_minor: 2800,
      bill_rate_minor: null,
      currency: 'USD',
      overtime_threshold_minutes: null,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: null,
      pto_entitlement_minutes_per_year: null,
      mileage_rate_per_mile_minor: null,
      cancellation_paid_within_hours: null,
      valid_from: '2026-01-01',
      valid_to: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: '11111111-1111-4111-8111-111111111192',
      created_at: '2026-01-01T09:00:00.000Z',
      ...over,
    };
  }

  // A week that exercises EVERY tier at once: six 8h days and a long seventh,
  // so the seventh-day rule, the weekly threshold and double time all fire.
  const entries = [
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
    '2026-08-08',
  ]
    .map(d => ({ kind: 'worked' as const, local_date: d, minutes: 480 }))
    .concat([
      { kind: 'worked' as const, local_date: '2026-08-09', minutes: 600 },
    ]);

  it('produces byte-identical earnings from the preset values and from hand-typed ones', () => {
    const fromPreset = computeWeekEarnings({
      week_start: PRESET_WEEK_START,
      entries,
      arrangements: [withTerms({ ...COMMON_DEFAULTS_PRESET.values })],
    });

    const byHand = computeWeekEarnings({
      week_start: PRESET_WEEK_START,
      entries,
      arrangements: [
        withTerms({
          overtime_threshold_minutes: 2400,
          overtime_multiplier: 1.5,
          overtime_daily_threshold_minutes: 480,
          doubletime_daily_threshold_minutes: 720,
          doubletime_multiplier: 2,
          seventh_day_multiplier: 1.5,
          seventh_day_doubletime_after_minutes: 480,
        }),
      ],
    });

    expect(fromPreset).toEqual(byHand);
    // And it is the hand-computed figure, not merely two equal wrong answers.
    expect(ok(fromPreset).gross_minor).toBe(190_400);
  });

  it('carries the §5.3 figures — 8h/1.5x daily, 40h/1.5x weekly, 12h/2x double, seventh day 1.5x then 2x after 8h', () => {
    expect(COMMON_DEFAULTS_PRESET.values).toEqual({
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      overtime_daily_threshold_minutes: 480,
      doubletime_daily_threshold_minutes: 720,
      doubletime_multiplier: 2,
      seventh_day_multiplier: 1.5,
      seventh_day_doubletime_after_minutes: 480,
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

// D-6/§10: the weekly-equivalent salary framing. §10.1's forbidden-refactor
// guard note lives on the function itself; these tests are the proof that a
// naive `rate * hours` would disagree with it the moment overtime exists.
describe('earningsService.weeklyEquivalentMinor (D-6 §10)', () => {
  it('is null when there is no guarantee — never a fabricated figure (T16)', () => {
    expect(
      weeklyEquivalentMinor(arrangement({ guaranteed_minutes_per_week: null }))
    ).toBeNull();
  });

  it('is null when the guarantee is zero', () => {
    expect(
      weeklyEquivalentMinor(arrangement({ guaranteed_minutes_per_week: 0 }))
    ).toBeNull();
  });

  // §10's canonical example, and §10.1's canonical week: five 10-hour days,
  // $28.00/hr, overtime after 40h at 1.5x. 40 reg + 10 OT =
  // 40*2800 + 10*4200 = 112000 + 42000 = 154000 -> $1,540.00, NOT the naive
  // rate*hours $1,400.00 (2800 * 50).
  it('prices 50 guaranteed hours at $28.00/hr with weekly OT as $1,540.00, never the naive $1,400.00', () => {
    const arr = arrangement({
      rate_minor: 2800,
      currency: 'USD',
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: 3000, // 50h
      valid_from: '2026-01-01',
    });
    expect(weeklyEquivalentMinor(arr)).toBe(154_000);
    expect(weeklyEquivalentMinor(arr)).not.toBe(140_000);
  });

  it('a guarantee within the weekly threshold prices at the plain rate — no overtime invented', () => {
    const arr = arrangement({
      rate_minor: 2000,
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: 2400, // exactly 40h
    });
    expect(weeklyEquivalentMinor(arr)).toBe(80_000); // 40 * 2000
  });

  // The even-spread assumption (§10: "Assumes five 10-hour days") means a
  // guarantee that ALSO crosses the daily-OT threshold prices daily tiers
  // too — 45h over 5 days is 9h/day: 8h regular + 1h daily OT, five times.
  // 40 reg + 5 daily-OT, and the non-duplication invariant (§10.1) means the
  // weekly threshold (40h) sees only the 40 regular minutes left after the
  // daily split — no double-counted premium.
  it('an even spread that crosses the daily-OT threshold prices the daily tier, never double-counted against the weekly one', () => {
    const arr = arrangement({
      rate_minor: 2000,
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      overtime_daily_threshold_minutes: 480, // 8h/day
      guaranteed_minutes_per_week: 2700, // 45h = 5 x 9h
    });
    // 40 reg x 2000 = 80_000; 5h daily OT x (2000*1.5=3000) = 15_000.
    expect(weeklyEquivalentMinor(arr)).toBe(95_000);
  });
});

// 082 (D-17, T7 reversal): pay_frequency/pay_day_of_week/pay_day_of_month are
// PRESENTATION ONLY. This pins that the engine's output is byte-identical
// with and without them set — the FLSA weekly OT engine stays untouched, and
// pay-period grouping happens strictly downstream of this function.
describe('earningsService — pay_frequency/pay_day are presentation-only (D-17)', () => {
  it('prices an identical week whether or not the arrangement carries a pay schedule', () => {
    const entries = [
      worked(MON, 480),
      worked(TUE, 480),
      worked(WED, 480),
      worked(THU, 480),
      worked(FRI, 600), // 44h worked -> some overtime
    ];
    const withoutSchedule = ok(
      computeWeekEarnings(input({ entries, arrangements: [arrangement()] }))
    );
    const withSchedule = ok(
      computeWeekEarnings(
        input({
          entries,
          arrangements: [
            arrangement({
              pay_frequency: 'biweekly',
              pay_day_of_week: 5,
              pay_day_of_month: null,
            }),
          ],
        })
      )
    );
    expect(withSchedule).toEqual(withoutSchedule);
  });

  it('is identical across every pay_frequency value, including semimonthly/monthly day-of-month', () => {
    const entries = [worked(MON, 480)];
    const baseline = ok(
      computeWeekEarnings(input({ entries, arrangements: [arrangement()] }))
    );
    for (const [pay_frequency, pay_day_of_week, pay_day_of_month] of [
      ['weekly', 0, null],
      ['biweekly', 5, null],
      ['semimonthly', null, 15],
      ['monthly', null, 1],
    ] as const) {
      const result = ok(
        computeWeekEarnings(
          input({
            entries,
            arrangements: [
              arrangement({ pay_frequency, pay_day_of_week, pay_day_of_month }),
            ],
          })
        )
      );
      expect(result).toEqual(baseline);
    }
  });
});
