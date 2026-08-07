import { describe, expect, it } from 'bun:test';
import {
  CreateExpenseRequestSchema,
  EXPENSE_KINDS,
  EXPENSE_STATUSES,
  ExpenseListResponseSchema,
  ExpenseSchema,
  ReviewExpenseRequestSchema,
  UpdateExpenseRequestSchema,
} from '../src/schemas/expense.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
/** A `household_members.id` — deliberately different from the carer's id. */
const MEMBER_UUID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-01T08:00:00Z';

describe('expense.schema', () => {
  describe('ExpenseSchema', () => {
    const validExpense = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      local_date: '2026-08-01',
      kind: EXPENSE_KINDS.EXPENSE,
      description: 'Museum tickets',
      amount_minor: 1200,
      miles: null,
      currency: 'GBP',
      status: EXPENSE_STATUSES.PENDING,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      carer_display_name: 'Nia Rowe',
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid pending expense row', () => {
      expect(ExpenseSchema.safeParse(validExpense).success).toBe(true);
    });

    it('parses a valid approved mileage row', () => {
      expect(
        ExpenseSchema.safeParse({
          ...validExpense,
          kind: EXPENSE_KINDS.MILEAGE,
          amount_minor: 450,
          miles: 10,
          status: EXPENSE_STATUSES.APPROVED,
          reviewed_by: VALID_UUID,
          reviewed_at: NOW,
        }).success
      ).toBe(true);
    });

    it('rejects a negative amount_minor', () => {
      expect(
        ExpenseSchema.safeParse({ ...validExpense, amount_minor: -1 }).success
      ).toBe(false);
    });

    it('rejects an empty description', () => {
      expect(
        ExpenseSchema.safeParse({ ...validExpense, description: '' }).success
      ).toBe(false);
    });

    it('rejects a bad currency code', () => {
      expect(
        ExpenseSchema.safeParse({ ...validExpense, currency: 'gbp' }).success
      ).toBe(false);
    });

    // Migration 058 — the same per-membership bucket key the timesheet and
    // time-entry rows carry. The parent's Hours screen filters approved
    // expenses by the SAME carer key it uses for the hours, so an expense row
    // that loses the key would fall out of a departed carer's statement.
    it('carries household_member_id through to the parsed row', () => {
      const parsed = ExpenseSchema.parse({
        ...validExpense,
        household_member_id: MEMBER_UUID,
      });
      expect(parsed.household_member_id).toBe(MEMBER_UUID);
    });

    it('accepts a row with no household_member_id at all (pre-058 data)', () => {
      expect(ExpenseSchema.safeParse(validExpense).success).toBe(true);
    });

    it('accepts a null household_member_id', () => {
      expect(
        ExpenseSchema.safeParse({ ...validExpense, household_member_id: null })
          .success
      ).toBe(true);
    });

    it('rejects a status outside the const-map', () => {
      expect(
        ExpenseSchema.safeParse({ ...validExpense, status: 'archived' }).success
      ).toBe(false);
    });
  });

  describe('CreateExpenseRequestSchema — discriminated union on kind', () => {
    it('parses a valid expense-kind request (amount_minor, no miles)', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.EXPENSE,
        local_date: '2026-08-01',
        description: 'Museum tickets',
        amount_minor: 1200,
      });
      expect(result.success).toBe(true);
    });

    it('parses a valid mileage-kind request (miles, no amount_minor)', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.MILEAGE,
        local_date: '2026-08-01',
        description: 'School run',
        miles: 12.5,
      });
      expect(result.success).toBe(true);
    });

    // Load-bearing: the client must not be able to send a mileage row
    // carrying its own amount — the amount is computed and frozen at
    // approval, server-side (TIER0-PLAN.md Phase 4 / docs/11-MONEY.md §9).
    it('REJECTS a mileage payload carrying amount_minor', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.MILEAGE,
        local_date: '2026-08-01',
        description: 'School run',
        miles: 12.5,
        amount_minor: 450,
      });
      expect(result.success).toBe(false);
    });

    it('rejects an expense payload without amount_minor', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.EXPENSE,
        local_date: '2026-08-01',
        description: 'Museum tickets',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an expense payload carrying miles', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.EXPENSE,
        local_date: '2026-08-01',
        description: 'Museum tickets',
        amount_minor: 1200,
        miles: 5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a mileage payload without miles', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.MILEAGE,
        local_date: '2026-08-01',
        description: 'School run',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a negative amount_minor on the expense variant', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.EXPENSE,
        local_date: '2026-08-01',
        description: 'Museum tickets',
        amount_minor: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects zero or negative miles on the mileage variant', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: 0,
        }).success
      ).toBe(false);
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: -2,
        }).success
      ).toBe(false);
    });

    // numeric(6,1) — the DB stores at most one decimal place; anything finer
    // would be silently truncated on write, so the wire pins the same
    // precision (docs/11-MONEY.md §1's "no silent lossy conversion" logic,
    // applied to miles rather than money).
    it('rejects miles with more than one decimal place', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: 12.567,
        }).success
      ).toBe(false);
    });

    it('accepts miles with exactly one decimal place', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: 12.5,
        }).success
      ).toBe(true);
    });

    // Phase 3/4 review, MINOR 11: `miles` had no upper bound at all, so
    // `123456.7` passed the wire schema and died in Postgres as a
    // `numeric(6,1)` overflow — a 500 on a typo. numeric(6,1) holds six
    // significant digits with one after the point, so 99999.9 is the largest
    // storable value and the wire now says so.
    it('accepts the numeric(6,1) maximum, 99999.9', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: 99999.9,
        }).success
      ).toBe(true);
    });

    it('rejects miles beyond numeric(6,1) rather than 500ing on overflow', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: 123456.7,
        }).success
      ).toBe(false);
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: 100000,
        }).success
      ).toBe(false);
    });

    it('rejects an empty description', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.EXPENSE,
          local_date: '2026-08-01',
          description: '',
          amount_minor: 1200,
        }).success
      ).toBe(false);
    });

    it('rejects a bad currency code', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.EXPENSE,
          local_date: '2026-08-01',
          description: 'Museum tickets',
          amount_minor: 1200,
          currency: 'gbp',
        }).success
      ).toBe(false);
    });

    it('defaults currency to GBP', () => {
      const result = CreateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.EXPENSE,
        local_date: '2026-08-01',
        description: 'Museum tickets',
        amount_minor: 1200,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe('GBP');
      }
    });
  });

  describe('UpdateExpenseRequestSchema', () => {
    it('parses a valid expense-kind update, same shape as create', () => {
      expect(
        UpdateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.EXPENSE,
          local_date: '2026-08-01',
          description: 'Museum tickets, corrected',
          amount_minor: 1500,
        }).success
      ).toBe(true);
    });

    it('rejects a mileage update carrying amount_minor, same as create', () => {
      expect(
        UpdateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.MILEAGE,
          local_date: '2026-08-01',
          description: 'School run',
          miles: 12.5,
          amount_minor: 450,
        }).success
      ).toBe(false);
    });

    it('does not accept a status field (a carer edit never changes review status)', () => {
      const result = UpdateExpenseRequestSchema.safeParse({
        kind: EXPENSE_KINDS.EXPENSE,
        local_date: '2026-08-01',
        description: 'Museum tickets',
        amount_minor: 1200,
        status: EXPENSE_STATUSES.APPROVED,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ReviewExpenseRequestSchema', () => {
    it('accepts status approved', () => {
      expect(
        ReviewExpenseRequestSchema.safeParse({
          status: EXPENSE_STATUSES.APPROVED,
        }).success
      ).toBe(true);
    });

    it('accepts status rejected with a review_note', () => {
      expect(
        ReviewExpenseRequestSchema.safeParse({
          status: EXPENSE_STATUSES.REJECTED,
          review_note: 'Not a household expense',
        }).success
      ).toBe(true);
    });

    it('rejects status pending — review can only approve or reject', () => {
      expect(
        ReviewExpenseRequestSchema.safeParse({
          status: EXPENSE_STATUSES.PENDING,
        }).success
      ).toBe(false);
    });

    it('rejects a missing status', () => {
      expect(
        ReviewExpenseRequestSchema.safeParse({
          review_note: 'Not a household expense',
        }).success
      ).toBe(false);
    });
  });

  // F-B2-6 — `amount_minor` had a floor and no ceiling. 99_999_999 minor
  // (£999,999.99) is the same bound mobile's `parseMajorToMinor` enforces and
  // migration 063 pins as a DB CHECK. Same reasoning as `MAX_MILES` above: the
  // wire accepts exactly what the rest of the stack can hold, no more.
  describe('amount_minor cap (F-B2-6)', () => {
    const MAX_MINOR = 99_999_999;

    const validExpense = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      local_date: '2026-08-01',
      kind: EXPENSE_KINDS.EXPENSE,
      description: 'Museum tickets',
      amount_minor: 1200,
      miles: null,
      currency: 'GBP',
      status: EXPENSE_STATUSES.PENDING,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      carer_display_name: 'Nia Rowe',
      created_at: NOW,
      updated_at: NOW,
    };

    it('ExpenseSchema accepts amount_minor at the cap, 99_999_999', () => {
      expect(
        ExpenseSchema.safeParse({ ...validExpense, amount_minor: MAX_MINOR })
          .success
      ).toBe(true);
    });

    it('ExpenseSchema rejects amount_minor above the cap, 100_000_000', () => {
      expect(
        ExpenseSchema.safeParse({
          ...validExpense,
          amount_minor: MAX_MINOR + 1,
        }).success
      ).toBe(false);
    });

    it('CreateExpenseRequestSchema accepts amount_minor at the cap, 99_999_999', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.EXPENSE,
          local_date: '2026-08-01',
          description: 'Museum tickets',
          amount_minor: MAX_MINOR,
        }).success
      ).toBe(true);
    });

    it('CreateExpenseRequestSchema rejects amount_minor above the cap, 100_000_000', () => {
      expect(
        CreateExpenseRequestSchema.safeParse({
          kind: EXPENSE_KINDS.EXPENSE,
          local_date: '2026-08-01',
          description: 'Museum tickets',
          amount_minor: MAX_MINOR + 1,
        }).success
      ).toBe(false);
    });
  });

  describe('ExpenseListResponseSchema', () => {
    it('parses an empty list', () => {
      expect(
        ExpenseListResponseSchema.safeParse({ expenses: [] }).success
      ).toBe(true);
    });

    it('parses a list of expenses', () => {
      expect(
        ExpenseListResponseSchema.safeParse({
          expenses: [
            {
              id: VALID_UUID,
              household_id: VALID_UUID,
              carer_id: VALID_UUID,
              local_date: '2026-08-01',
              kind: EXPENSE_KINDS.EXPENSE,
              description: 'Museum tickets',
              amount_minor: 1200,
              miles: null,
              currency: 'GBP',
              status: EXPENSE_STATUSES.PENDING,
              reviewed_by: null,
              reviewed_at: null,
              review_note: null,
              carer_display_name: 'Nia Rowe',
              created_at: NOW,
              updated_at: NOW,
            },
          ],
        }).success
      ).toBe(true);
    });
  });
});
