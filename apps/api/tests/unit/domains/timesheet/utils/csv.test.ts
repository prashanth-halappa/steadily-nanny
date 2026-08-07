/**
 * @module tests/unit/domains/timesheet/utils/csv
 *
 * RFC 4180 field escaping, hand-rolled (no dependency). This is the layer that
 * decides whether `"Rowe, Nia"` reaches a payroll provider as one field or as
 * two — so every quoting trigger gets its own case.
 */
import { describe, expect, it } from 'bun:test';
import {
  CSV_LINE_TERMINATOR,
  csvRow,
  escapeCsvField,
} from '../../../../../src/domains/timesheet/utils/csv';

describe('escapeCsvField', () => {
  it('leaves a plain field untouched', () => {
    expect(escapeCsvField('Regular hours')).toBe('Regular hours');
  });

  it('leaves an empty field as the empty string', () => {
    expect(escapeCsvField('')).toBe('');
  });

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('Cancelled shift, paid')).toBe(
      '"Cancelled shift, paid"'
    );
  });

  it('quotes a field containing a double quote, doubling the embedded quote', () => {
    expect(escapeCsvField('Nia "Nan" Rowe')).toBe('"Nia ""Nan"" Rowe"');
  });

  it('doubles EVERY embedded quote, not just the first', () => {
    expect(escapeCsvField('"a"b"')).toBe('"""a""b"""');
  });

  it('quotes a field containing a bare newline', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('quotes a field containing a carriage return', () => {
    expect(escapeCsvField('line one\r\nline two')).toBe(
      '"line one\r\nline two"'
    );
  });

  it('quotes a field that is only a comma', () => {
    expect(escapeCsvField(',')).toBe('","');
  });
});

describe('csvRow', () => {
  it('joins fields with commas and escapes each one', () => {
    expect(csvRow(['2026-08-05', 'Cancelled shift, paid', '240'])).toBe(
      '2026-08-05,"Cancelled shift, paid",240'
    );
  });

  it('emits an empty string for no fields (the section separator)', () => {
    expect(csvRow([])).toBe('');
  });
});

describe('CSV_LINE_TERMINATOR', () => {
  it('is CRLF, per RFC 4180 — payroll software reads this file, not a shell', () => {
    expect(CSV_LINE_TERMINATOR).toBe('\r\n');
  });
});
