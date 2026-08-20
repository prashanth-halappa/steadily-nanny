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
 *    `kind` is `adjustment` — a value in that column that is not an
 *    `EARNINGS_LINE_KINDS` member, because the adjustment is deliberately not
 *    a line kind (see `timesheet.schema.ts`). Its `amount_minor` may be
 *    NEGATIVE, and its `date`, `minutes` and `rate_minor` are EMPTY rather
 *    than `0`: it is money, not time, and a `0` rate would read as "priced at
 *    nothing". `total_gross_minor` already includes it — the frozen gross was
 *    written adjusted.
 *
 *    Then, LAST in the line section, ONE record per settlement row recorded
 *    against this week — every `payment` and every `correction` (D-20):
 *
 *      <paid_at>,Payment: <method_note>,payment,,,<amount_minor>,<currency>
 *      <paid_at>,Correction: <reason>,correction,,,<-amount_minor>,<currency>
 *
 *    `minutes` and `rate_minor` are EMPTY for the adjustment's reason, and a
 *    correction's `amount_minor` is negative. `Payment` appears alone when the
 *    parent recorded no method note. These records are money OUT, not earnings,
 *    and are NOT in `total_gross_minor` — see the warning about summing the
 *    `amount_minor` column.
 *
 *    | column        | value                                                  |
 *    |---------------|--------------------------------------------------------|
 *    | date          | the line's `from_date` (household-local, ISO `YYYY-MM-DD`) |
 *    | description   | human label; carries the multiplier and the `to_date` when the line spans days — see `describeLine` |
 *    | kind          | the snapshot's `kind` VERBATIM: `regular`, `overtime`, `doubletime`, `holiday_premium`, `cancellation_paid`, `pto`, `guaranteed_topup`, `reimbursements` |
 *    | minutes       | integer; `0` on a reimbursement line (it is not time). NOT disjoint across rows on a `holiday_premium` line — those minutes are the same ones already counted on the tier row they were worked at, so never SUM this column across kinds (see `rate_minor` below and §12.2) |
 *    | rate_minor    | integer MINOR units per hour as displayed on the row (overtime and double time carry the already-multiplied rate; `holiday_premium` carries the UPLIFT ALONE, `rate x (multiplier - 1)`); `0` on a reimbursement line |
 *    | amount_minor  | integer MINOR units                                     |
 *    | currency      | ISO-4217, uppercase; one currency per week by construction |
 *
 * 3. ONE EMPTY record (the section separator), then the summary records, each
 *    `key,value`, in this fixed order:
 *
 *    | key                    | value                                            |
 *    |------------------------|---------------------------------------------------|
 *    | total_gross_minor      | wages only — the sum of every non-reimbursement line |
 *    | reimbursements_minor   | summed apart, NEVER inside gross (`docs/11-MONEY.md` §6) |
 *    | paid_to_date_minor     | SIGNED sum of the settlement rows — payments AND corrections (D-20) |
 *    | balance_due_minor      | `total_gross_minor - paid_to_date_minor`          |
 *    | carer_display_name     | the durable snapshotted name, quoted if it needs it |
 *    | household_display_name | OMITTED ENTIRELY when the caller supplies none (082, D-29 — optional household identifier) |
 *    | week_start             | Week's first day, household-local, ISO `YYYY-MM-DD`|
 *    | period_end             | OMITTED ENTIRELY when the caller supplies none (082, D-29 — the pay period this week belongs to, PRESENTATION ONLY, resolved by the caller via `domains/pay/utils/payPeriod.ts` — this module never derives it) |
 *    | currency               | ISO-4217, uppercase                               |
 *    | approved_at            | ISO-8601 UTC — OMITTED ENTIRELY when the row has none |
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
 * =============================================================================
 * A CORRECTION AND ITS ORIGINAL BOTH SHIP. DO NOT NET THEM. (D-20)
 * =============================================================================
 *
 * Two records summing to zero look like a bug to every future reader, and the
 * tidy-up — "just net them" or "filter the reversed pair" — is one line away
 * and destroys the only reason the correction exists. A correction and its
 * original both ship: the export is what a payroll service and a dispute both
 * read, and THE PAIR IS THE AUDIT TRAIL. `paid_to_date_minor` already carries
 * the netted figure; that is the row for netting, and it is the only one.
 *
 * Filename: `steadily-week-<week_start>-<carer-slug>.csv`, where the slug is
 * `carerSlug()` below — lowercase `[a-z0-9-]` only, so it can never break the
 * `Content-Disposition` quoting the controller wraps it in.
 *
 * @module domains/timesheet/utils/weekExportCsv
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
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
  [EARNINGS_LINE_KINDS.DOUBLETIME]: 'Double time',
  [EARNINGS_LINE_KINDS.HOLIDAY_PREMIUM]: 'Holiday premium',
  [EARNINGS_LINE_KINDS.CANCELLATION_PAID]: 'Cancelled shift, paid',
  [EARNINGS_LINE_KINDS.PTO]: 'Paid time off',
  [EARNINGS_LINE_KINDS.PAID_HOLIDAY]: 'Paid holiday',
  [EARNINGS_LINE_KINDS.GUARANTEED_TOPUP]: 'Guaranteed hours top-up',
  [EARNINGS_LINE_KINDS.REIMBURSEMENTS]: 'Reimbursement',
};

