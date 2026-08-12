/**
 * @module tests/unit/domains/timesheet/utils/weekExportCsv
 *
 * The payroll handoff artifact, pinned byte-for-byte. The mobile slice
 * downloads this file blind against the column contract in
 * `src/domains/timesheet/utils/weekExportCsv.ts` — so the assertion here is
 * the WHOLE body, not a spot check on a row.
 */
import { describe, expect, it } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import type {
  Timesheet,
  WeekEarningsOk,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  carerSlug,
  renderWeekExportCsv,
} from '../../../../../src/domains/timesheet/utils/weekExportCsv';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FIXTURE_SNAPSHOT_AT = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_PAYMENT_CREATED_MS = Date.now() - 3 * DAY_MS;
const FIXTURE_PAYMENT_CREATED_AT = new Date(FIXTURE_PAYMENT_CREATED_MS)
  .toISOString()
  .replace('.000Z', '+00:00');
const FIXTURE_DUPLICATE_CREATED_AT = new Date(
  FIXTURE_PAYMENT_CREATED_MS + 2 * DAY_MS
).toISOString();
const FIXTURE_CORRECTION_CREATED_AT = new Date(
  FIXTURE_PAYMENT_CREATED_MS + 2 * DAY_MS + 60_000
).toISOString();

/**
 * One recorded payment. The settlement rows are what make `paid_to_date_minor`
 * checkable rather than asserted — D-20 requires the export to carry the rows
 * AND the balance, never a netted figure alone.
 *
 * `created_at` in PostgREST's `+00:00` form here and `.000Z` on the correction
 * below, deliberately (GOLDEN #25): a fixture set written in one style proves
 * nothing about code that has to survive both.
 */
const PAID_30000: Payment = {
  id: 'pay-1',
  timesheet_id: 'ts-1',
  household_id: 'h-1',
  carer_id: 'carer-1',
  amount_minor: 30_000,
  kind: 'payment',
  corrects_payment_id: null,
  correction_reason: null,
  currency: 'GBP',
  paid_at: '2026-08-16',
  method_note: 'Zelle',
  recorded_by: 'parent-1',
  created_at: FIXTURE_PAYMENT_CREATED_AT,
};

/** A comma in the display name — the escaping case, on a real field. */
const timesheet: Timesheet = {
  id: 'ts-1',
  household_id: 'h-1',
  carer_id: 'carer-1',
  carer_display_name: 'Rowe, Nia',
  week_start: '2026-08-03',
  total_minutes: 2700,
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: FIXTURE_SNAPSHOT_AT,
  query_note: null,
  reopen_reason: null,
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: FIXTURE_SNAPSHOT_AT,
};

/** Every line kind the snapshot can hold, in EARNINGS_LINE_ORDER. */
const earnings: WeekEarningsOk = {
  status: 'ok',
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [
    {
      kind: 'regular',
      minutes: 2400,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 74_000,
      from_date: '2026-08-03',
      to_date: '2026-08-07',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      kind: 'overtime',
      minutes: 180,
      rate_minor: 2775,
      multiplier: 1.5,
      amount_minor: 8325,
      from_date: '2026-08-08',
      to_date: '2026-08-08',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      kind: 'doubletime',
      minutes: 120,
      rate_minor: 3700,
      multiplier: 2,
      amount_minor: 7400,
      from_date: '2026-08-09',
      to_date: '2026-08-09',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      // 3-E4. The UPLIFT alone: 1850 x 1.5 = 2775, minus the 1850 already
      // paid on the `regular` line = 925. These 480 minutes are the SAME
      // minutes counted in `regular` above — the one kind whose minutes are
      // not disjoint from the rest, which is exactly why David's §12.2
      // handoff wants `holiday_premium_minutes` in its own column and never
      // added into an hours total.
      kind: 'holiday_premium',
      minutes: 480,
      rate_minor: 925,
      multiplier: 1.5,
      amount_minor: 7400,
      from_date: '2026-08-06',
      to_date: '2026-08-06',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      kind: 'cancellation_paid',
      minutes: 240,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 7400,
      from_date: '2026-08-05',
      to_date: '2026-08-05',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      kind: 'pto',
      minutes: 480,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 14_800,
      from_date: '2026-08-06',
      to_date: '2026-08-06',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      kind: 'guaranteed_topup',
      minutes: 60,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 1850,
      from_date: '2026-08-03',
      to_date: '2026-08-09',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      kind: 'reimbursements',
      minutes: 0,
      rate_minor: 0,
      multiplier: null,
      amount_minor: 1250,
      from_date: '2026-08-04',
      to_date: '2026-08-04',
      arrangement_id: null,
    },
  ],
  gross_minor: 121_175,
  reimbursements_minor: 1250,
  worked_minutes: 2700,
  payable_minutes: 3420,
  guaranteed_minutes_per_week: 2400,
};

