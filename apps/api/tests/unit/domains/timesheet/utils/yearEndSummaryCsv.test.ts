import { describe, expect, it } from 'bun:test';
import { renderYearEndSummaryCsv } from '../../../../../src/domains/timesheet/utils/yearEndSummaryCsv';

const CRLF = '\r\n';

describe('renderYearEndSummaryCsv — the parent payroll handoff (D-29, §12.2)', () => {
  it('one row per carer, plus a household total in the summary', () => {
    const { csv } = renderYearEndSummaryCsv({
      householdDisplayName: 'The Ahmeds',
      currency: 'USD',
      year: 2026,
      rows: [
        {
          carerDisplayName: 'Marisol Reyes',
          grossMinor: 8_400_000,
          reimbursementsMinor: 62_400,
          weeksIncluded: 50,
        },
        {
          carerDisplayName: 'Nia Rowe',
          grossMinor: 3_200_000,
          reimbursementsMinor: 0,
          weeksIncluded: 20,
        },
      ],
    });

    expect(csv).toBe(
      [
        'carer_display_name,gross_minor,reimbursements_minor,weeks_included,currency',
        'Marisol Reyes,8400000,62400,50,USD',
        'Nia Rowe,3200000,0,20,USD',
        '',
        'household_display_name,The Ahmeds',
        'year,2026',
        'carers_included,2',
        'total_gross_minor,11600000',
        'total_reimbursements_minor,62400',
        'currency,USD',
      ].join(CRLF) + CRLF
    );
  });

  it('computes no tax and states so nowhere numerically — this module only ever emits gross + reimbursements', () => {
    const { csv } = renderYearEndSummaryCsv({
      currency: 'USD',
      year: 2026,
      rows: [
        {
          carerDisplayName: 'Marisol Reyes',
          grossMinor: 8_400_000,
          reimbursementsMinor: 62_400,
          weeksIncluded: 50,
        },
      ],
    });
    expect(csv).not.toContain('tax');
  });

  it('omits household_display_name when absent', () => {
    const { csv } = renderYearEndSummaryCsv({
      currency: 'USD',
      year: 2026,
      rows: [],
    });
    expect(csv).not.toContain('household_display_name');
  });

  it('handles zero carers honestly — zero totals, never fabricated', () => {
    const { csv } = renderYearEndSummaryCsv({
      currency: 'USD',
      year: 2026,
      rows: [],
    });
    expect(csv).toContain('carers_included,0');
    expect(csv).toContain('total_gross_minor,0');
    expect(csv).toContain('total_reimbursements_minor,0');
  });

  it('escapes a carer display name containing a comma', () => {
    const { csv } = renderYearEndSummaryCsv({
      currency: 'USD',
      year: 2026,
      rows: [
        {
          carerDisplayName: 'Reyes, Marisol',
          grossMinor: 100,
          reimbursementsMinor: 0,
          weeksIncluded: 1,
        },
      ],
    });
    expect(csv).toContain('"Reyes, Marisol",100,0,1,USD');
  });

  it('names the file with the year', () => {
    const { filename } = renderYearEndSummaryCsv({
      currency: 'USD',
      year: 2026,
      rows: [],
    });
    expect(filename).toBe('steadily-year-end-2026.csv');
  });
});
