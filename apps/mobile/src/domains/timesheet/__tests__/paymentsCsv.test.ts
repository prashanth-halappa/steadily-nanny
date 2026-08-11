/**
 * @module domains/timesheet/__tests__/paymentsCsv.test
 *
 * `buildPaymentsCsv` is a pure serialiser: no totals, no re-sorting, no
 * money math. Every assertion here is about what it refuses to do as much
 * as what it emits.
 */
import { describe, expect, it } from 'bun:test';
import { buildPaymentsCsv, type PaymentCsvRow } from '../utils/paymentsCsv';

function makeRow(overrides: Partial<PaymentCsvRow> = {}): PaymentCsvRow {
  return {
    paid_at: '2026-08-16',
    week_start: '2026-08-10',
    carer: 'Amara Okafor',
    amount_minor: 62_400,
    currency: 'GBP',
    method_note: 'Bank transfer',
    correction_reason: null,
    recorded_by: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-16T09:30:00.000Z',
    ...overrides,
  };
}

describe('buildPaymentsCsv', () => {
  it('starts with the header record, verbatim', () => {
    const csv = buildPaymentsCsv([makeRow()]);
    expect(csv.split('\r\n')[0]).toBe(
      'paid_at,week_start,carer,amount_minor,currency,method_note,correction_reason,recorded_by,created_at'
    );
  });

  // D-20, attention spec §4.1. The export is the artifact a payroll service
  // and a dispute both read, and the PAIR is the audit trail — netting the
  // two into one row (or filtering the reversed pair out) destroys the only
  // reason the correction mechanism exists.
  it('ships a correction and its original as TWO rows, never netted', () => {
    const csv = buildPaymentsCsv([
      makeRow({ paid_at: '2026-08-16', amount_minor: 46_200 }),
      makeRow({
        paid_at: '2026-08-18',
        amount_minor: -46_200,
        method_note: null,
        correction_reason: 'recorded twice',
      }),
    ]);
    const records = csv.split('\r\n').filter(Boolean);

    expect(records).toHaveLength(3); // header + both rows
    expect(records[1]).toContain(',46200,');
    expect(records[2]).toContain(',-46200,');
    expect(records[2]).toContain('recorded twice');
  });

  it('emits amount_minor as a bare integer — no currency symbol, no separator, no decimal point', () => {
    const csv = buildPaymentsCsv([makeRow({ amount_minor: 1_234_567 })]);
    expect(csv).toContain(',1234567,');
    expect(csv).not.toContain('£');
    expect(csv).not.toContain('1,234,567');
    expect(csv).not.toContain('1234567.00');
  });

  // The single constraint that keeps a client-built CSV from being a second
  // money implementation: this builder performs zero arithmetic.
  it('never emits a totals row', () => {
    const csv = buildPaymentsCsv([
      makeRow({ amount_minor: 10_000 }),
      makeRow({ amount_minor: 20_000 }),
    ]);
    expect(csv.toLowerCase()).not.toContain('total');
    expect(csv).not.toContain('30000');
  });

  it('escapes a method_note containing a comma, a quote and a newline', () => {
    const csv = buildPaymentsCsv([
      makeRow({ method_note: 'Cash, "half now" then\nrest later' }),
    ]);
    const dataLine = csv.split('\r\n')[1] as string;
    expect(dataLine).toContain('"Cash, ""half now"" then\nrest later"');
  });

  it('renders null week_start, carer, method_note and recorded_by as empty fields, never "null" or "undefined"', () => {
    const csv = buildPaymentsCsv([
      makeRow({
        week_start: null,
        carer: null,
        method_note: null,
        recorded_by: null,
      }),
    ]);
    const dataLine = csv.split('\r\n')[1] as string;
    expect(dataLine).toBe('2026-08-16,,,62400,GBP,,,,2026-08-16T09:30:00.000Z');
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });

  it('serialises rows in the order given, never re-sorted', () => {
    const csv = buildPaymentsCsv([
      makeRow({ paid_at: '2026-08-09' }),
      makeRow({ paid_at: '2026-08-16' }),
    ]);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines[1]).toContain('2026-08-09');
    expect(lines[2]).toContain('2026-08-16');
  });

  it('renders an empty input as the header record alone', () => {
    const csv = buildPaymentsCsv([]);
    expect(csv).toBe(
      'paid_at,week_start,carer,amount_minor,currency,method_note,correction_reason,recorded_by,created_at\r\n'
    );
  });
});