const CRLF = '\r\n';

/** The expected artifact, spelled out. Trailing terminator included. */
const EXPECTED_CSV =
  [
    'date,description,kind,minutes,rate_minor,amount_minor,currency',
    '2026-08-03,Regular hours (to 2026-08-07),regular,2400,1850,74000,GBP',
    '2026-08-08,Overtime at 1.5x,overtime,180,2775,8325,GBP',
    '2026-08-09,Double time at 2x,doubletime,120,3700,7400,GBP',
    '2026-08-06,Holiday premium at 1.5x,holiday_premium,480,925,7400,GBP',
    '2026-08-05,"Cancelled shift, paid",cancellation_paid,240,1850,7400,GBP',
    '2026-08-06,Paid time off,pto,480,1850,14800,GBP',
    '2026-08-03,Guaranteed hours top-up (to 2026-08-09),guaranteed_topup,60,1850,1850,GBP',
    '2026-08-04,Reimbursement,reimbursements,0,0,1250,GBP',
    '2026-08-16,Payment: Zelle,payment,,,30000,GBP',
    '',
    'total_gross_minor,121175',
    'reimbursements_minor,1250',
    'paid_to_date_minor,30000',
    'balance_due_minor,91175',
    'carer_display_name,"Rowe, Nia"',
    'week_start,2026-08-03',
    'currency,GBP',
    `approved_at,${FIXTURE_SNAPSHOT_AT}`,
  ].join(CRLF) + CRLF;

describe('renderWeekExportCsv — the rich fixture, byte for byte', () => {
  it('serialises the frozen snapshot to the exact expected body', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
    });

    expect(csv).toBe(EXPECTED_CSV);
  });

  it('names the file steadily-week-<week_start>-<carer-slug>.csv', () => {
    const { filename } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
    });

    expect(filename).toBe('steadily-week-2026-08-03-rowe-nia.csv');
  });

  it('balance_due_minor is gross minus paid — reimbursements are NOT wages (docs/11-MONEY.md §6)', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [],
    });

    expect(csv).toContain(`${CRLF}total_gross_minor,121175${CRLF}`);
    expect(csv).toContain(`${CRLF}paid_to_date_minor,0${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,121175${CRLF}`);
    // The reimbursement line's 1250 is in the rows but never in the gross.
    expect(csv).toContain(`${CRLF}reimbursements_minor,1250${CRLF}`);
  });

  it('emits amounts as integer minor units — never a formatted major-unit float', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
    });

    expect(csv).not.toContain('£');
    expect(csv).not.toContain('1137.75');
    expect(csv).not.toContain('740.00');
    // Every amount-bearing field is bare digits (a leading '-' allowed on the
    // balance): no symbol, no decimal point, no thousands separator.
    const rows = csv.split(CRLF).filter(row => row.length > 0);
    const summaryAmounts = rows
      .filter(row => /^[a-z_]+_minor,/.test(row))
      .map(row => row.split(',')[1]);
    expect(summaryAmounts).toHaveLength(4);
    for (const amount of summaryAmounts) {
      expect(amount).toMatch(/^-?\d+$/);
    }
    // Read the numeric columns from the END — only `description` can carry a
    // comma of its own. Settlement records are excluded here and checked
    // separately below: they are money, not time, so their `minutes` and
    // `rate_minor` are EMPTY (the adjustment's precedent) and a correction's
    // amount is signed.
    const dataRows = rows.filter(
      row =>
        /^\d{4}-\d{2}-\d{2},/.test(row) && !/,(payment|correction),/.test(row)
    );
    expect(dataRows).toHaveLength(8);
    for (const row of dataRows) {
      const fields = row.split(',');
      expect(fields.at(-1)).toBe('GBP');
      for (const column of [-2, -3, -4]) {
        expect(fields.at(column)).toMatch(/^\d+$/);
      }
    }
  });

  it('omits the approved_at row when the row has none', () => {
    const { csv } = renderWeekExportCsv({
      timesheet: { ...timesheet, approved_at: null },
      earnings,
      payments: [],
    });

    expect(csv).not.toContain('approved_at');
    expect(csv.endsWith(`currency,GBP${CRLF}`)).toBe(true);
  });

  it('emits header + separator + summary even when the snapshot has no lines', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: { ...earnings, lines: [], gross_minor: 0 },
      payments: [],
    });

    expect(csv.split(CRLF).slice(0, 3)).toEqual([
      'date,description,kind,minutes,rate_minor,amount_minor,currency',
      '',
      'total_gross_minor,0',
    ]);
  });
});

