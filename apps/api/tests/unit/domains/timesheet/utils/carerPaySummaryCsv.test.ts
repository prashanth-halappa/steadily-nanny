import { describe, expect, it } from 'bun:test';
import { renderCarerPaySummaryCsv } from '../../../../../src/domains/timesheet/utils/carerPaySummaryCsv';

const CRLF = '\r\n';

describe('renderCarerPaySummaryCsv — the nanny pay record (D-29, §12.1)', () => {
  it('serialises the header, one row per week, and the YTD summary', () => {
    const { csv } = renderCarerPaySummaryCsv({
      carerDisplayName: 'Marisol Reyes',
      householdDisplayName: 'The Ahmeds',
      currency: 'USD',
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      rows: [
        {
          weekStart: '2026-08-03',
          weekEnd: '2026-08-09',
          approvedAt: '2026-08-10T09:30:00.000Z',
          grossMinor: 168_000,
          reimbursementsMinor: 1206,
        },
        {
          weekStart: '2026-08-10',
          weekEnd: '2026-08-16',
          approvedAt: '2026-08-17T09:00:00.000Z',
          grossMinor: 112_000,
          reimbursementsMinor: 0,
        },
      ],
    });

    expect(csv).toBe(
      [
        'week_start,week_end,approved_at,gross_minor,reimbursements_minor,currency',
        '2026-08-03,2026-08-09,2026-08-10T09:30:00.000Z,168000,1206,USD',
        '2026-08-10,2026-08-16,2026-08-17T09:00:00.000Z,112000,0,USD',
        '',
        'carer_display_name,Marisol Reyes',
        'household_display_name,The Ahmeds',
        'range_start,2026-01-01',
        'range_end,2026-12-31',
        'weeks_included,2',
        'ytd_gross_minor,280000',
        'ytd_reimbursements_minor,1206',
        'currency,USD',
      ].join(CRLF) + CRLF
    );
  });

  it('omits household_display_name when absent', () => {
    const { csv } = renderCarerPaySummaryCsv({
      carerDisplayName: 'Marisol Reyes',
      currency: 'USD',
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      rows: [],
    });
    expect(csv).not.toContain('household_display_name');
  });

  it('sums gross and reimbursements exactly, in integer minor units, for a zero-row range', () => {
    const { csv } = renderCarerPaySummaryCsv({
      carerDisplayName: 'Marisol Reyes',
      currency: 'USD',
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      rows: [],
    });
    expect(csv).toContain('weeks_included,0');
    expect(csv).toContain('ytd_gross_minor,0');
    expect(csv).toContain('ytd_reimbursements_minor,0');
  });

  it('never formats a major-unit float or a currency symbol', () => {
    const { csv } = renderCarerPaySummaryCsv({
      carerDisplayName: 'Marisol Reyes',
      currency: 'USD',
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      rows: [
        {
          weekStart: '2026-08-03',
          weekEnd: '2026-08-09',
          approvedAt: '2026-08-10T09:30:00.000Z',
          grossMinor: 168_000,
          reimbursementsMinor: 1206,
        },
      ],
    });
    expect(csv).not.toContain('$');
    expect(csv).not.toContain('1680.00');
  });

  it('escapes a carer or household display name containing a comma', () => {
    const { csv } = renderCarerPaySummaryCsv({
      carerDisplayName: 'Reyes, Marisol',
      householdDisplayName: 'Smith, Jones',
      currency: 'USD',
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      rows: [],
    });
    expect(csv).toContain('carer_display_name,"Reyes, Marisol"');
    expect(csv).toContain('household_display_name,"Smith, Jones"');
  });

  it('names the file with the range and the carer slug', () => {
    const { filename } = renderCarerPaySummaryCsv({
      carerDisplayName: 'Marisol Reyes',
      currency: 'USD',
      rangeStart: '2026-01-01',
      rangeEnd: '2026-12-31',
      rows: [],
    });
    expect(filename).toBe(
      'steadily-pay-summary-2026-01-01-to-2026-12-31-marisol-reyes.csv'
    );
  });
});
