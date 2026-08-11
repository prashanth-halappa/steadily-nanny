/**
 * The parent's YEAR-END PAYROLL HANDOFF (D-29, `docs/design/
 * screens-pay-terms.md` §12.2) — "gross by class, total paid, reimbursements
 * ... and it happens once a year in a hurry." This module ships the reduced
 * v1 of that section: gross + reimbursements SPLIT OUT, per carer, for the
 * FSA / Form 2441 job. Hour-CLASS columns (daily OT / weekly OT / double
 * time / holiday, split apart) are §12.2's fuller ask and are DELIBERATELY
 * NOT here — they need engine segment-provenance the earnings engine does
 * not carry yet (see 3-U3's session report: attempted, parked, not risked).
 *
 * Every figure is the SUM of already-frozen approved weeks — nothing is
 * recomputed here. Callers pass rows already restricted to one calendar
 * year and to weeks that were exportable (approved + a readable `ok`
 * snapshot); this module does no refusing of its own.
 *
 * =============================================================================
 * THE CSV COLUMN CONTRACT
 * =============================================================================
 *
 * 1. ONE header record: `carer_display_name,gross_minor,
 *    reimbursements_minor,weeks_included,currency`.
 * 2. ONE record per carer, in the order given.
 * 3. ONE empty record (the section separator), then the summary:
 *    | key                       | value                                    |
 *    |---------------------------|--------------------------------------------|
 *    | household_display_name    | OMITTED ENTIRELY when the caller supplies none |
 *    | year                      | the calendar year this total covers      |
 *    | carers_included           | count of rows above                      |
 *    | total_gross_minor         | EXACT sum of the rows' `gross_minor`     |
 *    | total_reimbursements_minor| EXACT sum of the rows' `reimbursements_minor` |
 *    | currency                  | ISO-4217 — ONE currency for the whole household; the caller refuses (never blends) a household that spans more than one |
 *
 * This module computes NO TAX — the caller's own screen says so in prose, the
 * same "Steadily doesn't work out tax" line as the nanny's own pay record.
 *
 * Filename: `steadily-year-end-<year>.csv`.
 *
 * @module domains/timesheet/utils/yearEndSummaryCsv
 */
import { CSV_LINE_TERMINATOR, csvRow } from './csv';

const HEADER: readonly string[] = [
  'carer_display_name',
  'gross_minor',
  'reimbursements_minor',
  'weeks_included',
  'currency',
];

export interface YearEndCarerRow {
  carerDisplayName: string;
  grossMinor: number;
  reimbursementsMinor: number;
  weeksIncluded: number;
}

export interface YearEndSummaryCsvInput {
  /** Optional household/payroll identifier (082, D-29) — omitted when absent. */
  householdDisplayName?: string | null;
  /** ONE currency for the whole household — see the module doc. */
  currency: string;
  year: number;
  rows: readonly YearEndCarerRow[];
}

export interface YearEndSummaryCsv {
  filename: string;
  csv: string;
}

export function renderYearEndSummaryCsv(
  input: YearEndSummaryCsvInput
): YearEndSummaryCsv {
  const { householdDisplayName, currency, year, rows } = input;

  let totalGrossMinor = 0;
  let totalReimbursementsMinor = 0;
  const rowRecords = rows.map(row => {
    totalGrossMinor += row.grossMinor;
    totalReimbursementsMinor += row.reimbursementsMinor;
    return csvRow([
      row.carerDisplayName,
      String(row.grossMinor),
      String(row.reimbursementsMinor),
      String(row.weeksIncluded),
      currency,
    ]);
  });

  const records: string[] = [csvRow(HEADER), ...rowRecords, ''];
  if (householdDisplayName) {
    records.push(csvRow(['household_display_name', householdDisplayName]));
  }
  records.push(
    csvRow(['year', String(year)]),
    csvRow(['carers_included', String(rows.length)]),
    csvRow(['total_gross_minor', String(totalGrossMinor)]),
    csvRow(['total_reimbursements_minor', String(totalReimbursementsMinor)]),
    csvRow(['currency', currency])
  );

  return {
    filename: `steadily-year-end-${year}.csv`,
    csv: records.map(record => `${record}${CSV_LINE_TERMINATOR}`).join(''),
  };
}