/**
 * A snapshot frozen by a NEWER server than the one rendering it — the export
 * route reads jsonb it did not write, and a kind this build has never heard of
 * must still reach the payroll provider rather than crashing the download.
 */
describe('renderWeekExportCsv — a line kind this build does not know', () => {
  const withUnknownKind: WeekEarningsOk = {
    ...earnings,
    lines: [
      ...earnings.lines,
      {
        kind: 'night_differential',
        minutes: 120,
        rate_minor: 2000,
        multiplier: null,
        amount_minor: 4000,
        from_date: '2026-08-07',
        to_date: '2026-08-07',
        arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    ],
  };

  it('humanizes the description and carries the kind column verbatim', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: withUnknownKind,
      payments: [PAID_30000],
    });

    expect(csv).toContain(
      `${CRLF}2026-08-07,Night differential,night_differential,120,2000,4000,GBP${CRLF}`
    );
  });

  it('changes no total — the summary reads the frozen figures, not the rows', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: withUnknownKind,
      payments: [PAID_30000],
    });

    expect(csv).toContain(`${CRLF}total_gross_minor,121175${CRLF}`);
    expect(csv).toContain(`${CRLF}reimbursements_minor,1250${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,91175${CRLF}`);
  });
});

/**
 * D-20's half of the export. The pair of rows IS the audit trail: the export
 * is what a payroll service and a dispute both read, and netting a correction
 * into its original destroys the only reason the correction was worth
 * building. David's incident — one Zelle transfer recorded twice — is the
 * fixture, deliberately.
 */
describe('renderWeekExportCsv — payments and corrections (D-20)', () => {
  /** The duplicate. Same money, entered again two days later. */
  const DUPLICATE: Payment = {
    ...PAID_30000,
    id: 'pay-2',
    paid_at: '2026-08-16',
    created_at: FIXTURE_DUPLICATE_CREATED_AT,
  };

  /** The reversal of the duplicate, in full. */
  const CORRECTION: Payment = {
    id: 'corr-1',
    timesheet_id: 'ts-1',
    household_id: 'h-1',
    carer_id: 'carer-1',
    amount_minor: -30_000,
    kind: 'correction',
    corrects_payment_id: 'pay-2',
    correction_reason: 'recorded twice',
    currency: 'GBP',
    paid_at: '2026-08-18',
    method_note: null,
    recorded_by: 'parent-1',
    created_at: FIXTURE_CORRECTION_CREATED_AT,
  };

  it('ships BOTH rows — the original keeps its full amount, the correction is its own record', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000, DUPLICATE, CORRECTION],
    });

    expect(csv).toContain(
      `${CRLF}2026-08-16,Payment: Zelle,payment,,,30000,GBP${CRLF}`
    );
    expect(csv).toContain(
      `${CRLF}2026-08-18,Correction: recorded twice,correction,,,-30000,GBP${CRLF}`
    );
  });

  it('NEVER nets the pair into one row — three settlements in, three records out', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000, DUPLICATE, CORRECTION],
    });

    const settlementRows = csv
      .split(CRLF)
      .filter(row => /,(payment|correction),/.test(row));
    expect(settlementRows).toHaveLength(3);
  });

  it('paid_to_date_minor is the SIGNED sum, so balance_due is the true balance', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000, DUPLICATE, CORRECTION],
    });

    // 30000 + 30000 - 30000 = 30000 paid; 121175 - 30000 = 91175 owed.
    expect(csv).toContain(`${CRLF}paid_to_date_minor,30000${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,91175${CRLF}`);
  });

  it('a partial reversal lands on an exact integer, never a rounded one', () => {
    const partial: Payment = { ...CORRECTION, amount_minor: -12_345 };
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000, DUPLICATE, partial],
    });

    // 30000 + 30000 - 12345 = 47655; 121175 - 47655 = 73520.
    expect(csv).toContain(`${CRLF}paid_to_date_minor,47655${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,73520${CRLF}`);
  });

  it('balance_due_minor is still NEVER clamped — an over-paid week reads negative', () => {
    const overpaid: Payment = { ...PAID_30000, amount_minor: 200_000 };
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [overpaid],
    });

    expect(csv).toContain(`${CRLF}balance_due_minor,-78825${CRLF}`);
  });

  it('describes a payment with no method note without a dangling colon', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [{ ...PAID_30000, method_note: null }],
    });

    expect(csv).toContain(
      `${CRLF}2026-08-16,Payment,payment,,,30000,GBP${CRLF}`
    );
  });

  it('escapes a free-text reason containing a comma or a quote', () => {
    const messy: Payment = {
      ...CORRECTION,
      correction_reason: 'wrong week, and she said "August"',
    };
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000, messy],
    });

    expect(csv).toContain(
      '2026-08-18,"Correction: wrong week, and she said ""August""",correction,,,-30000,GBP'
    );
  });

  it('keeps the settlement rows in the order given — the repository sorts, not this', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000, DUPLICATE, CORRECTION],
    });

    const rows = csv
      .split(CRLF)
      .filter(row => /,(payment|correction),/.test(row));
    expect(rows[0]).toContain('pay');
    expect(rows.at(-1)).toContain('Correction: recorded twice');
  });

  it('emits no settlement records at all for a week nobody has paid', () => {
    const { csv } = renderWeekExportCsv({ timesheet, earnings, payments: [] });

    expect(csv).not.toContain(',payment,');
    expect(csv).not.toContain(',correction,');
    expect(csv).toContain(`${CRLF}paid_to_date_minor,0${CRLF}`);
  });

  it('a fully-reversed week reads unpaid — paid_to_date 0 and balance_due is the full gross, never clamped', () => {
    const paid: Payment = { ...PAID_30000, amount_minor: 121_175 };
    const reversed: Payment = {
      ...CORRECTION,
      amount_minor: -121_175,
      correction_reason: 'wrong week',
    };
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [paid, reversed],
    });

    expect(csv).toContain(
      `${CRLF}2026-08-16,Payment: Zelle,payment,,,121175,GBP${CRLF}`
    );
    expect(csv).toContain(
      `${CRLF}2026-08-18,Correction: wrong week,correction,,,-121175,GBP${CRLF}`
    );
    expect(csv).toContain(`${CRLF}paid_to_date_minor,0${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,121175${CRLF}`);
    expect(csv).not.toContain('balance_due_minor,0');
  });
});

