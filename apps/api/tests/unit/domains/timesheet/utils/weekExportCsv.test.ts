/**
 * @module tests/unit/domains/timesheet/utils/weekExportCsv
 *
 * The payroll handoff artifact, pinned byte-for-byte. The mobile slice
 * downloads this file blind against the column contract in
 * `src/domains/timesheet/utils/weekExportCsv.ts` — so the assertion here is
 * the WHOLE body, not a spot check on a row.
 */
import { describe, expect, it } from 'bun:test';
import type {
  Timesheet,
  WeekEarningsOk,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  carerSlug,
  renderWeekExportCsv,
} from '../../../../../src/domains/timesheet/utils/weekExportCsv';

/** A comma in the display name — the escaping case, on a real field. */
const timesheet: Timesheet = {
  id: 'ts-1',
  household_id: 'h-1',
  carer_id: 'carer-1',
  carer_display_name: 'Rowe, Nia',
  week_start: '2026-08-03',
  total_minutes: 2580,
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: '2026-08-10T09:30:00.000Z',
  query_note: null,
  reopen_reason: null,
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-08-10T09:30:00.000Z',
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
  gross_minor: 106_375,
  reimbursements_minor: 1250,
  worked_minutes: 2580,
  payable_minutes: 3300,
  guaranteed_minutes_per_week: 2400,
};

const CRLF = '\r\n';

/** The expected artifact, spelled out. Trailing terminator included. */
const EXPECTED_CSV =
  [
    'date,description,kind,minutes,rate_minor,amount_minor,currency',
    '2026-08-03,Regular hours (to 2026-08-07),regular,2400,1850,74000,GBP',
    '2026-08-08,Overtime at 1.5x,overtime,180,2775,8325,GBP',
    '2026-08-05,"Cancelled shift, paid",cancellation_paid,240,1850,7400,GBP',
    '2026-08-06,Paid time off,pto,480,1850,14800,GBP',
    '2026-08-03,Guaranteed hours top-up (to 2026-08-09),guaranteed_topup,60,1850,1850,GBP',
    '2026-08-04,Reimbursement,reimbursements,0,0,1250,GBP',
    '',
    'total_gross_minor,106375',
    'reimbursements_minor,1250',
    'paid_to_date_minor,30000',
    'balance_due_minor,76375',
    'carer_display_name,"Rowe, Nia"',
    'week_start,2026-08-03',
    'currency,GBP',
    'approved_at,2026-08-10T09:30:00.000Z',
  ].join(CRLF) + CRLF;

describe('renderWeekExportCsv — the rich fixture, byte for byte', () => {
  it('serialises the frozen snapshot to the exact expected body', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      paidToDateMinor: 30_000,
    });

    expect(csv).toBe(EXPECTED_CSV);
  });

  it('names the file steadily-week-<week_start>-<carer-slug>.csv', () => {
    const { filename } = renderWeekExportCsv({
      timesheet,
      earnings,
      paidToDateMinor: 30_000,
    });

    expect(filename).toBe('steadily-week-2026-08-03-rowe-nia.csv');
  });

  it('balance_due_minor is gross minus paid — reimbursements are NOT wages (docs/11-MONEY.md §6)', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      paidToDateMinor: 0,
    });

    expect(csv).toContain(`${CRLF}total_gross_minor,106375${CRLF}`);
    expect(csv).toContain(`${CRLF}paid_to_date_minor,0${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,106375${CRLF}`);
    // The reimbursement line's 1250 is in the rows but never in the gross.
    expect(csv).toContain(`${CRLF}reimbursements_minor,1250${CRLF}`);
  });

  it('emits amounts as integer minor units — never a formatted major-unit float', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      paidToDateMinor: 30_000,
    });

    expect(csv).not.toContain('£');
    expect(csv).not.toContain('1063.75');
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
    // comma of its own.
    const dataRows = rows.filter(row => /^\d{4}-\d{2}-\d{2},/.test(row));
    expect(dataRows).toHaveLength(6);
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
      paidToDateMinor: 0,
    });

    expect(csv).not.toContain('approved_at');
    expect(csv.endsWith(`currency,GBP${CRLF}`)).toBe(true);
  });

  it('emits header + separator + summary even when the snapshot has no lines', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: { ...earnings, lines: [], gross_minor: 0 },
      paidToDateMinor: 0,
    });

    expect(csv.split(CRLF).slice(0, 3)).toEqual([
      'date,description,kind,minutes,rate_minor,amount_minor,currency',
      '',
      'total_gross_minor,0',
    ]);
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
    gross_minor: 104_375,
    adjustment: {
      amount_minor: -2000,
      note: 'Advance repaid',
      created_by: 'parent-1',
      created_at: '2026-08-10T09:30:00.000Z',
    },
  };

  it('emits one record after the lines, with empty date/minutes/rate', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: adjusted,
      paidToDateMinor: 0,
    });

    const rows = csv.split(CRLF);
    // Immediately after the last line record, immediately before the blank
    // separator — the adjustment closes the line section.
    expect(rows[7]).toBe(',Adjustment: Advance repaid,adjustment,,,-2000,GBP');
    expect(rows[8]).toBe('');
  });

  it('needs no change to the totals — the frozen gross was written adjusted', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: adjusted,
      paidToDateMinor: 30_000,
    });

    expect(csv).toContain(`${CRLF}total_gross_minor,104375${CRLF}`);
    expect(csv).toContain(`${CRLF}balance_due_minor,74375${CRLF}`);
    // Untouched: a deduction from WAGES never moves the reimbursement total.
    expect(csv).toContain(`${CRLF}reimbursements_minor,1250${CRLF}`);
  });

  it('carries a positive adjustment with no sign at all', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: {
        ...adjusted,
        gross_minor: 108_875,
        adjustment: {
          amount_minor: 2500,
          note: 'Late pickup',
          created_by: 'parent-1',
          created_at: '2026-08-10T09:30:00.000Z',
        },
      },
      paidToDateMinor: 0,
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
          created_at: '2026-08-10T09:30:00.000Z',
        },
      },
      paidToDateMinor: 0,
    });

    expect(csv).toContain(
      ',"Adjustment: Advance, as agreed — she said ""next week""\nfollow up",adjustment,,,-2000,GBP'
    );
    // The escaping keeps the whole note inside ONE field: the record count is
    // unchanged from the un-escaped case.
    const { csv: plain } = renderWeekExportCsv({
      timesheet,
      earnings: adjusted,
      paidToDateMinor: 0,
    });
    expect(csv.split(CRLF).length).toBe(plain.split(CRLF).length);
  });

  it('is byte-identical to today for a snapshot with no adjustment key', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings,
      paidToDateMinor: 30_000,
    });

    expect(csv).toBe(EXPECTED_CSV);
    expect(csv).not.toContain('adjustment');
  });

  it('treats an explicitly null adjustment as no adjustment', () => {
    const { csv } = renderWeekExportCsv({
      timesheet,
      earnings: { ...earnings, adjustment: null },
      paidToDateMinor: 30_000,
    });

    expect(csv).toBe(EXPECTED_CSV);
  });
});
