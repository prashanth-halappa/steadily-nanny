import { describe, expect, it } from 'bun:test';
import {
  MarkTimeOffPaidRequestSchema,
  PTO_LEDGER_KINDS,
  PtoBalanceSchema,
  PtoLedgerEntrySchema,
  PtoLedgerListResponseSchema,
} from '../src/schemas/pto.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T08:00:00Z';

describe('pto.schema', () => {
  describe('PtoLedgerEntrySchema', () => {
    const validAccrual = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      kind: PTO_LEDGER_KINDS.ACCRUAL,
      minutes: 16800,
      effective_date: '2026-01-01',
      time_off_id: null,
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: VALID_UUID,
      created_at: NOW,
    };

    it('parses a valid accrual row (positive minutes)', () => {
      expect(PtoLedgerEntrySchema.safeParse(validAccrual).success).toBe(true);
    });

    it('parses a valid usage row with NEGATIVE minutes — usage is signed negative, not min(0)', () => {
      expect(
        PtoLedgerEntrySchema.safeParse({
          ...validAccrual,
          kind: PTO_LEDGER_KINDS.USAGE,
          minutes: -480,
          time_off_id: VALID_UUID,
        }).success
      ).toBe(true);
    });

    it('parses a valid adjustment row with negative minutes (a reconciling correction)', () => {
      expect(
        PtoLedgerEntrySchema.safeParse({
          ...validAccrual,
          kind: PTO_LEDGER_KINDS.ADJUSTMENT,
          minutes: -60,
        }).success
      ).toBe(true);
    });

    it('rejects zero minutes — the SQL has check (minutes <> 0)', () => {
      expect(
        PtoLedgerEntrySchema.safeParse({ ...validAccrual, minutes: 0 }).success
      ).toBe(false);
    });

    it('accepts a null carer_id (carer account deleted, ledger history preserved)', () => {
      expect(
        PtoLedgerEntrySchema.safeParse({ ...validAccrual, carer_id: null })
          .success
      ).toBe(true);
    });

    it('accepts a null time_off_id (accrual/adjustment rows are not tied to a specific time off)', () => {
      expect(
        PtoLedgerEntrySchema.safeParse({ ...validAccrual, time_off_id: null })
          .success
      ).toBe(true);
    });

    it('rejects a kind outside the const-map', () => {
      expect(
        PtoLedgerEntrySchema.safeParse({ ...validAccrual, kind: 'bonus' })
          .success
      ).toBe(false);
    });

    it('rejects a missing required field', () => {
      const { household_id: _household_id, ...rest } = validAccrual;
      expect(PtoLedgerEntrySchema.safeParse(rest).success).toBe(false);
    });
  });

  describe('PtoBalanceSchema', () => {
    const validBalance = {
      carer_id: VALID_UUID,
      household_id: VALID_UUID,
      year: 2026,
      entitlement_minutes: 16800,
      accrued_minutes: 16800,
      used_minutes: 12000,
      balance_minutes: 4800,
    };

    it('parses a valid balance', () => {
      expect(PtoBalanceSchema.safeParse(validBalance).success).toBe(true);
    });

    it('accepts a null entitlement_minutes (the arrangement sets none)', () => {
      expect(
        PtoBalanceSchema.safeParse({
          ...validBalance,
          entitlement_minutes: null,
        }).success
      ).toBe(true);
    });

    it('accepts a NEGATIVE balance_minutes — a household can mark more paid than granted, warned but never blocked', () => {
      expect(
        PtoBalanceSchema.safeParse({
          ...validBalance,
          used_minutes: 20000,
          balance_minutes: -3200,
        }).success
      ).toBe(true);
    });

    it('rejects a negative accrued_minutes', () => {
      expect(
        PtoBalanceSchema.safeParse({ ...validBalance, accrued_minutes: -1 })
          .success
      ).toBe(false);
    });

    it('rejects a negative used_minutes', () => {
      expect(
        PtoBalanceSchema.safeParse({ ...validBalance, used_minutes: -1 })
          .success
      ).toBe(false);
    });

    it('rejects a negative entitlement_minutes', () => {
      expect(
        PtoBalanceSchema.safeParse({
          ...validBalance,
          entitlement_minutes: -1,
        }).success
      ).toBe(false);
    });
  });

  describe('MarkTimeOffPaidRequestSchema', () => {
    it('parses a valid mark-paid request', () => {
      expect(
        MarkTimeOffPaidRequestSchema.safeParse({
          time_off_id: VALID_UUID,
          minutes: 480,
        }).success
      ).toBe(true);
    });

    it('accepts an optional note', () => {
      expect(
        MarkTimeOffPaidRequestSchema.safeParse({
          time_off_id: VALID_UUID,
          minutes: 480,
          note: 'half day',
        }).success
      ).toBe(true);
    });

    it('rejects zero minutes', () => {
      expect(
        MarkTimeOffPaidRequestSchema.safeParse({
          time_off_id: VALID_UUID,
          minutes: 0,
        }).success
      ).toBe(false);
    });

    it('rejects negative minutes', () => {
      expect(
        MarkTimeOffPaidRequestSchema.safeParse({
          time_off_id: VALID_UUID,
          minutes: -10,
        }).success
      ).toBe(false);
    });

    it('rejects a missing time_off_id', () => {
      expect(
        MarkTimeOffPaidRequestSchema.safeParse({ minutes: 480 }).success
      ).toBe(false);
    });
  });

  describe('PtoLedgerListResponseSchema', () => {
    it('parses an empty list', () => {
      expect(
        PtoLedgerListResponseSchema.safeParse({ pto_ledger_entries: [] })
          .success
      ).toBe(true);
    });

    it('parses a list of ledger entries', () => {
      expect(
        PtoLedgerListResponseSchema.safeParse({
          pto_ledger_entries: [
            {
              id: VALID_UUID,
              household_id: VALID_UUID,
              carer_id: VALID_UUID,
              kind: PTO_LEDGER_KINDS.USAGE,
              minutes: -480,
              effective_date: '2026-08-01',
              time_off_id: VALID_UUID,
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
