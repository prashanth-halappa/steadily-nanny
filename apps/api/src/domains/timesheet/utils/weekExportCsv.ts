/**
 * The payroll handoff artifact: an APPROVED week's FROZEN earnings snapshot,
 * serialised to CSV for a parent to hand to HomePay/Nannytax/an accountant.
 *
 * "We compute, your payroll provider files" (AGENCY-ROADMAP Tier 1.2) — this
 * module is the export half of that sentence, and it exists so that we never
 * have to build the filing half. It reads the SAME frozen `earnings` jsonb
 * that `timesheetQueryService.getWeek` serves and recomputes nothing: a file
 * handed to a payroll provider must carry the figures the parent approved, not
 * a figure derived from today's arrangement (`docs/11-MONEY.md` §3).
 *
 * =============================================================================
 * THE CSV COLUMN CONTRACT — the mobile slice downloads this file blind
 * =============================================================================
 *
 * Encoding: UTF-8, no BOM. Records terminated by CRLF (RFC 4180 §2.1),
 * INCLUDING the last one. Fields escaped per `./csv.ts`.
 *
 * The body is three sections, in this order:
 *
 * 1. ONE header record, verbatim:
 *
 *      date,description,kind,minutes,rate_minor,amount_minor,currency
 *
 * 2. ZERO OR MORE line records — one per `EarningsLine` in the snapshot, in
 *    the snapshot's own order (`EARNINGS_LINE_ORDER`, then chronological);
 *    never re-sorted here. Then, when the week carries the parent's
 *    approval-time `adjustment`, ONE more record after them all:
 *
 *      ,Adjustment: <note>,adjustment,,,<signed amount_minor>,<currency>
 *
 *    `kind` is `adjustment` — the ONE value in that column that is not an
 *    `EARNINGS_LINE_KINDS` member, because the adjustment is deliberately not
 *    a line kind (see `timesheet.schema.ts`). It is the only record whose
 *    `amount_minor` may be NEGATIVE, and its `date`, `minutes` and
 *    `rate_minor` are EMPTY rather than `0`: it is money, not time, and a `0`
 *    rate would read as "priced at nothing". `total_gross_minor` already
 *    includes it — the frozen gross was written adjusted.
 *
 *    | column        | value                                                  |
 *    |---------------|--------------------------------------------------------|
 *    | date          | the line's `from_date` (household-local, ISO `YYYY-MM-DD`) |
 *    | description   | human label; carries the multiplier and the `to_date` when the line spans days — see `describeLine` |
 *    | kind          | the snapshot's `kind` VERBATIM: `regular`, `overtime`, `cancellation_paid`, `pto`, `guaranteed_topup`, `reimbursements` |
 *    | minutes       | integer; `0` on a reimbursement line (it is not time)   |
 *    | rate_minor    | integer MINOR units per hour as displayed on the row (overtime carries the already-multiplied rate); `0` on a reimbursement line |
 *    | amount_minor  | integer MINOR units                                     |
 *    | currency      | ISO-4217, uppercase; one currency per week by construction |
 *
 * 3. ONE EMPTY record (the section separator), then the summary records, each
 *    `key,value`, in this fixed order:
 *
 *    | key                 | value                                            |
 *    |---------------------|--------------------------------------------------|
 *    | total_gross_minor   | wages only — the sum of every non-reimbursement line |
 *    | reimbursements_minor| summed apart, NEVER inside gross (`docs/11-MONEY.md` §6) |
 *    | paid_to_date_minor  | sum of `payments` recorded against this week      |
 *    | balance_due_minor   | `total_gross_minor - paid_to_date_minor`          |
 *    | carer_display_name  | the durable snapshotted name, quoted if it needs it |
 *    | week_start          | Monday, household-local, ISO `YYYY-MM-DD`         |
 *    | currency            | ISO-4217, uppercase                               |
 *    | approved_at         | ISO-8601 UTC — OMITTED ENTIRELY when the row has none |
 *
 *    `reimbursements_minor` is on the sheet because the line records include
 *    reimbursement rows whose amounts are deliberately NOT in gross: without
 *    it, anyone adding the `amount_minor` column would get a number that
 *    disagrees with `total_gross_minor` and have no way to see why.
 *
 * EVERY AMOUNT IS AN INTEGER IN MINOR UNITS. Never a major-unit float, never a
 * currency symbol, never a thousands separator (`docs/11-MONEY.md` §1) —
 * payroll software wants an unambiguous integer, and formatting money
 * server-side is how rounding errors get into a payslip.
 *
 * `balance_due_minor` is a plain subtraction and is NEVER clamped at zero: an
 * over-payment must show as a negative balance, not silently vanish.
 *
 * Filename: `steadily-week-<week_start>-<carer-slug>.csv`, where the slug is
 * `carerSlug()` below — lowercase `[a-z0-9-]` only, so it can never break the
 * `Content-Disposition` quoting the controller wraps it in.
 *
 * @module domains/timesheet/utils/weekExportCsv
 */
