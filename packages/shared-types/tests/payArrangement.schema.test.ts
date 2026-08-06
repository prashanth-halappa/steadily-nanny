import { describe, expect, it } from 'bun:test';
import {
  CreatePayArrangementRequestSchema,
  PayArrangementListResponseSchema,
  PayArrangementSchema,
} from '../src/schemas/payArrangement.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
/** A `household_members.id` — deliberately different from the carer's id. */
const MEMBER_UUID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-01T08:00:00Z';

describe('payArrangement.schema', () => {
  describe('PayArrangementSchema', () => {
    const validArrangement = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      rate_minor: 1850,
      bill_rate_minor: null,
      currency: 'GBP',
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: null,
      pto_entitlement_minutes_per_year: null,
      mileage_rate_per_mile_minor: null,
      cancellation_paid_within_hours: 24,
      valid_from: '2026-08-01',
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      created_at: NOW,
    };

    it('parses a valid arrangement', () => {
      expect(PayArrangementSchema.safeParse(validArrangement).success).toBe(
        true
      );
    });

    // F4 (C1 round 2) — see pto.schema.test.ts's twin. 058 stamps
    // `pay_arrangements` as well, and an undeclared field is a stripped one.
    it('carries household_member_id through to the parsed row', () => {
      const parsed = PayArrangementSchema.parse({
        ...validArrangement,
        household_member_id: MEMBER_UUID,
      });
      expect(parsed.household_member_id).toBe(MEMBER_UUID);
    });

    it('accepts a row with no household_member_id (pre-058 data)', () => {
      expect(PayArrangementSchema.safeParse(validArrangement).success).toBe(
        true
      );
    });

    it('accepts a null carer_id (carer account deleted, payroll history preserved)', () => {
      expect(
        PayArrangementSchema.safeParse({ ...validArrangement, carer_id: null })
          .success
      ).toBe(true);
    });

    it('accepts null cancellation_paid_within_hours — an explicit "no cancellation pay" agreement, not the absence of one', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...validArrangement,
          cancellation_paid_within_hours: null,
        }).success
      ).toBe(true);
    });

    it('rejects a negative rate_minor', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...validArrangement,
          rate_minor: -1,
        }).success
      ).toBe(false);
    });

    it('rejects a 2-character currency', () => {
      expect(
        PayArrangementSchema.safeParse({ ...validArrangement, currency: 'GB' })
          .success
      ).toBe(false);
    });

    // A length check alone let "ab1", "gbp" and "£  " through, all of which
    // are three characters and none of which is an ISO-4217 code. The code
    // is not decoration: `formatMoney` feeds it straight to
    // `Intl.NumberFormat`, and the DB check constraint in
    // 041_pay_arrangements.sql now pins the same shape, so a row that parses
    // here is a row that can be stored and rendered.
    it('accepts a well-formed uppercase ISO-4217 code', () => {
      for (const currency of ['GBP', 'EUR', 'USD']) {
        expect(
          PayArrangementSchema.safeParse({ ...validArrangement, currency })
            .success
        ).toBe(true);
      }
    });

    it('rejects a currency code containing a digit', () => {
      expect(
        PayArrangementSchema.safeParse({ ...validArrangement, currency: 'ab1' })
          .success
      ).toBe(false);
      expect(
        PayArrangementSchema.safeParse({ ...validArrangement, currency: 'GB1' })
          .success
      ).toBe(false);
    });

    it('rejects a lowercase currency code rather than silently upcasing it', () => {
      expect(
        PayArrangementSchema.safeParse({ ...validArrangement, currency: 'gbp' })
          .success
      ).toBe(false);
    });

    it('rejects three non-letter characters', () => {
      expect(
        PayArrangementSchema.safeParse({ ...validArrangement, currency: '   ' })
          .success
      ).toBe(false);
    });

    it('rejects a zero cancellation_paid_within_hours — a window of zero hours is not a valid agreement, only null is', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...validArrangement,
          cancellation_paid_within_hours: 0,
        }).success
      ).toBe(false);
    });

    it('rejects an overtime_multiplier below 1', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...validArrangement,
          overtime_multiplier: 0.9,
        }).success
      ).toBe(false);
    });

    it('rejects a zero overtime_threshold_minutes (null means no overtime, not zero)', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...validArrangement,
          overtime_threshold_minutes: 0,
        }).success
      ).toBe(false);
    });

    it(// Future-dated arrangements are rejected by the SERVICE layer
    // (household-local "today" check, TIER0-PLAN.md owner decision 4),
    // never by this schema — the schema only knows the shape of an ISO
    // date, not what "today" means for a household's timezone. Any valid
    // ISO date, past or future, parses here.
    'accepts a future-dated valid_from — that rejection is service-side, not schema-side', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...validArrangement,
          valid_from: '2099-01-01',
        }).success
      ).toBe(true);
    });

    it('rejects a missing required field', () => {
      const { rate_minor: _rate_minor, ...rest } = validArrangement;
      expect(PayArrangementSchema.safeParse(rest).success).toBe(false);
    });
  });

  describe('CreatePayArrangementRequestSchema', () => {
    const minimalRequest = {
      rate_minor: 1850,
      valid_from: '2026-08-01',
    };

    it('accepts the minimal request and defaults currency to GBP', () => {
      const result =
        CreatePayArrangementRequestSchema.safeParse(minimalRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe('GBP');
      }
    });

    it('accepts the full field set', () => {
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          rate_minor: 1850,
          currency: 'EUR',
          overtime_threshold_minutes: 2400,
          overtime_multiplier: 1.5,
          guaranteed_minutes_per_week: 1200,
          pto_entitlement_minutes_per_year: 16800,
          mileage_rate_per_mile_minor: 45,
          cancellation_paid_within_hours: 24,
          valid_from: '2026-08-01',
          note: 'annual review',
        }).success
      ).toBe(true);
    });

    it('rejects a missing rate_minor', () => {
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          valid_from: '2026-08-01',
        }).success
      ).toBe(false);
    });

    it('rejects a missing valid_from', () => {
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          rate_minor: 1850,
        }).success
      ).toBe(false);
    });

    it('does not accept a client-supplied carer_display_name (server derives it)', () => {
      const result = CreatePayArrangementRequestSchema.safeParse({
        ...minimalRequest,
        carer_display_name: 'Nia Rowe',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect('carer_display_name' in result.data).toBe(false);
      }
    });

    it('does not accept a client-supplied bill_rate_minor (dormant until Tier 2 invoicing)', () => {
      const result = CreatePayArrangementRequestSchema.safeParse({
        ...minimalRequest,
        bill_rate_minor: 2000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect('bill_rate_minor' in result.data).toBe(false);
      }
    });

    it('rejects a zero cancellation_paid_within_hours', () => {
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          ...minimalRequest,
          cancellation_paid_within_hours: 0,
        }).success
      ).toBe(false);
    });

    it('rejects an overtime_multiplier below 1', () => {
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          ...minimalRequest,
          overtime_multiplier: 0.5,
        }).success
      ).toBe(false);
    });

    // Same ISO-4217 shape as the entity schema — the write side is where a
    // bad code would actually get stored, so it is the half that matters
    // most. Uppercase only: the client sends what the DB check constraint
    // accepts, rather than relying on a server-side upcast that does not
    // exist.
    it('accepts a well-formed uppercase ISO-4217 code', () => {
      const result = CreatePayArrangementRequestSchema.safeParse({
        ...minimalRequest,
        currency: 'EUR',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a currency code containing a digit', () => {
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          ...minimalRequest,
          currency: 'ab1',
        }).success
      ).toBe(false);
    });

    it('rejects a lowercase currency code', () => {
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          ...minimalRequest,
          currency: 'gbp',
        }).success
      ).toBe(false);
    });
  });

  describe('PayArrangementListResponseSchema', () => {
    it('parses an empty list', () => {
      expect(
        PayArrangementListResponseSchema.safeParse({ pay_arrangements: [] })
          .success
      ).toBe(true);
    });

    it('parses a list of arrangements', () => {
      expect(
        PayArrangementListResponseSchema.safeParse({
          pay_arrangements: [
            {
              id: VALID_UUID,
              household_id: VALID_UUID,
              carer_id: VALID_UUID,
              rate_minor: 1850,
              bill_rate_minor: null,
              currency: 'GBP',
              overtime_threshold_minutes: null,
              overtime_multiplier: 1.5,
              guaranteed_minutes_per_week: null,
              pto_entitlement_minutes_per_year: null,
              mileage_rate_per_mile_minor: null,
              cancellation_paid_within_hours: null,
              valid_from: '2026-08-01',
              carer_display_name: 'Nia Rowe',
              note: null,
              created_by: VALID_UUID,
              created_at: NOW,
            },
          ],
        }).success
      ).toBe(true);
    });
  });
});
