import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimesheetController: any;
let getRunning: any;
let listForHouseholdWeek: any;
let listTimesheetsForHousehold: any;
let getWeekWithEarnings: any;
let clockIn: any;
let clockOut: any;
let createRetroactiveEntry: any;
let voidEntry: any;
let approve: any;
let queryTimesheet: any;
let reopen: any;

beforeAll(async () => {
  getRunning = mock(async () => null);
  listForHouseholdWeek = mock(async () => [{ id: 't1' }]);
  listTimesheetsForHousehold = mock(async () => [{ id: 'ts1' }]);
  getWeekWithEarnings = mock(async () => ({
    id: 'ts1',
    status: 'submitted',
    earnings: { status: 'ok', gross_minor: 14_800 },
  }));
  clockIn = mock(async () => ({ id: 't-new', status: 'running' }));
  clockOut = mock(async () => ({ id: 't1', status: 'submitted' }));
  createRetroactiveEntry = mock(async () => ({
    id: 't-retro',
    status: 'submitted',
  }));
  voidEntry = mock(async () => ({ id: 't1', status: 'voided' }));
  approve = mock(async () => ({ id: 'ts1', status: 'approved' }));
  queryTimesheet = mock(async () => ({ id: 'ts1', status: 'queried' }));
  reopen = mock(async () => ({ id: 'ts1', status: 'submitted' }));

  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetQueryService',
    () => ({
      timesheetQueryService: {
        getRunning,
        listForHouseholdWeek,
        listTimesheetsForHousehold,
        getWeekWithEarnings,
      },
    })
  );
  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetCommandService',
    () => ({
      timesheetCommandService: {
        clockIn,
        clockOut,
        createRetroactiveEntry,
        voidEntry,
        approve,
        query: queryTimesheet,
        reopen,
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
    getWeekWithEarnings,
    clockIn,
    clockOut,
    createRetroactiveEntry,
    voidEntry,
    approve,
    queryTimesheet,
    reopen,
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

  it('voidEntry passes the id param through and returns the voided entry', async () => {
    const res = mockRes();
    await TimesheetController.voidEntry(
      { user: { id: 'carer-1' }, params: { id: 't1' } } as any,
      res,
      mock()
    );
    expect(voidEntry).toHaveBeenCalledWith('carer-1', 't1');
    expect(res.body.data).toEqual({
      time_entry: { id: 't1', status: 'voided' },
    });
  });

  it('createRetroactiveEntry responds 201 with the submitted entry', async () => {
    const res = mockRes();
    const body = {
      household_id: 'h1',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T16:00:00.000Z',
    };
    await TimesheetController.createRetroactiveEntry(
      { user: { id: 'carer-1' }, body } as any,
      res,
      mock()
    );
    expect(createRetroactiveEntry).toHaveBeenCalledWith('carer-1', body);
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      time_entry: { id: 't-retro', status: 'submitted' },
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

  it('listForHouseholdWeek reads week_start and carer_id from validatedQuery', async () => {
    const res = mockRes();
    await TimesheetController.listForHouseholdWeek(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        validatedQuery: { week_start: '2026-08-03', carer_id: 'carer-1' },
      } as any,
      res,
      mock()
    );
    expect(listForHouseholdWeek).toHaveBeenCalledWith(
      'u1',
      'h1',
      '2026-08-03',
      'carer-1'
    );
    expect(res.body.data).toEqual({ time_entries: [{ id: 't1' }] });
  });

  it('listForHouseholdWeek leaves the carer filter undefined when it is absent', async () => {
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
    expect(listForHouseholdWeek).toHaveBeenCalledWith(
      'u1',
      'h1',
      '2026-08-03',
      undefined
    );
  });

  it('listTimesheetsForHousehold responds with the household timesheets, scoped to the carer when asked', async () => {
    const res = mockRes();
    await TimesheetController.listTimesheetsForHousehold(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        validatedQuery: { carer_id: 'carer-1' },
      } as any,
      res,
      mock()
    );
    expect(listTimesheetsForHousehold).toHaveBeenCalledWith(
      'u1',
      'h1',
      'carer-1'
    );
    expect(res.body.data).toEqual({ timesheets: [{ id: 'ts1' }] });
  });

  it('listTimesheetsForHousehold serves every carer when no filter is given', async () => {
    const res = mockRes();
    await TimesheetController.listTimesheetsForHousehold(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        validatedQuery: {},
      } as any,
      res,
      mock()
    );
    expect(listTimesheetsForHousehold).toHaveBeenCalledWith(
      'u1',
      'h1',
      undefined
    );
  });

  it('approve passes the id param and the body through', async () => {
    const res = mockRes();
    await TimesheetController.approve(
      { user: { id: 'parent-1' }, params: { id: 'ts1' }, body: {} } as any,
      res,
      mock()
    );
    expect(approve).toHaveBeenCalledWith('parent-1', 'ts1', {});
    expect(res.body.data).toEqual({
      timesheet: { id: 'ts1', status: 'approved' },
    });
  });

  it('approve forwards the validated adjustment untouched', async () => {
    const res = mockRes();
    const body = {
      adjustment: { amount_minor: -2000, note: 'Advance repaid' },
    };
    await TimesheetController.approve(
      { user: { id: 'parent-1' }, params: { id: 'ts1' }, body } as any,
      res,
      mock()
    );
    expect(approve).toHaveBeenCalledWith('parent-1', 'ts1', body);
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

  it('reopen passes the id param and reason through', async () => {
    const res = mockRes();
    await TimesheetController.reopen(
      {
        user: { id: 'parent-1' },
        params: { id: 'ts1' },
        body: { reason: 'Thursday hours were wrong' },
      } as any,
      res,
      mock()
    );
    expect(reopen).toHaveBeenCalledWith('parent-1', 'ts1', {
      reason: 'Thursday hours were wrong',
    });
    expect(res.body.data).toEqual({
      timesheet: { id: 'ts1', status: 'submitted' },
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

  it('getWeek returns the week with its earnings attached', async () => {
    const res = mockRes();
    await TimesheetController.getWeek(
      { user: { id: 'u1' }, params: { id: 'ts1' } } as any,
      res,
      mock()
    );
    expect(getWeekWithEarnings).toHaveBeenCalledWith('u1', 'ts1');
    expect(res.body.data).toEqual({
      timesheet: {
        id: 'ts1',
        status: 'submitted',
        earnings: { status: 'ok', gross_minor: 14_800 },
      },
    });
  });
});
