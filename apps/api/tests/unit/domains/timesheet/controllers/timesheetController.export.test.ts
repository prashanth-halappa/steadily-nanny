/**
 * @module tests/unit/domains/timesheet/controllers/timesheetController.export
 *
 * `GET /timesheets/:id/export.csv` is the ONE timesheet response that is not
 * the house JSON envelope — a browser/mobile download of a payroll file. The
 * headers are therefore part of the contract, not decoration.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimesheetController: any;
let exportWeekCsv: any;

beforeAll(async () => {
  exportWeekCsv = mock(async () => ({
    filename: 'steadily-week-2026-08-03-nia-rowe.csv',
    csv: 'date,description,kind,minutes,rate_minor,amount_minor,currency\r\n',
  }));

  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: { exportWeekCsv },
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
  exportWeekCsv.mockClear();
});

describe('TimesheetController.exportCsv', () => {
  it('sends the CSV body with the download headers', async () => {
    const res = mockRes();

    await TimesheetController.exportCsv(
      { user: { id: 'u1' }, params: { id: 'ts-1' } } as any,
      res,
      mock()
    );

    expect(exportWeekCsv).toHaveBeenCalledWith('u1', 'ts-1');
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="steadily-week-2026-08-03-nia-rowe.csv"'
    );
    expect(res.body).toBe(
      'date,description,kind,minutes,rate_minor,amount_minor,currency\r\n'
    );
  });

  it('forwards a service refusal to the error handler and sends nothing', async () => {
    const res = mockRes();
    const next = mock();
    const boom = new Error('not exportable');
    exportWeekCsv.mockImplementationOnce(async () => {
      throw boom;
    });

    await TimesheetController.exportCsv(
      { user: { id: 'u1' }, params: { id: 'ts-1' } } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.send).not.toHaveBeenCalled();
  });
});
