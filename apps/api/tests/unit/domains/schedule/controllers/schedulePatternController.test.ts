import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let SchedulePatternController: any;
let listForHousehold: any;
let getWithDays: any;
let create: any;
let update: any;
let replaceDays: any;
let send: any;
let amend: any;
let respond: any;
let withdraw: any;
let collectClashWarningsForPattern: any;
let patternWithAmendOverlay: any;

beforeAll(async () => {
  listForHousehold = mock(async () => [{ id: 'p1' }]);
  getWithDays = mock(async () => ({
    id: 'p1',
    days: [],
    carer_id: 'carer-1',
    exdates: [],
    pause_ranges: [],
    until: null,
  }));
  create = mock(async () => ({ id: 'p-new', status: 'draft' }));
  update = mock(async () => ({ id: 'p1', note: 'Updated' }));
  replaceDays = mock(async () => ({ id: 'p1', days: [] }));
  send = mock(async () => ({ id: 'p1', status: 'pending' }));
  amend = mock(async () => ({ id: 'p1', status: 'accepted', exdates: [] }));
  respond = mock(async () => ({ id: 'p1', status: 'accepted' }));
  withdraw = mock(async () => ({ id: 'p1', status: 'withdrawn' }));
  collectClashWarningsForPattern = mock(async () => []);
  patternWithAmendOverlay = mock((pattern: unknown, input: unknown) => ({
    ...(pattern as object),
    overlay: input,
  }));

  mock.module(
    '../../../../../src/domains/schedule/services/schedulePatternQueryService',
    () => ({
      schedulePatternQueryService: { listForHousehold, getWithDays },
    })
  );
  mock.module(
    '../../../../../src/domains/schedule/services/schedulePatternCommandService',
    () => ({
      schedulePatternCommandService: {
        create,
        update,
        replaceDays,
        send,
        amend,
        respond,
        withdraw,
      },
    })
  );
  mock.module(
    '../../../../../src/domains/schedule/services/patternClashWarnings',
    () => ({
      collectClashWarningsForPattern,
      patternWithAmendOverlay,
    })
  );

  SchedulePatternController = (
    await import(
      '../../../../../src/domains/schedule/controllers/schedulePatternController'
    )
  ).SchedulePatternController;
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
    listForHousehold,
    getWithDays,
    create,
    update,
    replaceDays,
    send,
    amend,
    respond,
    withdraw,
    collectClashWarningsForPattern,
    patternWithAmendOverlay,
  ]) {
    m.mockClear?.();
  }
});

/** True when `earlier` was invoked before `later` (Bun mock call order). */
function wasCalledBefore(
  earlier: { mock: { invocationCallOrder: number[] } },
  later: { mock: { invocationCallOrder: number[] } }
): boolean {
  const a = earlier.mock.invocationCallOrder[0];
  const b = later.mock.invocationCallOrder[0];
  return a !== undefined && b !== undefined && a < b;
}

