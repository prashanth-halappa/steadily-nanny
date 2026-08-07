import { describe, expect, it } from 'bun:test';
import { MAX_MONEY_MINOR } from '../src/schemas/payArrangement.schema';
import {
  CreatePaymentSchema,
  PAYMENT_METHOD_NOTE_MAX,
  PaymentListResponseSchema,
  PaymentSchema,
} from '../src/schemas/payment.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T08:00:00Z';

describe('payment.schema', () => {
  describe('PaymentSchema', () => {
    const validPayment = {
      id: VALID_UUID,
      timesheet_id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      amount_minor: 48_000,
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