/** What the serialiser needs, and nothing more — all of it already frozen. */
export interface WeekExportCsvInput {
  /** The wire timesheet (`toWireTimesheet`) — name, week, approval stamp. */
  timesheet: Timesheet;
  /** The FROZEN snapshot, already parsed through `WeekEarningsSchema`. */
  earnings: WeekEarningsOk;
  /**
   * Every settlement row recorded against this week — payments AND their
   * corrections — in the order the repository returned them (oldest first;
   * this module never re-sorts).
   *
   * THE ROWS, NOT A TOTAL. This used to be a `paidToDateMinor: number` and the
   * rows were nowhere on the sheet, which meant the summary asserted a figure
   * the file gave a reader no way to check. D-20 requires both, and taking the
   * rows makes the two impossible to disagree: the total below is derived from
   * this array and from nothing else.
   */
  payments: readonly Payment[];
  /**
   * The pay period this week belongs to (082, D-17, D-29, P12) — already
   * resolved by the caller via `domains/pay/utils/payPeriod.ts`. This module
   * stays pure and never derives it: `null`/omitted means no pay schedule is
   * stated (or the caller has none to offer), and the `period_end` summary
   * key is OMITTED ENTIRELY rather than emitting a fabricated date.
   */
  periodEnd?: string | null;
  /**
   * An optional household/payroll identifier (082, D-29, P12) — honest and
   * never invented: there is no dedicated "payroll id" field anywhere in this
   * app, so the caller passes the household's own display name (or omits the
   * field). OMITTED ENTIRELY when absent, same discipline as `periodEnd`.
   */
  householdDisplayName?: string | null;
  /**
   * Phase 5.1 — the one exception `timesheetQueryService.exportWeekCsv` ever
   * carves into "only an approved week exports": a carer, on her own week,
   * in a household with no active owner/parent left to approve it. The FILE
   * MUST STATE ITS OWN STATUS — an unapproved week exported as though it
   * were approved would be evidence that misrepresents itself, which is
   * worse than no export at all. Plain English, appended as the LAST summary
   * row, in place of `approved_at` (mutually exclusive by construction: the
   * caller only ever supplies this for a week that has none). OMITTED
   * ENTIRELY when null/absent — an ordinary approved export is byte-identical
   * to before this field existed.
   */
  unapprovedNotice?: string | null;
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
 * The `description` column: the kind's label, plus the premium-tier multiplier
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
  const isPremiumTier =
    line.kind === EARNINGS_LINE_KINDS.OVERTIME ||
    line.kind === EARNINGS_LINE_KINDS.DOUBLETIME ||
    // 3-E4. Carries a multiplier like the tiers above, but its `rate_minor`
    // is the UPLIFT ALONE (`rate x (multiplier - 1)`), not the multiplied
    // rate — so "Holiday premium at 1.5x" reads beside a rate that is half
    // the hourly, on purpose. The reader who needs the full holiday rate adds
    // the base back from the `regular` row these same minutes also appear on.
    line.kind === EARNINGS_LINE_KINDS.HOLIDAY_PREMIUM;
  const withMultiplier =
    isPremiumTier && line.multiplier !== null
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

/**
 * One settlement row — a payment, or the correction that reverses one (D-20).
 *
 * Built with the same `csvRow` as everything else, and for the same reason the
 * adjustment is: `method_note` and `correction_reason` are FREE TEXT a parent
 * typed, so they are the fields on this sheet most likely to hold a comma or a
 * quote, and `csvRow` owns the RFC 4180 escaping that keeps them in one field.
 *
 * `minutes` and `rate_minor` are empty rather than `0`, exactly as on the
 * adjustment: this is money, not time.
 *
 * The description is the row's OWN kind word plus its own free text, so a
 * reader never has to look at the `kind` column to know which of the two they
 * are reading. A payment with no method note is just "Payment" — a dangling
 * colon reads as missing data rather than as "the parent did not say how".
 */
function settlementRecord(payment: Payment): string {
  const description =
    payment.kind === 'correction'
      ? `Correction: ${payment.correction_reason ?? ''}`
      : payment.method_note
        ? `Payment: ${payment.method_note}`
        : 'Payment';
  return csvRow([
    payment.paid_at,
    description,
    payment.kind,
    '',
    '',
    String(payment.amount_minor),
    payment.currency,
  ]);
}

/** The frozen week, serialised. Pure: same input, same bytes, every time. */
export function renderWeekExportCsv(input: WeekExportCsvInput): WeekExportCsv {
  const {
    timesheet,
    earnings,
    payments,
    periodEnd,
    householdDisplayName,
    unapprovedNotice,
  } = input;
  // The SIGNED sum: correction rows carry a negative `amount_minor`, so this
  // one expression is paid-to-date WITH corrections — the same arithmetic
  // migration 085's over-gross gate does inside the database. Do NOT filter it
  // by `kind`; see the D-20 section of the module doc.
  const paidToDateMinor = payments.reduce(
    (total, payment) => total + payment.amount_minor,
    0
  );
  const records: string[] = [
    csvRow(HEADER),
    ...earnings.lines.map(line => lineRecord(line, earnings.currency)),
    ...(earnings.adjustment
      ? [adjustmentRecord(earnings.adjustment, earnings.currency)]
      : []),
    // Money OUT closes the line section — every payment and every correction,
    // both rows of a corrected pair, never netted. See the module doc.
    ...payments.map(settlementRecord),
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
  ];
  if (householdDisplayName) {
    records.push(csvRow(['household_display_name', householdDisplayName]));
  }
  records.push(csvRow(['week_start', timesheet.week_start]));
  if (periodEnd) {
    records.push(csvRow(['period_end', periodEnd]));
  }
  records.push(csvRow(['currency', earnings.currency]));
  if (unapprovedNotice) {
    records.push(csvRow(['export_notice', unapprovedNotice]));
  }
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
