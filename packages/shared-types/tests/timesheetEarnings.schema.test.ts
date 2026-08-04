import { describe, expect, it } from 'bun:test';
import {
  EARNINGS_LINE_KINDS,
  EARNINGS_LINE_ORDER,
  EARNINGS_RESULT_STATUSES,
  EarningsLineSchema,
  WeekEarningsSchema,
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
        'cancellation_paid',
        'pto',
        'guaranteed_topup',
        'reimbursements',
      ]);
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

    it('rejects an unknown line kind', () => {
      expect(
        EarningsLineSchema.safeParse({ ...validLine, kind: 'bonus' }).success
      ).toBe(false);
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
});
