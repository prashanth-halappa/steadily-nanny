/**
 * The parent's approval-time adjustment — wire contract only.
 *
 * The FIRST test in this file is the one that matters most: a frozen snapshot
 * written before this feature existed carries no `adjustment` key, and it is
 * re-parsed through `WeekEarningsSchema` on every read. If that parse ever
 * starts failing, every already-approved week in production silently degrades
 * to `hours_only`. Everything else here is ordinary boundary checking.
 */
import { describe, expect, it } from 'bun:test';
import { MAX_MONEY_MINOR } from '../src/schemas/payArrangement.schema';
import {
  ApproveTimesheetSchema,
  EARNINGS_LINE_KINDS,
  EARNINGS_RESULT_STATUSES,
  TIMESHEET_ADJUSTMENT_NOTE_MAX,
  TimesheetAdjustmentSchema,
  WeekEarningsSchema,
} from '../src/schemas/timesheet.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

/** Byte-for-byte the shape migration 042 froze — no `adjustment` key. */
const legacyFrozenSnapshot = {
  status: EARNINGS_RESULT_STATUSES.OK,
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [
    {
      kind: EARNINGS_LINE_KINDS.REGULAR,
      minutes: 2400,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 74000,
      from_date: '2026-08-03',
      to_date: '2026-08-07',
      arrangement_id: VALID_UUID,
    },
  ],
  gross_minor: 74000,
  reimbursements_minor: 0,
  worked_minutes: 2400,
  payable_minutes: 2400,
  guaranteed_minutes_per_week: null,
};

const validAdjustment = {
  amount_minor: -2000,
  note: 'Advance repaid',
  created_by: VALID_UUID,
  created_at: '2026-08-10T09:00:00.000Z',
};

describe('WeekEarningsSchema — backward compatibility', () => {
  it('parses a legacy frozen snapshot that has no `adjustment` key', () => {
    const parsed = WeekEarningsSchema.safeParse(legacyFrozenSnapshot);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.status === 'ok') {
      expect(parsed.data.adjustment).toBeUndefined();
    }
  });

  it('parses a snapshot with an explicit null adjustment', () => {
    const parsed = WeekEarningsSchema.safeParse({
      ...legacyFrozenSnapshot,
      adjustment: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('round-trips a snapshot carrying an adjustment', () => {
    const snapshot = {
      ...legacyFrozenSnapshot,
      gross_minor: 72000,
      adjustment: validAdjustment,
    };
    const parsed = WeekEarningsSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.status === 'ok') {
      expect(parsed.data.adjustment).toEqual(validAdjustment);
    }
  });

  it('rejects a snapshot whose adjustment is malformed', () => {
    const parsed = WeekEarningsSchema.safeParse({
      ...legacyFrozenSnapshot,
      adjustment: { ...validAdjustment, amount_minor: 0 },
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps gross_minor non-negative even with a deduction present', () => {
    const parsed = WeekEarningsSchema.safeParse({
      ...legacyFrozenSnapshot,
      gross_minor: -1,
      adjustment: validAdjustment,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('TimesheetAdjustmentSchema', () => {
  it('accepts a negative amount — the deduction case', () => {
    expect(TimesheetAdjustmentSchema.safeParse(validAdjustment).success).toBe(
      true
    );
  });

  it('accepts a positive amount — the bonus case', () => {
    expect(
      TimesheetAdjustmentSchema.safeParse({
        ...validAdjustment,
        amount_minor: 1500,
      }).success
    ).toBe(true);
  });

  it('refuses zero', () => {
    expect(
      TimesheetAdjustmentSchema.safeParse({
        ...validAdjustment,
        amount_minor: 0,
      }).success
    ).toBe(false);
  });

  it('accepts exactly ±MAX_MONEY_MINOR and refuses one beyond', () => {
    for (const amount of [MAX_MONEY_MINOR, -MAX_MONEY_MINOR]) {
      expect(
        TimesheetAdjustmentSchema.safeParse({
          ...validAdjustment,
          amount_minor: amount,
        }).success
      ).toBe(true);
    }
    for (const amount of [MAX_MONEY_MINOR + 1, -MAX_MONEY_MINOR - 1]) {
      expect(
        TimesheetAdjustmentSchema.safeParse({
          ...validAdjustment,
          amount_minor: amount,
        }).success
      ).toBe(false);
    }
  });

  it('refuses a fractional amount — minor units are integers', () => {
    expect(
      TimesheetAdjustmentSchema.safeParse({
        ...validAdjustment,
        amount_minor: 12.5,
      }).success
    ).toBe(false);
  });

  it('trims the note and refuses a whitespace-only one', () => {
    const parsed = TimesheetAdjustmentSchema.safeParse({
      ...validAdjustment,
      note: '  Late bus fare  ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.note).toBe('Late bus fare');

    expect(
      TimesheetAdjustmentSchema.safeParse({ ...validAdjustment, note: '   ' })
        .success
    ).toBe(false);
  });

  it('refuses a note longer than the max', () => {
    expect(
      TimesheetAdjustmentSchema.safeParse({
        ...validAdjustment,
        note: 'x'.repeat(TIMESHEET_ADJUSTMENT_NOTE_MAX),
      }).success
    ).toBe(true);
    expect(
      TimesheetAdjustmentSchema.safeParse({
        ...validAdjustment,
        note: 'x'.repeat(TIMESHEET_ADJUSTMENT_NOTE_MAX + 1),
      }).success
    ).toBe(false);
  });

  it('allows a null created_by (033 — the carer/parent record outlives the account)', () => {
    expect(
      TimesheetAdjustmentSchema.safeParse({
        ...validAdjustment,
        created_by: null,
      }).success
    ).toBe(true);
  });
});

describe('ApproveTimesheetSchema', () => {
  it('accepts an empty body — every pre-existing client posts nothing', () => {
    const parsed = ApproveTimesheetSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.adjustment).toBeUndefined();
  });

  it('accepts an explicit null adjustment', () => {
    expect(ApproveTimesheetSchema.safeParse({ adjustment: null }).success).toBe(
      true
    );
  });

  it('accepts amount + note, and nothing else is required', () => {
    const parsed = ApproveTimesheetSchema.safeParse({
      adjustment: { amount_minor: -2000, note: 'Advance repaid' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.adjustment).toEqual({
        amount_minor: -2000,
        note: 'Advance repaid',
      });
    }
  });

  it('ignores a client-supplied created_by — the server stamps it', () => {
    const parsed = ApproveTimesheetSchema.safeParse({
      adjustment: {
        amount_minor: 500,
        note: 'Bonus',
        created_by: VALID_UUID,
        created_at: '2020-01-01T00:00:00.000Z',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.adjustment).toEqual({
        amount_minor: 500,
        note: 'Bonus',
      });
    }
  });

  it('rejects zero, an over-max amount, and an empty note', () => {
    for (const adjustment of [
      { amount_minor: 0, note: 'Nothing' },
      { amount_minor: MAX_MONEY_MINOR + 1, note: 'Too big' },
      { amount_minor: -MAX_MONEY_MINOR - 1, note: 'Too small' },
      { amount_minor: 100, note: '' },
      {
        amount_minor: 100,
        note: 'x'.repeat(TIMESHEET_ADJUSTMENT_NOTE_MAX + 1),
      },
    ]) {
      expect(ApproveTimesheetSchema.safeParse({ adjustment }).success).toBe(
        false
      );
    }
  });
});