import type {
  EarningsLine,
  EarningsLineKind,
  Timesheet,
  WeekEarningsOk,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  EARNINGS_LINE_KINDS,
  humanizeEarningsLineKind,
  isKnownEarningsLineKind,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { CSV_LINE_TERMINATOR, csvRow } from './csv';

/** The header record, spelled out once. */
const HEADER: readonly string[] = [
  'date',
  'description',
  'kind',
  'minutes',
  'rate_minor',
  'amount_minor',
  'currency',
];

/**
 * The human label per line kind. `kind` is already on its own column
 * verbatim — this is the column a person reads, so it is prose, and it is
 * fixed English: the artifact is a payroll handoff, not a localised screen.
 *
 * TOTAL, not `Partial`, deliberately: `kind` is an open string on the wire so
 * that a snapshot from a newer server still parses, but a kind added to
 * `EARNINGS_LINE_KINDS` in THIS repo must still be a compile error until
 * someone writes its label here.
 */
const LINE_LABELS: Record<EarningsLineKind, string> = {
  [EARNINGS_LINE_KINDS.REGULAR]: 'Regular hours',
  [EARNINGS_LINE_KINDS.OVERTIME]: 'Overtime',
  [EARNINGS_LINE_KINDS.CANCELLATION_PAID]: 'Cancelled shift, paid',
  [EARNINGS_LINE_KINDS.PTO]: 'Paid time off',
  [EARNINGS_LINE_KINDS.GUARANTEED_TOPUP]: 'Guaranteed hours top-up',
  [EARNINGS_LINE_KINDS.REIMBURSEMENTS]: 'Reimbursement',
};

/** What the serialiser needs, and nothing more — all of it already frozen. */
export interface WeekExportCsvInput {
  /** The wire timesheet (`toWireTimesheet`) — name, week, approval stamp. */
  timesheet: Timesheet;
  /** The FROZEN snapshot, already parsed through `WeekEarningsSchema`. */
  earnings: WeekEarningsOk;
  /** Sum of the `payments` rows for this week, in minor units. */
  paidToDateMinor: number;
}

/** A ready-to-send download. */
export interface WeekExportCsv {
  filename: string;
  csv: string;
}

/**
 * `Content-Disposition`-safe slug: lowercase, every run of non-alphanumerics
 * collapsed to a single `-`, no leading/trailing `-`.
 *
 * Typed to accept null/undefined even though `TimesheetSchema` says the name
 * is a non-null string: this value is snapshotted at row creation and rows
 * predate that guarantee, and a filename is not worth a 500. A name that
 * slugs to nothing at all (`"!!!"`) falls back the same way.
 */
export function carerSlug(name: string | null | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'carer' : slug;
}

/**
 * The `description` column: the kind's label, plus the overtime multiplier
 * (the rate on the row is already multiplied, so the reader can check it), plus
 * the closing date when the line spans more than one day — a mid-week raise
 * splits `regular` into two dated lines, and a top-up spans the whole week.
 */
function describeLine(line: EarningsLine): string {
  // A kind frozen by a newer server than the one exporting it gets a
  // humanized label rather than an empty description — the `kind` column
  // beside it is verbatim either way, so the payroll provider loses nothing.
  const label = isKnownEarningsLineKind(line.kind)
    ? LINE_LABELS[line.kind]
    : humanizeEarningsLineKind(line.kind);
  const withMultiplier =
    line.kind === EARNINGS_LINE_KINDS.OVERTIME && line.multiplier !== null
      ? `${label} at ${line.multiplier}x`
      : label;
  return line.to_date === line.from_date
    ? withMultiplier
    : `${withMultiplier} (to ${line.to_date})`;
}

/** One line record. Amounts pass through as integers — no formatting, ever. */
function lineRecord(line: EarningsLine, currency: string): string {
  return csvRow([
    line.from_date,
    describeLine(line),
    line.kind,
    String(line.minutes),
    String(line.rate_minor),
    String(line.amount_minor),
    currency,
  ]);
}

/**
 * The parent's approval-time adjustment as a line record.
 *
 * Built with the same `csvRow` as every other record, which is not a
 * consistency nicety here: the note is FREE TEXT the parent typed, so it is
 * the one field on this sheet that can contain a comma, a quote or a newline,
 * and `csvRow` owns the RFC 4180 escaping that keeps those inside one field.
 */
function adjustmentRecord(
  adjustment: NonNullable<WeekEarningsOk['adjustment']>,
  currency: string
): string {
  return csvRow([
    '',
    `Adjustment: ${adjustment.note}`,
    'adjustment',
    '',
    '',
    String(adjustment.amount_minor),
    currency,
  ]);
}

/** The frozen week, serialised. Pure: same input, same bytes, every time. */
export function renderWeekExportCsv(input: WeekExportCsvInput): WeekExportCsv {
  const { timesheet, earnings, paidToDateMinor } = input;
  const records: string[] = [
    csvRow(HEADER),
    ...earnings.lines.map(line => lineRecord(line, earnings.currency)),
    ...(earnings.adjustment
      ? [adjustmentRecord(earnings.adjustment, earnings.currency)]
      : []),
    // The section separator.
    '',
    csvRow(['total_gross_minor', String(earnings.gross_minor)]),
    csvRow(['reimbursements_minor', String(earnings.reimbursements_minor)]),
    csvRow(['paid_to_date_minor', String(paidToDateMinor)]),
    csvRow([
      'balance_due_minor',
      String(earnings.gross_minor - paidToDateMinor),
    ]),
    csvRow(['carer_display_name', timesheet.carer_display_name ?? '']),
    csvRow(['week_start', timesheet.week_start]),
    csvRow(['currency', earnings.currency]),
  ];
  if (timesheet.approved_at) {
    records.push(csvRow(['approved_at', timesheet.approved_at]));
  }

  return {
    filename: `steadily-week-${timesheet.week_start}-${carerSlug(
      timesheet.carer_display_name
    )}.csv`,
    // Terminator AFTER every record, the last one included: a file that ends
    // mid-record is one a strict parser is entitled to reject.
    csv: records.map(record => `${record}${CSV_LINE_TERMINATOR}`).join(''),
  };
}
