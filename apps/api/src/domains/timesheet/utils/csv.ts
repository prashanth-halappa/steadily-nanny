/**
 * RFC 4180 field escaping — hand-rolled, dependency-free, and deliberately so.
 *
 * A CSV writer is thirty lines of well-specified string handling; the risk is
 * not the algorithm, it is a transitive dependency in the path that produces a
 * file people get PAID against. The rule set here is the whole of RFC 4180
 * §2.5–2.7 that we need:
 *
 * - a field containing a comma, a double quote, CR or LF is wrapped in double
 *   quotes;
 * - every embedded double quote inside a quoted field is doubled;
 * - everything else is emitted verbatim, including the empty string.
 *
 * Records are terminated with CRLF (§2.1), not LF: this file is opened by
 * payroll software and spreadsheets on Windows, not by a shell.
 *
 * A dependency-free leaf next to `weekStart.ts`/`toWireTimesheet.ts` — it
 * imports nothing from the domain and nothing from the app.
 *
 * @module domains/timesheet/utils/csv
 */

/** RFC 4180 §2.1. Exported so the serialiser and its tests share one constant. */
export const CSV_LINE_TERMINATOR = '\r\n';

/** The characters whose presence forces a field to be quoted. */
const MUST_QUOTE = /[",\r\n]/;

/** One field, escaped per RFC 4180. Total: every string has an encoding. */
export function escapeCsvField(value: string): string {
  if (!MUST_QUOTE.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

/** One record: fields escaped individually, joined with commas. No terminator. */
export function csvRow(fields: readonly string[]): string {
  return fields.map(escapeCsvField).join(',');
}
