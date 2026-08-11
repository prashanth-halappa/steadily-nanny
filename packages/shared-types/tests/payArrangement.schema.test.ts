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
      valid_to: null,
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

    // No wire default (Phase 1, T4): an omitted currency stays undefined here
    // and is resolved server-side from the household row, not invented as
    // 'GBP' on the wire.
    it('accepts the minimal request with currency omitted', () => {
      const result =
        CreatePayArrangementRequestSchema.safeParse(minimalRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBeUndefined();
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

  // F-B2-6 — every money field needs an upper bound, not just a `.min(0)`.
  // 99_999_999 minor (£999,999.99) is the ceiling mobile's `parseMajorToMinor`
  // already refuses to exceed and migration 063 pins as a DB CHECK; the wire
  // has to agree with both or a fat-fingered rate sails past the edge and
  // fails at the bottom of the stack. See the schema's own comment.
  describe('money caps (F-B2-6)', () => {
    const MAX_MINOR = 99_999_999;

    const cappedEntityFields = [
      'rate_minor',
      'bill_rate_minor',
      'mileage_rate_per_mile_minor',
    ] as const;

    const baseArrangement = {
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
      valid_to: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      created_at: NOW,
    };

    for (const field of cappedEntityFields) {
      it(`PayArrangementSchema accepts ${field} at the cap, 99_999_999`, () => {
        expect(
          PayArrangementSchema.safeParse({
            ...baseArrangement,
            [field]: MAX_MINOR,
          }).success
        ).toBe(true);
      });

      it(`PayArrangementSchema rejects ${field} above the cap, 100_000_000`, () => {
        expect(
          PayArrangementSchema.safeParse({
            ...baseArrangement,
            [field]: MAX_MINOR + 1,
          }).success
        ).toBe(false);
      });
    }

    const cappedRequestFields = [
      'rate_minor',
      'mileage_rate_per_mile_minor',
    ] as const;

    for (const field of cappedRequestFields) {
      it(`CreatePayArrangementRequestSchema accepts ${field} at the cap, 99_999_999`, () => {
        expect(
          CreatePayArrangementRequestSchema.safeParse({
            rate_minor: 1850,
            valid_from: '2026-08-01',
            [field]: MAX_MINOR,
          }).success
        ).toBe(true);
      });

      it(`CreatePayArrangementRequestSchema rejects ${field} above the cap, 100_000_000`, () => {
        expect(
          CreatePayArrangementRequestSchema.safeParse({
            rate_minor: 1850,
            valid_from: '2026-08-01',
            [field]: MAX_MINOR + 1,
          }).success
        ).toBe(false);
      });
    }

    // Minutes are not money. A year's PTO entitlement or a guaranteed week is
    // measured in minutes and has no business borrowing money's ceiling.
    it('does not cap the minutes fields', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...baseArrangement,
          guaranteed_minutes_per_week: MAX_MINOR + 1,
          pto_entitlement_minutes_per_year: MAX_MINOR + 1,
        }).success
      ).toBe(true);
    });
  });

  // The column is `numeric(3, 2)` (041_pay_arrangements.sql:89) with only a
  // `>= 1` check — no upper bound anywhere. So the wire was the last chance to
  // catch both halves: a value too big for the column (Postgres answers with an
  // untyped "numeric field overflow", a 500), and a value too precise for it
  // (Postgres silently ROUNDS 1.555 to 1.56 — a pay multiplier changing itself
  // behind the client's back, which is exactly what docs/11-MONEY.md §1 forbids
  // for money).
  describe('overtime_multiplier bounds', () => {
    const baseArrangement = {
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
      valid_to: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      created_at: NOW,
    };

    const minimalRequest = { rate_minor: 1850, valid_from: '2026-08-01' };

    const accepted = [1, 1.5, 1.25, 8.88, 9.99];
    const rejected = [1e9, 10, 1.555, 1.001, 0.99];

    for (const overtime_multiplier of accepted) {
      it(`PayArrangementSchema accepts ${overtime_multiplier}`, () => {
        expect(
          PayArrangementSchema.safeParse({
            ...baseArrangement,
            overtime_multiplier,
          }).success
        ).toBe(true);
      });

      it(`CreatePayArrangementRequestSchema accepts ${overtime_multiplier}`, () => {
        expect(
          CreatePayArrangementRequestSchema.safeParse({
            ...minimalRequest,
            overtime_multiplier,
          }).success
        ).toBe(true);
      });
    }

    for (const overtime_multiplier of rejected) {
      it(`PayArrangementSchema rejects ${overtime_multiplier}`, () => {
        expect(
          PayArrangementSchema.safeParse({
            ...baseArrangement,
            overtime_multiplier,
          }).success
        ).toBe(false);
      });

      it(`CreatePayArrangementRequestSchema rejects ${overtime_multiplier}`, () => {
        expect(
          CreatePayArrangementRequestSchema.safeParse({
            ...minimalRequest,
            overtime_multiplier,
          }).success
        ).toBe(false);
      });
    }

    // 8.88 is the reason the precision check is an epsilon comparison and not
    // `z.multipleOf(0.01)`: 8.88 / 0.01 is 887.9999999999999 in binary floating
    // point, so `multipleOf` rejects a perfectly storable two-decimal
    // multiplier. It is in the accepted list above; this pins WHY.
    it('accepts 8.88, which a naive multipleOf(0.01) check would reject', () => {
      expect(Number.isInteger(8.88 / 0.01)).toBe(false);
      expect(
        CreatePayArrangementRequestSchema.safeParse({
          ...minimalRequest,
          overtime_multiplier: 8.88,
        }).success
      ).toBe(true);
    });

    it('still defaults overtime_multiplier to 1.5', () => {
      const result =
        CreatePayArrangementRequestSchema.safeParse(minimalRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.overtime_multiplier).toBe(1.5);
      }
    });
  });

  // Phase 1, T9 storage: an opaque documentary-terms bag (notice period,
  // probation, duties scope, ...). Passthrough only this build — nothing
  // prices it, nothing reads it but the wire contract, and the typed shape
  // comes with the terms UI (3-U1).
  describe('terms (Phase 1, T9 storage)', () => {
    const validArrangement = {
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
      valid_to: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      created_at: NOW,
    };

    it('PayArrangementSchema roundtrips a nested terms object', () => {
      const terms = {
        notice_period_days: 14,
        probation: { length_days: 90, notes: 'standard' },
        driving_required: false,
      };
      const result = PayArrangementSchema.safeParse({
        ...validArrangement,
        terms,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.terms).toEqual(terms);
      }
    });

    // `.optional()`, not `.default({})` — same reasoning as `v` in
    // timesheet.schema.ts (Phase 1, T3): a zod default makes the INFERRED
    // TYPE required, which would force `terms` onto every `PayArrangement`
    // fixture repo-wide. A live row always carries `{}` (the column's own
    // `not null default`); this only governs a fixture/pre-076 payload that
    // omits the field.
    it('accepts terms omitted — a live row always has one, this only governs a fixture or pre-076 payload', () => {
      const result = PayArrangementSchema.safeParse(validArrangement);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.terms).toBeUndefined();
      }
    });

    it('CreatePayArrangementRequestSchema accepts a passthrough terms object, preserved verbatim', () => {
      const terms = { notice_period_days: 14 };
      const result = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 1850,
        valid_from: '2026-08-01',
        terms,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.terms).toEqual(terms);
      }
    });

    it('CreatePayArrangementRequestSchema accepts terms omitted (server resolves the {} write)', () => {
      const result = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 1850,
        valid_from: '2026-08-01',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.terms).toBeUndefined();
      }
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
              valid_to: null,
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

  // ==========================================================================
  // The worked-holiday premium (080, 3-E4, §5 D-12). ONE column on the
  // arrangement, not the household: the calendar is the family's, but what a
  // worked holiday PAYS is a term of this carer's employment and a second
  // carer may have a different one (`screens-pay-terms.md` §4.3).
  // ==========================================================================
  describe('worked_holiday_multiplier (080)', () => {
    const base = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      rate_minor: 2800,
      bill_rate_minor: null,
      currency: 'USD',
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: null,
      pto_entitlement_minutes_per_year: null,
      mileage_rate_per_mile_minor: null,
      cancellation_paid_within_hours: null,
      valid_from: '2026-08-01',
      valid_to: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      // The `.000Z` serialisation here, the `+00:00` one in the 078 block
      // below — both forms of the same instant appear across this repo's
      // fixtures and both must parse (GOLDEN-FIXES #25).
      created_at: '2026-08-01T08:00:00.000Z',
    };

    it('parses an arrangement carrying the premium', () => {
      const parsed = PayArrangementSchema.safeParse({
        ...base,
        worked_holiday_multiplier: 1.5,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.worked_holiday_multiplier).toBe(1.5);
    });

    it('parses a PRE-080 row that omits it — no premium, which is the terms it was agreed under', () => {
      const parsed = PayArrangementSchema.safeParse(base);
      expect(parsed.success).toBe(true);
      expect(
        parsed.success && parsed.data.worked_holiday_multiplier
      ).toBeUndefined();
    });

    it('accepts null — an explicit "a worked holiday pays the normal rate"', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...base,
          worked_holiday_multiplier: null,
        }).success
      ).toBe(true);
    });

    it('holds it to the same numeric(3,2) bounds as every other multiplier', () => {
      // Below 1 would be a "premium" that pays LESS for working a holiday.
      expect(
        PayArrangementSchema.safeParse({
          ...base,
          worked_holiday_multiplier: 0.9,
        }).success
      ).toBe(false);
      // Above what numeric(3,2) holds — Postgres 500s on overflow.
      expect(
        PayArrangementSchema.safeParse({
          ...base,
          worked_holiday_multiplier: 10,
        }).success
      ).toBe(false);
      // Three decimals: numeric(3,2) ROUNDS silently, the lossy conversion
      // docs/11-MONEY.md §1 exists to prevent.
      expect(
        PayArrangementSchema.safeParse({
          ...base,
          worked_holiday_multiplier: 1.555,
        }).success
      ).toBe(false);
      expect(
        PayArrangementSchema.safeParse({
          ...base,
          worked_holiday_multiplier: 2,
        }).success
      ).toBe(true);
    });

    it('accepts it on a create request, with NO wire default', () => {
      const parsed = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 2800,
        currency: 'USD',
        valid_from: '2026-08-01',
        worked_holiday_multiplier: 1.5,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.worked_holiday_multiplier).toBe(1.5);

      // Omitted must stay omitted. A default of 1.5 here would promise every
      // family a holiday premium nobody agreed to — the same D-7 liability
      // the 078 tiers refuse a default for.
      const omitted = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 2800,
        currency: 'USD',
        valid_from: '2026-08-01',
      });
      expect(omitted.success).toBe(true);
      expect(
        omitted.success && omitted.data.worked_holiday_multiplier
      ).toBeUndefined();
    });
  });

  // ==========================================================================
  // The unworked-holiday credit (095, 3-E5, §5 D-53). The other half of the
  // holidays group: 080 says what a WORKED holiday pays, this says what an
  // UNWORKED observed one credits. Null = no credit, which is exactly the
  // behaviour every household had before this column existed.
  // ==========================================================================
  describe('holiday_hours_minutes (095)', () => {
    const base = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      rate_minor: 2800,
      bill_rate_minor: null,
      currency: 'USD',
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: null,
      pto_entitlement_minutes_per_year: null,
      mileage_rate_per_mile_minor: null,
      cancellation_paid_within_hours: null,
      valid_from: '2026-08-01',
      valid_to: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      // The `+00:00` serialisation here against the `.000Z` one in the 080
      // block above — both forms of the same instant appear across this
      // repo's fixtures and both must parse (GOLDEN-FIXES #25).
      created_at: '2026-08-01T08:00:00+00:00',
    };

    it('parses an arrangement carrying an 8h credit', () => {
      const parsed = PayArrangementSchema.safeParse({
        ...base,
        holiday_hours_minutes: 480,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.holiday_hours_minutes).toBe(480);
    });

    it('parses a PRE-095 row that omits it — no credit, the terms it was agreed under', () => {
      const parsed = PayArrangementSchema.safeParse(base);
      expect(parsed.success).toBe(true);
      expect(
        parsed.success && parsed.data.holiday_hours_minutes
      ).toBeUndefined();
    });

    it('accepts null — an explicit "an unworked holiday credits nothing"', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...base,
          holiday_hours_minutes: null,
        }).success
      ).toBe(true);
    });

    it('refuses zero and negatives — a credit of no hours is not a term', () => {
      // 095's CHECK is `> 0` for the same reason: null already says "no
      // credit", so a stored 0 would be a second spelling of the same
      // agreement, and the engine would have to guess which one meant it.
      for (const minutes of [0, -60]) {
        expect(
          PayArrangementSchema.safeParse({
            ...base,
            holiday_hours_minutes: minutes,
          }).success
        ).toBe(false);
      }
    });

    it('refuses a fractional minute — the column is an integer', () => {
      expect(
        PayArrangementSchema.safeParse({
          ...base,
          holiday_hours_minutes: 480.5,
        }).success
      ).toBe(false);
    });

    it('accepts it on a create request, with NO wire default', () => {
      const parsed = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 2800,
        currency: 'USD',
        valid_from: '2026-08-01',
        holiday_hours_minutes: 480,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.holiday_hours_minutes).toBe(480);

      // Omitted stays omitted. A default of 8h would promise every family a
      // paid holiday nobody agreed to — the same D-7 liability the 078 tiers
      // and 080's premium both refuse a default for.
      const omitted = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 2800,
        currency: 'USD',
        valid_from: '2026-08-01',
      });
      expect(omitted.success).toBe(true);
      expect(
        omitted.success && omitted.data.holiday_hours_minutes
      ).toBeUndefined();
    });
  });

  // ==========================================================================
  // The 078 tiers: daily overtime, daily double time, and the seventh
  // consecutive day. Five columns, all nullable, all optional on the wire.
  // ==========================================================================
  describe('daily tiers and the seventh day (078)', () => {
    const TIER_FIELDS = [
      'overtime_daily_threshold_minutes',
      'doubletime_daily_threshold_minutes',
      'doubletime_multiplier',
      'seventh_day_multiplier',
      'seventh_day_doubletime_after_minutes',
    ] as const;

    const base = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      rate_minor: 2800,
      bill_rate_minor: null,
      currency: 'USD',
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: null,
      pto_entitlement_minutes_per_year: null,
      mileage_rate_per_mile_minor: null,
      cancellation_paid_within_hours: null,
      valid_from: '2026-08-01',
      valid_to: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      // Both serialisations of the same instant appear across this repo's
      // fixtures (GOLDEN-FIXES #25); the offset form is the one the wire
      // schema is least often exercised with, so it is the one used here.
      created_at: '2026-08-01T08:00:00+00:00',
    };

    const withTiers = {
      ...base,
      overtime_daily_threshold_minutes: 480,
      doubletime_daily_threshold_minutes: 720,
      doubletime_multiplier: 2,
      seventh_day_multiplier: 1.5,
      seventh_day_doubletime_after_minutes: 480,
    };

    it('parses an arrangement carrying every tier', () => {
      const parsed = PayArrangementSchema.safeParse(withTiers);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data).toMatchObject({
        overtime_daily_threshold_minutes: 480,
        doubletime_daily_threshold_minutes: 720,
        doubletime_multiplier: 2,
        seventh_day_multiplier: 1.5,
        seventh_day_doubletime_after_minutes: 480,
      });
    });

    it('parses a PRE-078 row that omits all five — weekly overtime only', () => {
      const parsed = PayArrangementSchema.safeParse(base);
      expect(parsed.success).toBe(true);
      for (const field of TIER_FIELDS) {
        expect(parsed.success && parsed.data[field]).toBeUndefined();
      }
    });

    for (const field of TIER_FIELDS) {
      it(`accepts a null ${field} — an explicit "no such tier"`, () => {
        expect(
          PayArrangementSchema.safeParse({ ...withTiers, [field]: null })
            .success
        ).toBe(true);
      });
    }

    it('rejects a zero threshold — null means no tier, zero means nothing', () => {
      for (const field of [
        'overtime_daily_threshold_minutes',
        'doubletime_daily_threshold_minutes',
        'seventh_day_doubletime_after_minutes',
      ] as const) {
        expect(
          PayArrangementSchema.safeParse({ ...withTiers, [field]: 0 }).success
        ).toBe(false);
      }
    });

    it('holds the new multipliers to the same numeric(3,2) bounds as overtime_multiplier', () => {
      for (const field of [
        'doubletime_multiplier',
        'seventh_day_multiplier',
      ] as const) {
        // Below 1 would be a "premium" that pays LESS than the base rate.
        expect(
          PayArrangementSchema.safeParse({ ...withTiers, [field]: 0.9 }).success
        ).toBe(false);
        // Above what numeric(3,2) can hold — Postgres would 500 on overflow.
        expect(
          PayArrangementSchema.safeParse({ ...withTiers, [field]: 10 }).success
        ).toBe(false);
        // Three decimals: numeric(3,2) would silently ROUND, which is the
        // lossy conversion docs/11-MONEY.md §1 exists to prevent.
        expect(
          PayArrangementSchema.safeParse({ ...withTiers, [field]: 1.555 })
            .success
        ).toBe(false);
        expect(
          PayArrangementSchema.safeParse({ ...withTiers, [field]: 2 }).success
        ).toBe(true);
      }
    });

    it('accepts the tiers on a create request', () => {
      const parsed = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 2800,
        currency: 'USD',
        overtime_threshold_minutes: 2400,
        overtime_multiplier: 1.5,
        overtime_daily_threshold_minutes: 480,
        doubletime_daily_threshold_minutes: 720,
        doubletime_multiplier: 2,
        seventh_day_multiplier: 1.5,
        seventh_day_doubletime_after_minutes: 480,
        valid_from: '2026-08-01',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.doubletime_multiplier).toBe(2);
    });

    it('gives the tiers NO wire default — the app never invents a statutory term', () => {
      // `overtime_multiplier` defaults to 1.5 (a shape 041 already had). None
      // of these may: a default here would promise a family a daily-overtime
      // tier nobody agreed to, which is exactly the liability D-7's preset
      // posture exists to avoid. They arrive only when typed or preset-filled.
      const parsed = CreatePayArrangementRequestSchema.safeParse({
        rate_minor: 2800,
        valid_from: '2026-08-01',
      });
      expect(parsed.success).toBe(true);
      for (const field of TIER_FIELDS) {
        expect(parsed.success && parsed.data[field]).toBeUndefined();
      }
    });
  });
});
