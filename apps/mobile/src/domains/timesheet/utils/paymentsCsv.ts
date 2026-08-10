/**
 * @module domains/timesheet/utils/paymentsCsv
 *
 * The Payments screen's CSV export: one row per recorded payment, verbatim.
 * Columns, in order:
 *
 *   paid_at,week_start,carer,amount_minor,currency,method_note,recorded_by,created_at
 *
 * `week_start` and `carer` come from the same client-side timesheet join
 * `PaymentsScreen` already uses to render the row's week line — both are
 * empty when a payment's timesheet is missing from that join, the same
 * "omit rather than fabricate" rule the screen itself follows.
 *
 * NO TOTALS ROW, ON PURPOSE. This builder performs ZERO arithmetic — every
 * field is server-verbatim (or, for the two joined columns, the same lookup
 * the screen already renders). That is what makes a client-built CSV
 * defensible instead of a second money implementation: summing
 * `amount_minor` belongs to a spreadsheet or the server, never here
 * (docs/11-MONEY.md §1). Do not add a totals row.
 *
 * EVERY AMOUNT IS AN INTEGER IN MINOR UNITS — no currency symbol, no
 * thousands separator, no decimal point. A downloaded file has no
 * formatting context once it leaves the app (same contract as
 * `apps/api/src/domains/timesheet/utils/weekExportCsv.ts`).
 *
 * Escaping mirrors that module's RFC 4180 rules exactly (a field containing
 * a comma, a quote, CR or LF is wrapped in quotes; embedded quotes double),
 * replicated here rather than imported: `apps/api` and `apps/mobile` are
 * separate apps with no shared package for this leaf. Records are
 * CRLF-terminated, including the last one — this file is opened by a
 * spreadsheet, not a shell.
 *
 * Empty input still yields the header record alone rather than an empty
 * string: a ledger with nothing to show is still a CSV a spreadsheet can
 * open.
 *
 * Pure and dependency-free, same discipline as `paymentGroups.ts` — accepts
 * a structurally minimal local row shape rather than the full `Payment`.
 */

const CSV_LINE_TERMINATOR = '\r\n';
const MUST_QUOTE = /[",\r\n]/;

function escapeCsvField(value: string): string {
  if (!MUST_QUOTE.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function csvRow(fields: readonly string[]): string {
  return fields.map(escapeCsvField).join(',');
}

const HEADER: readonly string[] = [
  'paid_at',
  'week_start',
  'carer',
  'amount_minor',
  'currency',
  'method_note',
  'recorded_by',
  'created_at',
];

/** Just the fields the builder needs off a payment, plus the two columns
 * the screen's client-side timesheet join already supplies. */
export interface PaymentCsvRow {
  paid_at: string;
  /** Null when the payment's timesheet is missing from the join. */
  week_start: string | null;
  /** Null for the same reason. */
  carer: string | null;
  amount_minor: number;
  currency: string;
  method_note: string | null;
  recorded_by: string | null;
  created_at: string;
}

function paymentRecord(row: PaymentCsvRow): string {
  return csvRow([
    row.paid_at,
    row.week_start ?? '',
    row.carer ?? '',
    String(row.amount_minor),
    row.currency,
    row.method_note ?? '',
    row.recorded_by ?? '',
    row.created_at,
  ]);
}

/**
 * Serialises payment rows in the order given — callers pass them already
 * newest-`paid_at`-first, the order the screen renders. No re-sorting here,
 * the same discipline `weekExportCsv.ts` uses for its line records.
 */
export function buildPaymentsCsv(rows: readonly PaymentCsvRow[]): string {
  const records = [csvRow(HEADER), ...rows.map(paymentRecord)];
  return records.map(record => `${record}${CSV_LINE_TERMINATOR}`).join('');
}