describe('renderWeekExportCsv — paid_holiday label (3-E5)', () => {
  it('prints the paid holiday line under its own export label', () => {
    const withPaidHoliday: WeekEarningsOk = {
      ...earnings,
      lines: [
        ...earnings.lines.filter(l => l.kind !== 'pto'),
        {
          kind: 'paid_holiday',
          minutes: 480,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 14_800,
          from_date: '2026-08-04',
          to_date: '2026-08-04',
          arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
    };
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: withPaidHoliday,
      payments: [],
    });

    expect(csv).toContain(
      `${CRLF}2026-08-04,Paid holiday,paid_holiday,480,1850,14800,GBP${CRLF}`
    );
  });
});

describe('carerSlug', () => {
  it('lowercases and collapses non-alphanumerics to a single dash', () => {
    expect(carerSlug('Rowe, Nia')).toBe('rowe-nia');
    expect(carerSlug("Ni'a  O’Brien-Smith")).toBe('ni-a-o-brien-smith');
  });

  it('strips leading and trailing dashes', () => {
    expect(carerSlug('  Nia!  ')).toBe('nia');
  });

  it('falls back to "carer" for a null, empty, or unslugabble name', () => {
    expect(carerSlug(null)).toBe('carer');
    expect(carerSlug(undefined)).toBe('carer');
    expect(carerSlug('')).toBe('carer');
    expect(carerSlug('!!!')).toBe('carer');
  });

  it('never emits a character that could break the Content-Disposition quoting', () => {
    expect(carerSlug('Nia "Nan" Rowe')).toBe('nia-nan-rowe');
    expect(carerSlug('a"; drop table payments; --')).toMatch(/^[a-z0-9-]+$/);
  });
});

/**
 * The parent's approval-time adjustment on the payroll sheet.
 *
 * It is the only record that can carry a NEGATIVE amount and the only one
 * whose description holds free text a person typed — so escaping is not a
 * theoretical concern here, it is the common case.
 */