describe('SchedulePatternController', () => {
  it('list responds 200 with schedule_patterns for the household', async () => {
    const res = mockRes();
    await SchedulePatternController.list(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      mock()
    );
    expect(listForHousehold).toHaveBeenCalledWith('u1', 'h1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ schedule_patterns: [{ id: 'p1' }] });
  });

  it('create responds 201 with the new draft', async () => {
    const res = mockRes();
    await SchedulePatternController.create(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        body: { rrule: 'FREQ=WEEKLY;INTERVAL=1', dtstart: '2026-02-02' },
      } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('u1', 'h1', {
      rrule: 'FREQ=WEEKLY;INTERVAL=1',
      dtstart: '2026-02-02',
    });
    expect(res.statusCode).toBe(201);
  });

  it('getById responds with the full days/children detail', async () => {
    const res = mockRes();
    await SchedulePatternController.getById(
      { user: { id: 'u1' }, params: { patternId: 'p1' } } as any,
      res,
      mock()
    );
    expect(getWithDays).toHaveBeenCalledWith('u1', 'p1');
    expect(res.body.data.schedule_pattern.id).toBe('p1');
  });

  it('update passes the body through', async () => {
    const res = mockRes();
    await SchedulePatternController.update(
      {
        user: { id: 'u1' },
        params: { patternId: 'p1' },
        body: { note: 'Updated' },
      } as any,
      res,
      mock()
    );
    expect(update).toHaveBeenCalledWith('u1', 'p1', { note: 'Updated' });
  });

  it('replaceDays passes the body through', async () => {
    const res = mockRes();
    await SchedulePatternController.replaceDays(
      {
        user: { id: 'u1' },
        params: { patternId: 'p1' },
        body: { days: [] },
      } as any,
      res,
      mock()
    );
    expect(replaceDays).toHaveBeenCalledWith('u1', 'p1', { days: [] });
  });

  it('send collects warnings before materialising command', async () => {
    const res = mockRes();
    await SchedulePatternController.send(
      { user: { id: 'u1' }, params: { patternId: 'p1' } } as any,
      res,
      mock()
    );
    expect(send).toHaveBeenCalledWith('u1', 'p1');
    expect(collectClashWarningsForPattern).toHaveBeenCalled();
    expect(wasCalledBefore(collectClashWarningsForPattern, send)).toBe(true);
    expect(res.body.data).toEqual({
      schedule_pattern: { id: 'p1', status: 'pending' },
      warnings: [],
    });
  });

  it('amend collects warnings (with overlay) before materialising command', async () => {
    const res = mockRes();
    const body = { exdates: ['2026-09-03'] };
    await SchedulePatternController.amend(
      {
        user: { id: 'u1' },
        params: { patternId: 'p1' },
        body,
      } as any,
      res,
      mock()
    );
    expect(patternWithAmendOverlay).toHaveBeenCalled();
    expect(amend).toHaveBeenCalledWith('u1', 'p1', body);
    expect(wasCalledBefore(collectClashWarningsForPattern, amend)).toBe(true);
    expect(res.body.data.warnings).toEqual([]);
  });

  it('respond collects warnings before accept materialises', async () => {
    const res = mockRes();
    await SchedulePatternController.respond(
      {
        user: { id: 'carer-1' },
        params: { patternId: 'p1' },
        body: { status: 'accepted' },
      } as any,
      res,
      mock()
    );
    expect(respond).toHaveBeenCalledWith('carer-1', 'p1', {
      status: 'accepted',
    });
    expect(collectClashWarningsForPattern).toHaveBeenCalled();
    expect(wasCalledBefore(collectClashWarningsForPattern, respond)).toBe(true);
    expect(res.body.data.warnings).toEqual([]);
  });

  it('respond skips warning collection on decline', async () => {
    respond.mockImplementationOnce(async () => ({
      id: 'p1',
      status: 'declined',
    }));
    const res = mockRes();
    await SchedulePatternController.respond(
      {
        user: { id: 'carer-1' },
        params: { patternId: 'p1' },
        body: { status: 'declined' },
      } as any,
      res,
      mock()
    );
    expect(collectClashWarningsForPattern).not.toHaveBeenCalled();
    expect(res.body.data.warnings).toEqual([]);
  });

  it('withdraw responds with the pattern now withdrawn', async () => {
    const res = mockRes();
    await SchedulePatternController.withdraw(
      { user: { id: 'u1' }, params: { patternId: 'p1' } } as any,
      res,
      mock()
    );
    expect(withdraw).toHaveBeenCalledWith('u1', 'p1');
    expect(res.body.data).toEqual({
      schedule_pattern: { id: 'p1', status: 'withdrawn' },
    });
  });

  it('forwards service errors to next()', async () => {
    getWithDays.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await SchedulePatternController.getById(
      { user: { id: 'u1' }, params: { patternId: 'p1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
