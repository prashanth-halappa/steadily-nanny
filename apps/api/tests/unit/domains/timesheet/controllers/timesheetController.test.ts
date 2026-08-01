import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimesheetController: any;
let getRunning: any;
let listForHouseholdWeek: any;
let listTimesheetsForHousehold: any;
let clockIn: any;
let clockOut: any;
let approve: any;
let queryTimesheet: any;

beforeAll(async () => {
  getRunning = mock(async () => null);
  listForHouseholdWeek = mock(async () => [{ id: 't1' }]);
  listTimesheetsForHousehold = mock(async () => [{ id: 'ts1' }]);
  clockIn = mock(async () => ({ id: 't-new', status: 'running' }));
  clockOut = mock(async () => ({ id: 't1', status: 'submitted' }));
  approve = mock(async () => ({ id: 'ts1', status: 'approved' }));
  queryTimesheet = mock(async () => ({ id: 'ts1', status: 'queried' }));

  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: {
        getRunning,
        listForHouseholdWeek,
        listTimesheetsForHousehold,
      },
    })
  );
  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetCommandService',
    () => ({
      timesheetCommandService: {
        clockIn,
        clockOut,
        approve,
        query: queryTimesheet,
      },
    })
  );

  TimesheetController = (
    await import(
      '../../../../../src/domains/timesheet/controllers/timesheetController'
    )
  ).TimesheetController;
});

function mockRes(): any {
  const res: any = { locals: { requestId: 'req-1' }, req: { path: '/x' } };
  res.status = mock((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = mock((body: any) => {
    res.body = body;
    return res;
  });
  return res;
}

beforeEach(() => {
  for (const m of [
    getRunning,
    listForHouseholdWeek,
    listTimesheetsForHousehold,
    clockIn,
    clockOut,
    approve,
    queryTimesheet,
  ]) {
    m.mockClear?.();
  }
});

describe('TimesheetController', () => {
  it('clockIn responds 201 with the new running entry', async () => {
    const res = mockRes();
    await TimesheetController.clockIn(
      { user: { id: 'carer-1' }, body: { household_id: 'h1' } } as any,
      res,
      mock()
    );
    expect(clockIn).toHaveBeenCalledWith('carer-1', { household_id: 'h1' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      time_entry: { id: 't-new', status: 'running' },
    });
  });

  it('clockOut passes the id param and body through', async () => {
    const res = mockRes();
    await TimesheetController.clockOut(
      {
        user: { id: 'carer-1' },
        params: { id: 't1' },
        body: { break_minutes: 30 },
      } as any,
      res,
      mock()
    );
    expect(clockOut).toHaveBeenCalledWith('carer-1', 't1', {
      break_minutes: 30,
    });
    expect(res.body.data).toEqual({
      time_entry: { id: 't1', status: 'submitted' },
    });
  });

  it('getRunning responds with null when nothing is running', async () => {
    const res = mockRes();
    await TimesheetController.getRunning(
      { user: { id: 'carer-1' } } as any,
      res,
      mock()
    );
    expect(getRunning).toHaveBeenCalledWith('carer-1');
    expect(res.body.data).toEqual({ time_entry: null });
  });

  it('listForHouseholdWeek reads week_start from validatedQuery', async () => {
    const res = mockRes();
    await TimesheetController.listForHouseholdWeek(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        validatedQuery: { week_start: '2026-08-03' },
      } as any,
      res,
      mock()
    );
    expect(listForHouseholdWeek).toHaveBeenCalledWith('u1', 'h1', '2026-08-03');
    expect(res.body.data).toEqual({ time_entries: [{ id: 't1' }] });
  });

  it('listTimesheetsForHousehold responds with the household timesheets', async () => {
    const res = mockRes();
    await TimesheetController.listTimesheetsForHousehold(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      mock()
    );
    expect(listTimesheetsForHousehold).toHaveBeenCalledWith('u1', 'h1');
    expect(res.body.data).toEqual({ timesheets: [{ id: 'ts1' }] });
  });

  it('approve passes the id param through', async () => {
    const res = mockRes();
    await TimesheetController.approve(
      { user: { id: 'parent-1' }, params: { id: 'ts1' } } as any,
      res,
      mock()
    );
    expect(approve).toHaveBeenCalledWith('parent-1', 'ts1');
    expect(res.body.data).toEqual({
      timesheet: { id: 'ts1', status: 'approved' },
    });
  });

  it('query passes the id param and note through', async () => {
    const res = mockRes();
    await TimesheetController.query(
      {
        user: { id: 'parent-1' },
        params: { id: 'ts1' },
        body: { note: 'Query Thursday' },
      } as any,
      res,
      mock()
    );
    expect(queryTimesheet).toHaveBeenCalledWith('parent-1', 'ts1', {
      note: 'Query Thursday',
    });
  });

  it('forwards service errors to next()', async () => {
    clockIn.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await TimesheetController.clockIn(
      { user: { id: 'carer-1' }, body: {} } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