describe('renderWeekExportCsv — the parent adjustment line', () => {
  const adjusted: WeekEarningsOk = {
    ...earnings,
    gross_minor: 111_775,
    adjustment: {
      amount_minor: -2000,
      note: 'Advance repaid',
      created_by: 'parent-1',
      created_at: FIXTURE_SNAPSHOT_AT,
    },
  };

  it('emits one record after the lines, with empty date/minutes/rate', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: adjusted,
      payments: [],
    });

    const rows = csv.split(CRLF);
    // Immediately after the last line record, immediately before the blank
    // separator — the adjustment closes the line section.
    expect(rows[9]).toBe(',Adjustment: Advance repaid,adjustment,,,-2000,GBP');
    expect(rows[10]).toBe('');
  });

  it('needs no change to the totals — the frozen gross was written adjusted', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: adjusted,
      payments: [PAID_30000],
    });

    expect(csv).toContain(`${CRLF}total_gross_minor,111775${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,81775${CRLF}`);
    // Untouched: a deduction from WAGES never moves the reimbursement total.
    expect(csv).toContain(`${CRLF}reimbursements_minor,1250${CRLF}`);
  });

  it('carries a positive adjustment with no sign at all', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: {
        ...adjusted,
        gross_minor: 116_275,
        adjustment: {
          amount_minor: 2500,
          note: 'Late pickup',
          created_by: 'parent-1',
          created_at: FIXTURE_SNAPSHOT_AT,
        },
      },
      payments: [],
    });

    expect(csv).toContain(
      `${CRLF},Adjustment: Late pickup,adjustment,,,2500,GBP${CRLF}`
    );
  });

  it('escapes a note containing a comma, a quote, or a newline', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: {
        ...adjusted,
        adjustment: {
          amount_minor: -2000,
          note: 'Advance, as agreed — she said "next week"\nfollow up',
          created_by: 'parent-1',
          created_at: FIXTURE_SNAPSHOT_AT,
        },
      },
      payments: [],
    });

    expect(csv).toContain(
      ',"Adjustment: Advance, as agreed — she said ""next week""\nfollow up",adjustment,,,-2000,GBP'
    );
    // The escaping keeps the whole note inside ONE field: the record count is
    // unchanged from the un-escaped case.
    const { csv: plain } = renderWeekExportCsv({
      timesheet,
      earnings: adjusted,
      payments: [],
    });
    expect(csv.split(CRLF).length).toBe(plain.split(CRLF).length);
  });

  it('is byte-identical to today for a snapshot with no adjustment key', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
    });

    expect(csv).toBe(EXPECTED_CSV);
    expect(csv).not.toContain('adjustment');
  });

  it('treats an explicitly null adjustment as no adjustment', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: { ...earnings, adjustment: null },
      payments: [PAID_30000],
    });

    expect(csv).toBe(EXPECTED_CSV);
  });
});

/**
 * 082 / D-29 (P11/P12): period-end + an optional household identifier.
 * PRESENTATION ONLY — this module never computes `periodEnd` itself (see
 * `domains/pay/utils/payPeriod.ts`); it only serialises what the caller
 * already resolved. Both fields are OMITTED entirely, never a fabricated
 * empty string, when the caller has nothing to say (§2.9).
 */
describe('renderWeekExportCsv — period-end + household identifier (082, D-29)', () => {
  it('is byte-identical to today when neither field is supplied — purely additive', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
    });
    expect(csv).toBe(EXPECTED_CSV);
  });

  it('adds period_end right after week_start when supplied', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
      periodEnd: '2026-08-16',
    });
    expect(csv).toContain(
      `${CRLF}week_start,2026-08-03${CRLF}period_end,2026-08-16${CRLF}`
    );
  });

  it('omits period_end entirely when null — never a fabricated date', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
      periodEnd: null,
    });
    expect(csv).not.toContain('period_end');
  });

  it('adds household_display_name right after carer_display_name when supplied', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
      householdDisplayName: 'The Ahmeds',
    });
    expect(csv).toContain(
      `${CRLF}carer_display_name,"Rowe, Nia"${CRLF}household_display_name,The Ahmeds${CRLF}`
    );
  });

  it('escapes a household name containing a comma', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
      householdDisplayName: 'Smith, Jones & Co',
    });
    expect(csv).toContain('household_display_name,"Smith, Jones & Co"');
  });

  it('omits household_display_name entirely when absent — never an empty row', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
    });
    expect(csv).not.toContain('household_display_name');
  });

  it('both fields together, in the documented order', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      payments: [PAID_30000],
      periodEnd: '2026-08-16',
      householdDisplayName: 'The Ahmeds',
    });
    const summary = csv.split(`${CRLF}${CRLF}`)[1] as string;
    expect(summary.split(CRLF)).toEqual([
      'total_gross_minor,121175',
      'reimbursements_minor,1250',
      'paid_to_date_minor,30000',
      'balance_due_minor,91175',
      'carer_display_name,"Rowe, Nia"',
      'household_display_name,The Ahmeds',
      'week_start,2026-08-03',
      'period_end,2026-08-16',
      'currency,GBP',
      `approved_at,${FIXTURE_SNAPSHOT_AT}`,
      '',
    ]);
  });
});
