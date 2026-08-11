import { describe, expect, it } from 'bun:test';
import { MAX_MONEY_MINOR } from '../src/schemas/payArrangement.schema';
import {
  CreatePaymentCorrectionSchema,
  CreatePaymentSchema,
  PAYMENT_CORRECTION_REASON_MAX,
  PAYMENT_METHOD_NOTE_MAX,
  PaymentListResponseSchema,
  PaymentSchema,
} from '../src/schemas/payment.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-01T08:00:00Z';

describe('payment.schema', () => {
  describe('PaymentSchema', () => {
    const validPayment = {
      id: VALID_UUID,
      timesheet_id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      amount_minor: 48_000,
      kind: 'payment',
      corrects_payment_id: null,
      correction_reason: null,
      currency: 'GBP',
      paid_at: '2026-08-01',
      method_note: 'Bank transfer',
      recorded_by: VALID_UUID,
      created_at: NOW,
    };

    it('accepts a valid payment row', () => {
      expect(PaymentSchema.safeParse(validPayment).success).toBe(true);
    });

    it('keeps carer_id and recorded_by nullable — 033 discipline, the row outlives the account', () => {
      const result = PaymentSchema.safeParse({
        ...validPayment,
        carer_id: null,
        recorded_by: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a null method_note', () => {
      expect(
        PaymentSchema.safeParse({ ...validPayment, method_note: null }).success
      ).toBe(true);
    });

    it('rejects a zero amount — a payment of nothing is not a payment', () => {
      expect(
        PaymentSchema.safeParse({ ...validPayment, amount_minor: 0 }).success
      ).toBe(false);
    });

    it('rejects an amount above MAX_MONEY_MINOR — same wire ceiling as every money field', () => {
      expect(
        PaymentSchema.safeParse({
          ...validPayment,
          amount_minor: MAX_MONEY_MINOR + 1,
        }).success
      ).toBe(false);
      expect(
        PaymentSchema.safeParse({
          ...validPayment,
          amount_minor: MAX_MONEY_MINOR,
        }).success
      ).toBe(true);
    });

    it('rejects a non-integer amount — minor units are integers, never floats', () => {
      expect(
        PaymentSchema.safeParse({ ...validPayment, amount_minor: 100.5 })
          .success
      ).toBe(false);
    });

    it('rejects a lowercase or malformed currency code', () => {
      expect(
        PaymentSchema.safeParse({ ...validPayment, currency: 'gbp' }).success
      ).toBe(false);
      expect(
        PaymentSchema.safeParse({ ...validPayment, currency: 'GB1' }).success
      ).toBe(false);
    });

    it('rejects a datetime in paid_at — settlement is a calendar day, not an instant', () => {
      expect(
        PaymentSchema.safeParse({ ...validPayment, paid_at: NOW }).success
      ).toBe(false);
    });

    /**
     * D-20. `amount_minor` went from `min(1)` to a SIGNED bound so a
     * correction row can carry its reversal as a negative figure — which is
     * what makes paid-to-date one `sum(amount_minor)` everywhere instead of a
     * sign rule each read site has to remember.
     */
    describe('corrections (D-20)', () => {
      const validCorrection = {
        ...validPayment,
        id: OTHER_UUID,
        amount_minor: -46_200,
        kind: 'correction',
        corrects_payment_id: VALID_UUID,
        correction_reason: 'recorded twice',
        method_note: null,
      };

      it('accepts a correction row: negative amount, back-reference, reason', () => {
        expect(PaymentSchema.safeParse(validCorrection).success).toBe(true);
      });

      it('accepts the full negative ceiling and refuses one past it', () => {
        expect(
          PaymentSchema.safeParse({
            ...validCorrection,
            amount_minor: -MAX_MONEY_MINOR,
          }).success
        ).toBe(true);
        expect(
          PaymentSchema.safeParse({
            ...validCorrection,
            amount_minor: -MAX_MONEY_MINOR - 1,
          }).success
        ).toBe(false);
      });

      it('still refuses ZERO — relaxing min(1) must not admit a row for no money', () => {
        expect(
          PaymentSchema.safeParse({ ...validPayment, amount_minor: 0 }).success
        ).toBe(false);
        expect(
          PaymentSchema.safeParse({ ...validCorrection, amount_minor: 0 })
            .success
        ).toBe(false);
      });

      it('rejects a kind that is neither payment nor correction', () => {
        expect(
          PaymentSchema.safeParse({ ...validPayment, kind: 'adjustment' })
            .success
        ).toBe(false);
      });

      it('requires kind — an untagged row cannot be rendered as either', () => {
        const { kind: _omitted, ...rest } = validPayment;
        expect(PaymentSchema.safeParse(rest).success).toBe(false);
      });
    });
  });

  describe('CreatePaymentSchema', () => {
    const validCreate = {
      amount_minor: 48_000,
      paid_at: '2026-08-01',
      method_note: 'Bank transfer',
    };

    it('accepts a valid create body', () => {
      expect(CreatePaymentSchema.safeParse(validCreate).success).toBe(true);
    });

    it('accepts a body without method_note', () => {
      const { method_note: _omitted, ...rest } = validCreate;
      expect(CreatePaymentSchema.safeParse(rest).success).toBe(true);
    });

    it('has no currency field — the server stamps the timesheet frozen currency, the client never picks one', () => {
      const result = CreatePaymentSchema.safeParse({
        ...validCreate,
        currency: 'USD',
      });
      // Unknown keys are stripped, not stored: a smuggled currency must not survive parse.
      expect(result.success).toBe(true);
      if (result.success) {
        expect('currency' in result.data).toBe(false);
      }
    });

    it('rejects a method_note longer than PAYMENT_METHOD_NOTE_MAX', () => {
      expect(
        CreatePaymentSchema.safeParse({
          ...validCreate,
          method_note: 'x'.repeat(PAYMENT_METHOD_NOTE_MAX + 1),
        }).success
      ).toBe(false);
      expect(
        CreatePaymentSchema.safeParse({
          ...validCreate,
          method_note: 'x'.repeat(PAYMENT_METHOD_NOTE_MAX),
        }).success
      ).toBe(true);
    });

    it('rejects zero and over-cap amounts with the same bounds as the entity', () => {
      expect(
        CreatePaymentSchema.safeParse({ ...validCreate, amount_minor: 0 })
          .success
      ).toBe(false);
      expect(
        CreatePaymentSchema.safeParse({
          ...validCreate,
          amount_minor: MAX_MONEY_MINOR + 1,
        }).success
      ).toBe(false);
    });
  });

  /**
   * The WRITE side stays POSITIVE. The parent types "462.00" into a field
   * labelled "Amount to reverse"; the server negates it. Asking a human to
   * type a minus sign to un-record a payment is how a correction ends up
   * adding money to a week.
   */
  describe('CreatePaymentCorrectionSchema', () => {
    const validCorrection = {
      amount_minor: 46_200,
      paid_at: '2026-08-18',
      reason: 'recorded twice',
    };

    it('accepts a valid correction body', () => {
      expect(
        CreatePaymentCorrectionSchema.safeParse(validCorrection).success
      ).toBe(true);
    });

    it('REJECTS a negative amount — the wire carries a magnitude, not a sign', () => {
      expect(
        CreatePaymentCorrectionSchema.safeParse({
          ...validCorrection,
          amount_minor: -46_200,
        }).success
      ).toBe(false);
    });

    it('rejects zero and over-cap amounts, the same bounds as a payment', () => {
      expect(
        CreatePaymentCorrectionSchema.safeParse({
          ...validCorrection,
          amount_minor: 0,
        }).success
      ).toBe(false);
      expect(
        CreatePaymentCorrectionSchema.safeParse({
          ...validCorrection,
          amount_minor: MAX_MONEY_MINOR + 1,
        }).success
      ).toBe(false);
    });

    it('requires a reason, and refuses a whitespace-only one', () => {
      const { reason: _omitted, ...rest } = validCorrection;
      expect(CreatePaymentCorrectionSchema.safeParse(rest).success).toBe(false);
      expect(
        CreatePaymentCorrectionSchema.safeParse({
          ...validCorrection,
          reason: '   ',
        }).success
      ).toBe(false);
    });

    it('trims the reason it accepts, so the stored text has no stray padding', () => {
      const result = CreatePaymentCorrectionSchema.safeParse({
        ...validCorrection,
        reason: '  wrong week  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reason).toBe('wrong week');
      }
    });

    it('caps the reason at PAYMENT_CORRECTION_REASON_MAX', () => {
      expect(
        CreatePaymentCorrectionSchema.safeParse({
          ...validCorrection,
          reason: 'x'.repeat(PAYMENT_CORRECTION_REASON_MAX),
        }).success
      ).toBe(true);
      expect(
        CreatePaymentCorrectionSchema.safeParse({
          ...validCorrection,
          reason: 'x'.repeat(PAYMENT_CORRECTION_REASON_MAX + 1),
        }).success
      ).toBe(false);
    });

    it('strips a smuggled kind, currency or corrects_payment_id — the server stamps all three', () => {
      const result = CreatePaymentCorrectionSchema.safeParse({
        ...validCorrection,
        kind: 'payment',
        currency: 'USD',
        corrects_payment_id: OTHER_UUID,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data).sort()).toEqual([
          'amount_minor',
          'paid_at',
          'reason',
        ]);
      }
    });
  });

  describe('PaymentListResponseSchema', () => {
    it('wraps rows in a payments envelope', () => {
      const result = PaymentListResponseSchema.safeParse({ payments: [] });
      expect(result.success).toBe(true);
    });

    it('rejects a bare array — every list response in this app is an envelope', () => {
      expect(PaymentListResponseSchema.safeParse([]).success).toBe(false);
    });
  });
});
