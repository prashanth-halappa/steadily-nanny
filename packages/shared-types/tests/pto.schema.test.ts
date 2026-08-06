import { describe, expect, it } from 'bun:test';
import {
  MarkTimeOffPaidRequestSchema,
  PTO_LEDGER_KINDS,
  PTO_LEDGER_NOTE_KEYS,
  PtoBalanceSchema,
  PtoLedgerEntrySchema,
  PtoLedgerListResponseSchema,
} from '../src/schemas/pto.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
/** A `household_members.id` — deliberately different from the carer's id. */
const MEMBER_UUID = '22222222-2222-4222-8222-222222222222';
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

    // F4 (C1 round 2). Migration 058 stamps `household_member_id` on
    // `pto_ledger` too, but a schema that does not declare it STRIPS it —
    // so these rows silently degraded to name-merging while the timesheet
    // and expense rows beside them kept their per-membership identity.
    it('carries household_member_id through to the parsed row', () => {
      const parsed = PtoLedgerEntrySchema.parse({
        ...validAccrual,
        household_member_id: MEMBER_UUID,
      });
      expect(parsed.household_member_id).toBe(MEMBER_UUID);
    });

    it('accepts a row with no household_member_id (pre-058 data)', () => {
      expect(PtoLedgerEntrySchema.safeParse(validAccrual).success).toBe(true);
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

    // Phase 3/4 review, BLOCKER 3: the request states the TOTAL minutes this
    // household is paying for the time off, not a delta, so zero is the
    // meaningful "unpay it entirely" instruction — a full reversal. It is not
    // a zero-minute ledger row (the SQL still forbids those); the service
    // turns it into an adjustment cancelling the netted total.
    it('accepts ZERO minutes — a full reversal of an existing marking', () => {
      expect(
        MarkTimeOffPaidRequestSchema.safeParse({
          time_off_id: VALID_UUID,
          minutes: 0,
        }).success
      ).toBe(true);
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

// Phase 3/4 review, finding 16a: `pto_ledger` is append-only and permanent,
// so a system-written `note` must be a stable machine key — English prose
// stored today could never be re-keyed when the ledger history is localised,
// and every existing row would be orphaned. Wave 5's handoff chips are the
// precedent (PROJECT-STATUS.md); the shape is theirs: bare snake_case keys,
// with an unknown value rendered verbatim so a parent's own typed note (user
// content, never keyed) still reads as itself.
describe('PTO_LEDGER_NOTE_KEYS', () => {
  it('declares a key for every note the server writes', () => {
    expect(PTO_LEDGER_NOTE_KEYS).toEqual({
      ANNUAL_GRANT: 'annual_grant',
      MARKED_PAID_ADJUSTED: 'marked_paid_adjusted',
      CANCELLED_TIME_OFF_REVERSED: 'cancelled_time_off_reversed',
      CANCELLED_DURING_MARKING_REVERSED: 'cancelled_during_marking_reversed',
    });
  });

  it('every value is stable snake_case — no prose, no punctuation, no locale', () => {
    for (const key of Object.values(PTO_LEDGER_NOTE_KEYS)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('the values are unique, so a renderer can switch on them', () => {
    const values = Object.values(PTO_LEDGER_NOTE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});
