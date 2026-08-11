/**
 * @module tests/unit/domains/timesheet/controllers/timesheetController.paySummary
 *
 * `GET /households/:householdId/timesheets/{pay-summary,year-end}.csv`
 * (D-29) — same download-not-envelope contract as `exportCsv`; every
 * refusal is decided in the service.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimesheetController: any;
let exportCarerPaySummaryCsv: any;
let exportYearEndSummaryCsv: any;

beforeAll(async () => {
  exportCarerPaySummaryCsv = mock(async () => ({
    filename: 'steadily-pay-summary-2026-01-01-to-2026-12-31-marisol-reyes.csv',
    csv: 'week_start,week_end,approved_at,gross_minor,reimbursements_minor,currency\r\n',
  }));
  exportYearEndSummaryCsv = mock(async () => ({
    filename: 'steadily-year-end-2026.csv',
    csv: 'carer_display_name,gross_minor,reimbursements_minor,weeks_included,currency\r\n',
  }));

  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: {
        exportCarerPaySummaryCsv,
        exportYearEndSummaryCsv,
      },
    })
  );
  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetCommandService',
    () => ({ timesheetCommandService: {} })
  );

  TimesheetController = (
    await import(
      '../../../../../src/domains/timesheet/controllers/timesheetController'
    )
  ).TimesheetController;
});

function mockRes(): any {
  const res: any = {
    locals: { requestId: 'req-1' },
    req: { path: '/x' },
    headers: {} as Record<string, string>,
  };
  res.setHeader = mock((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  });
  res.send = mock((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

beforeEach(() => {
  exportCarerPaySummaryCsv.mockClear();
  exportYearEndSummaryCsv.mockClear();
});

describe('TimesheetController.exportCarerPaySummaryCsv', () => {
  it('resolves a year query into from/to and sends the CSV body with download headers', async () => {
    const res = mockRes();

    await TimesheetController.exportCarerPaySummaryCsv(
      {
        user: { id: 'u1' },
        params: { householdId: 'h-1' },
        validatedQuery: { year: 2026, carer_id: 'carer-1' },
      } as any,
      res,
      mock()
    );

    expect(exportCarerPaySummaryCsv).toHaveBeenCalledWith('u1', 'h-1', {
      carerId: 'carer-1',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['Content-Disposition']).toContain(
      'attachment; filename='
    );
  });

  it('passes an explicit from/to range through unchanged', async () => {
    const res = mockRes();

    await TimesheetController.exportCarerPaySummaryCsv(
      {
        user: { id: 'u1' },
        params: { householdId: 'h-1' },
        validatedQuery: { from: '2026-08-03', to: '2026-08-09' },
      } as any,
      res,
      mock()
    );

    expect(exportCarerPaySummaryCsv).toHaveBeenCalledWith('u1', 'h-1', {
      carerId: undefined,
      from: '2026-08-03',
      to: '2026-08-09',
    });
  });

  it('forwards a service refusal to the error handler and sends nothing', async () => {
    const res = mockRes();
    const next = mock();
    const boom = new Error('carer required');
    exportCarerPaySummaryCsv.mockImplementationOnce(async () => {
      throw boom;
    });

    await TimesheetController.exportCarerPaySummaryCsv(
      {
        user: { id: 'u1' },
        params: { householdId: 'h-1' },
        validatedQuery: { year: 2026 },
      } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe('TimesheetController.exportYearEndSummaryCsv', () => {
  it('sends the CSV body with the download headers', async () => {
    const res = mockRes();

    await TimesheetController.exportYearEndSummaryCsv(
      {
        user: { id: 'u1' },
        params: { householdId: 'h-1' },
        validatedQuery: { year: 2026 },
      } as any,
      res,
      mock()
    );

    expect(exportYearEndSummaryCsv).toHaveBeenCalledWith('u1', 'h-1', 2026);
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="steadily-year-end-2026.csv"'
    );
  });

  it('forwards a service refusal to the error handler', async () => {
    const res = mockRes();
    const next = mock();
    const boom = new Error('mixed currency');
    exportYearEndSummaryCsv.mockImplementationOnce(async () => {
      throw boom;
    });

    await TimesheetController.exportYearEndSummaryCsv(
      {
        user: { id: 'u1' },
        params: { householdId: 'h-1' },
        validatedQuery: { year: 2026 },
      } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.send).not.toHaveBeenCalled();
  });
});
