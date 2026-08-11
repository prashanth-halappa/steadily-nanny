import { describe, expect, it } from 'bun:test';
import {
  EARNINGS_LINE_KINDS,
  EARNINGS_LINE_ORDER,
  EARNINGS_RESULT_STATUSES,
  EarningsLineSchema,
  HOURS_ONLY_REASONS,
  humanizeEarningsLineKind,
  isKnownEarningsLineKind,
  TimesheetWeekResponseSchema,
  TimesheetWeekSchema,
  WEEK_EARNINGS_STATES,
  WeekEarningsSchema,
  WeekEarningsStateSchema,
} from '../src/schemas/timesheet.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

const validLine = {
  kind: EARNINGS_LINE_KINDS.REGULAR,
  minutes: 2400,
  rate_minor: 1850,
  multiplier: null,
  amount_minor: 74000,
  from_date: '2026-08-03',
  to_date: '2026-08-07',
  arrangement_id: VALID_UUID,
};

const validOk = {
  status: EARNINGS_RESULT_STATUSES.OK,
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [validLine],
  gross_minor: 74000,
  reimbursements_minor: 0,
  worked_minutes: 2400,
  payable_minutes: 2400,
  guaranteed_minutes_per_week: null,
};

describe('timesheet.schema — earnings', () => {
  describe('const-maps', () => {
    it('EARNINGS_LINE_KINDS carries the pto and reimbursements kinds from day one', () => {
      // Phases 3-4 fill these in; the SHAPE must exist now so the wire
      // contract does not change under the mobile client later
      // (TIER0-PLAN.md Phase 2, "output shape includes them from day one").
      expect(EARNINGS_LINE_KINDS).toEqual({
        REGULAR: 'regular',
        OVERTIME: 'overtime',
        // 3-E2: the top premium tier — minutes beyond a day's double-time
        // threshold, or beyond the seventh consecutive day's second tier
        // (078). Safe to EMIT because `kind` is an open string on the wire
        // and every read site already routes an unknown kind through
        // `humanizeEarningsLineKind` (1-A), and because the app is pre-launch
        // (§5 D-9) so there is no older client to be tolerant for.
        DOUBLETIME: 'doubletime',
        // 3-E4: the worked-holiday premium — an INCREMENT over whatever tier
        // the hour was already priced at, never a re-pricing of it. Emitted
        // only when the arrangement carries a `worked_holiday_multiplier`
        // above 1 AND the week has minutes worked on a date the household
        // toggled on (080). Safe to emit for the same two reasons
        // `doubletime` was: `kind` is an open string with a humanizing
        // fallback on every read site (1-A), and the app is pre-launch (D-9).
        HOLIDAY_PREMIUM: 'holiday_premium',
        CANCELLATION_PAID: 'cancellation_paid',
        GUARANTEED_TOPUP: 'guaranteed_topup',
        PTO: 'pto',
        REIMBURSEMENTS: 'reimbursements',
      });
    });

    it('EARNINGS_LINE_ORDER is the CX spec §4.2 render order, not the const-map order', () => {
      expect(EARNINGS_LINE_ORDER).toEqual([
        'regular',
        'overtime',
        // Directly under overtime — the premium tiers read as a ladder, and
        // it is the order `docs/design/screens-pay-terms.md` §12.1's pay
        // record prints (Regular / Overtime / Double time).
        'doubletime',
        // Last of the premium tiers, because it is the only one that does not
        // move an hour between bands — it sits on top of whichever band the
        // hour landed in above.
        'holiday_premium',
        'cancellation_paid',
        'pto',
        'guaranteed_topup',
        'reimbursements',
      ]);
    });

    it('lists every kind exactly once in the render order', () => {
      // The engine builds its output as `Record<EarningsLineKind, Line[]>`
      // and flat-maps it through this array, so a kind missing here is a kind
      // whose lines are computed and then silently dropped — the breakdown
      // would stop summing to the total beside it.
      expect([...EARNINGS_LINE_ORDER].sort()).toEqual(
        Object.values(EARNINGS_LINE_KINDS).sort()
      );
    });

    it('EARNINGS_RESULT_STATUSES names the three arms', () => {
      expect(EARNINGS_RESULT_STATUSES).toEqual({
        OK: 'ok',
        NO_ARRANGEMENT: 'no_arrangement',
        CURRENCY_CHANGE: 'currency_change',
      });
    });
  });

  describe('EarningsLineSchema', () => {
    it('parses a valid line', () => {
      expect(EarningsLineSchema.safeParse(validLine).success).toBe(true);
    });

    it('accepts an overtime multiplier', () => {
      expect(
        EarningsLineSchema.safeParse({
          ...validLine,
          kind: EARNINGS_LINE_KINDS.OVERTIME,
          multiplier: 1.5,
          rate_minor: 2775,
        }).success
      ).toBe(true);
    });

    it('rejects a multiplier below 1 — overtime never pays less than the base rate', () => {
      expect(
        EarningsLineSchema.safeParse({ ...validLine, multiplier: 0.5 }).success
      ).toBe(false);
    });

    it('rejects a fractional amount_minor — money is integer minor units', () => {
      expect(
        EarningsLineSchema.safeParse({ ...validLine, amount_minor: 740.5 })
          .success
      ).toBe(false);
    });

    it('rejects a negative amount_minor', () => {
      expect(
        EarningsLineSchema.safeParse({ ...validLine, amount_minor: -1 }).success
      ).toBe(false);
    });

    it('requires a date span on every line — the mid-week split renders it', () => {
      const { from_date: _omitted, ...withoutSpan } = validLine;
      expect(EarningsLineSchema.safeParse(withoutSpan).success).toBe(false);
    });

    it('accepts a null arrangement_id (a legacy or synthesised line)', () => {
      expect(
        EarningsLineSchema.safeParse({ ...validLine, arrangement_id: null })
          .success
      ).toBe(true);
    });

    it('ACCEPTS an unknown line kind and preserves it verbatim', () => {
      // The fleet rule: a server that starts emitting a seventh kind must not
      // fail the whole week parse inside every shipped client — one unknown
      // row would error the entire Hours screen. The kind survives unchanged
      // so the client can humanize it rather than guess at it.
      const parsed = EarningsLineSchema.safeParse({
        ...validLine,
        kind: 'bonus',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.kind).toBe('bonus');
    });

    it('still rejects a non-string kind — tolerant is not credulous', () => {
      expect(
        EarningsLineSchema.safeParse({ ...validLine, kind: 42 }).success
      ).toBe(false);
    });

    it('still rejects an empty-string kind — a row with no kind at all is a defect', () => {
      expect(
        EarningsLineSchema.safeParse({ ...validLine, kind: '' }).success
      ).toBe(false);
    });
  });

  describe('isKnownEarningsLineKind / humanizeEarningsLineKind', () => {
    it('recognises every kind this build knows about', () => {
      for (const kind of Object.values(EARNINGS_LINE_KINDS)) {
        expect(isKnownEarningsLineKind(kind)).toBe(true);
      }
    });

    it('does not recognise a kind from a newer server', () => {
      expect(isKnownEarningsLineKind('bonus')).toBe(false);
    });

    it('humanizes a snake_case kind into a readable label', () => {
      expect(humanizeEarningsLineKind('night_differential')).toBe(
        'Night differential'
      );
    });
  });

  describe('EARNINGS_LINE_ORDER totality', () => {
    it('names every kind exactly once — a new kind must not be silently unordered', () => {
      expect([...EARNINGS_LINE_ORDER].sort()).toEqual(
        Object.values(EARNINGS_LINE_KINDS).sort()
      );
    });
  });

  describe('WeekEarningsSchema', () => {
    it('parses the ok arm', () => {
      expect(WeekEarningsSchema.safeParse(validOk).success).toBe(true);
    });

    it('parses an ok arm with no lines at all (zero-everything week)', () => {
      expect(
        WeekEarningsSchema.safeParse({
          ...validOk,
          lines: [],
          gross_minor: 0,
          worked_minutes: 0,
          payable_minutes: 0,
        }).success
      ).toBe(true);
    });

    it('rejects a malformed currency code — formatMoney hands it to Intl.NumberFormat', () => {
      expect(
        WeekEarningsSchema.safeParse({ ...validOk, currency: 'gbp' }).success
      ).toBe(false);
      expect(
        WeekEarningsSchema.safeParse({ ...validOk, currency: 'ab1' }).success
      ).toBe(false);
    });

    it('parses the no_arrangement arm and carries no money fields', () => {
      const parsed = WeekEarningsSchema.safeParse({
        status: EARNINGS_RESULT_STATUSES.NO_ARRANGEMENT,
        week_start: '2026-08-03',
        unpriced_dates: ['2026-08-03'],
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && 'gross_minor' in parsed.data).toBe(false);
    });

    it('parses the currency_change arm and carries no money fields', () => {
      const parsed = WeekEarningsSchema.safeParse({
        status: EARNINGS_RESULT_STATUSES.CURRENCY_CHANGE,
        week_start: '2026-08-03',
        currencies: ['GBP', 'EUR'],
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && 'gross_minor' in parsed.data).toBe(false);
    });

    it('rejects a currency_change arm with only one currency', () => {
      expect(
        WeekEarningsSchema.safeParse({
          status: EARNINGS_RESULT_STATUSES.CURRENCY_CHANGE,
          week_start: '2026-08-03',
          currencies: ['GBP'],
        }).success
      ).toBe(false);
    });

    it('rejects an unknown status', () => {
      expect(
        WeekEarningsSchema.safeParse({ ...validOk, status: 'maybe' }).success
      ).toBe(false);
    });
  });

  describe('the snapshot format version', () => {
    const noArrangement = {
      status: EARNINGS_RESULT_STATUSES.NO_ARRANGEMENT,
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };
    const currencyChange = {
      status: EARNINGS_RESULT_STATUSES.CURRENCY_CHANGE,
      week_start: '2026-08-03',
      currencies: ['GBP', 'EUR'],
    };

    it('parses a snapshot with NO v at all — absent IS v1', () => {
      expect(WeekEarningsSchema.safeParse(validOk).success).toBe(true);
      expect(WeekEarningsSchema.safeParse(noArrangement).success).toBe(true);
      expect(WeekEarningsSchema.safeParse(currencyChange).success).toBe(true);
    });

    it('parses an explicit v: 1 on every arm', () => {
      expect(WeekEarningsSchema.safeParse({ ...validOk, v: 1 }).success).toBe(
        true
      );
      expect(
        WeekEarningsSchema.safeParse({ ...noArrangement, v: 1 }).success
      ).toBe(true);
      expect(
        WeekEarningsSchema.safeParse({ ...currencyChange, v: 1 }).success
      ).toBe(true);
    });

    it('FAILS a v: 2 snapshot on every arm — an unknown format degrades loudly', () => {
      // Refusing is the point: a v2 writer must ship its reader first, and a
      // build that quietly reinterpreted a format it has never seen would
      // print a wrong figure under an Approved label.
      expect(WeekEarningsSchema.safeParse({ ...validOk, v: 2 }).success).toBe(
        false
      );
      expect(
        WeekEarningsSchema.safeParse({ ...noArrangement, v: 2 }).success
      ).toBe(false);
      expect(
        WeekEarningsSchema.safeParse({ ...currencyChange, v: 2 }).success
      ).toBe(false);
    });
  });
});

// =============================================================================
// The week response — earnings attached to a timesheet (Tier 0 Phase 2 wiring)
// =============================================================================

const validTimesheet = {
  id: VALID_UUID,
  household_id: VALID_UUID,
  carer_id: VALID_UUID,
  carer_display_name: 'Nia Rowe',
  week_start: '2026-08-03',
  total_minutes: 2400,
  status: 'submitted',
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
  created_at: '2026-08-03T09:00:00.000Z',
  updated_at: '2026-08-03T09:00:00.000Z',
};

describe('timesheet.schema — the week response', () => {
  describe('WEEK_EARNINGS_STATES', () => {
    it('adds exactly one arm the engine can never return: hours_only', () => {
      expect(WEEK_EARNINGS_STATES).toEqual({
        OK: 'ok',
        NO_ARRANGEMENT: 'no_arrangement',
        CURRENCY_CHANGE: 'currency_change',
        HOURS_ONLY: 'hours_only',
      });
    });

    it('names why a week is hours-only — never a bare null', () => {
      expect(HOURS_ONLY_REASONS).toEqual({
        LEGACY_APPROVAL: 'legacy_approval',
        UNREADABLE_SNAPSHOT: 'unreadable_snapshot',
        CARER_REMOVED: 'carer_removed',
      });
    });
  });

  describe('WeekEarningsStateSchema', () => {
    it('accepts every arm the engine itself can return', () => {
      expect(WeekEarningsStateSchema.safeParse(validOk).success).toBe(true);
      expect(
        WeekEarningsStateSchema.safeParse({
          status: EARNINGS_RESULT_STATUSES.NO_ARRANGEMENT,
          week_start: '2026-08-03',
          unpriced_dates: ['2026-08-03'],
        }).success
      ).toBe(true);
      expect(
        WeekEarningsStateSchema.safeParse({
          status: EARNINGS_RESULT_STATUSES.CURRENCY_CHANGE,
          week_start: '2026-08-03',
          currencies: ['GBP', 'EUR'],
        }).success
      ).toBe(true);
    });

    it('accepts the hours_only arm and it carries NO money fields at all', () => {
      const parsed = WeekEarningsStateSchema.safeParse({
        status: WEEK_EARNINGS_STATES.HOURS_ONLY,
        week_start: '2026-08-03',
        reason: HOURS_ONLY_REASONS.LEGACY_APPROVAL,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && 'gross_minor' in parsed.data).toBe(false);
    });

    it('requires the hours_only arm to name its reason', () => {
      expect(
        WeekEarningsStateSchema.safeParse({
          status: WEEK_EARNINGS_STATES.HOURS_ONLY,
          week_start: '2026-08-03',
        }).success
      ).toBe(false);
    });

    it('rejects an unknown state', () => {
      expect(
        WeekEarningsStateSchema.safeParse({
          status: 'estimated',
          week_start: '2026-08-03',
        }).success
      ).toBe(false);
    });
  });

  describe('TimesheetWeekSchema / TimesheetWeekResponseSchema', () => {
    it('is TimesheetSchema plus a REQUIRED earnings state — never a sneaked-in null', () => {
      expect(
        TimesheetWeekSchema.safeParse({
          ...validTimesheet,
          earnings: validOk,
        }).success
      ).toBe(true);
      expect(TimesheetWeekSchema.safeParse(validTimesheet).success).toBe(false);
      expect(
        TimesheetWeekSchema.safeParse({ ...validTimesheet, earnings: null })
          .success
      ).toBe(false);
    });

    it('keeps every existing timesheet field (additive extension only)', () => {
      const parsed = TimesheetWeekSchema.safeParse({
        ...validTimesheet,
        earnings: validOk,
      });
      expect(parsed.success && parsed.data.total_minutes).toBe(2400);
      expect(parsed.success && parsed.data.status).toBe('submitted');
    });

    // D-5 / §11.1.1 — a live, never-frozen field, so a response written
    // before it existed must still parse.
    it('accepts a response with no nothing_unusual field at all (backward compatible)', () => {
      const { nothing_unusual: _omit, ...withoutField } = {
        ...validTimesheet,
        earnings: validOk,
        nothing_unusual: true,
      };
      expect(TimesheetWeekSchema.safeParse(withoutField).success).toBe(true);
    });

    it('accepts nothing_unusual true/false/null', () => {
      for (const value of [true, false, null]) {
        expect(
          TimesheetWeekSchema.safeParse({
            ...validTimesheet,
            earnings: validOk,
            nothing_unusual: value,
          }).success
        ).toBe(true);
      }
    });

    it('rejects a non-boolean nothing_unusual', () => {
      expect(
        TimesheetWeekSchema.safeParse({
          ...validTimesheet,
          earnings: validOk,
          nothing_unusual: 'yes',
        }).success
      ).toBe(false);
    });

    it('allows a null timesheet on the envelope — no row exists until the first clock-out', () => {
      expect(
        TimesheetWeekResponseSchema.safeParse({ timesheet: null }).success
      ).toBe(true);
      expect(
        TimesheetWeekResponseSchema.safeParse({
          timesheet: { ...validTimesheet, earnings: validOk },
        }).success
      ).toBe(true);
    });
  });
});
