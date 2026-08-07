import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ShiftController: any;
let listForHousehold: any;
let getOwned: any;
let listEvents: any;
let update: any;
let accept: any;
let decline: any;

beforeAll(async () => {
  listForHousehold = mock(async () => [{ id: 's1' }]);
  getOwned = mock(async () => ({ id: 's1' }));
  listEvents = mock(async () => [{ id: 'e1' }]);
  update = mock(async () => ({ id: 's1', note: 'Updated' }));
  accept = mock(async () => ({
    id: 's1',
    status: 'confirmed',
    carer_id: null,
    starts_at: '2026-08-05T09:00:00.000Z',
    ends_at: '2026-08-05T17:00:00.000Z',
    timezone: 'UTC',
  }));

  mock.module(
    '../../../../../src/domains/shift/services/shiftQueryService',
    () => ({
      shiftQueryService: { listForHousehold, getOwned, listEvents },
    })
  );
  decline = mock(async () => ({
    id: 's1',
    status: 'declined',
    carer_id: 'carer-1',
    starts_at: '2026-08-05T09:00:00.000Z',
    ends_at: '2026-08-05T17:00:00.000Z',
    timezone: 'UTC',
  }));

  mock.module(
    '../../../../../src/domains/shift/services/shiftCommandService',
    () => ({
      shiftCommandService: { update, accept, decline },
    })
  );
  mock.module('../../../../../src/domains/me/services/clashWarning', () => ({
    collectClashWarningsForCarer: mock(async () => []),
  }));

  ShiftController = (
    await import('../../../../../src/domains/shift/controllers/shiftController')
  ).ShiftController;
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
    getOwned,
    listEvents,
    update,
    accept,
    decline,
  ]) {
    m.mockClear?.();
  }
});

describe('ShiftController', () => {
  it('listForHousehold responds 200 with shifts for the household range', async () => {
    const res = mockRes();
    await ShiftController.listForHousehold(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        validatedQuery: {
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-08T00:00:00.000Z',
        },
      } as any,
      res,
      mock()
    );
    expect(listForHousehold).toHaveBeenCalledWith(
      'u1',
      'h1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z'
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ shifts: [{ id: 's1' }] });
  });

  it('getById responds with one shift', async () => {
    const res = mockRes();
    await ShiftController.getById(
      { user: { id: 'u1' }, params: { shiftId: 's1' } } as any,
      res,
      mock()
    );
    expect(getOwned).toHaveBeenCalledWith('u1', 's1');
    expect(res.body.data).toEqual({ shift: { id: 's1' } });
  });

  it('listEvents responds with the day thread', async () => {
    const res = mockRes();
    await ShiftController.listEvents(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', shiftId: 's1' },
      } as any,
      res,
      mock()
    );
    expect(listEvents).toHaveBeenCalledWith('u1', 'h1', 's1');
    expect(res.body.data).toEqual({ shift_events: [{ id: 'e1' }] });
  });

  it('update passes the body through', async () => {
    const res = mockRes();
    await ShiftController.update(
      {
        user: { id: 'u1' },
        params: { shiftId: 's1' },
        body: { note: 'Updated' },
      } as any,
      res,
      mock()
    );
    expect(update).toHaveBeenCalledWith('u1', 's1', { note: 'Updated' });
    expect(res.body.data).toEqual({
      shift: { id: 's1', note: 'Updated' },
      warnings: [],
    });
  });

  it('accept delegates to the command service', async () => {
    const res = mockRes();
    await ShiftController.accept(
      { user: { id: 'carer-1' }, params: { shiftId: 's1' } } as any,
      res,
      mock()
    );
    expect(accept).toHaveBeenCalledWith('carer-1', 's1');
    expect(res.body.data.shift).toMatchObject({
      id: 's1',
      status: 'confirmed',
    });
    expect(res.body.data.warnings).toEqual([]);
  });

  it('decline delegates to the command service', async () => {
    const res = mockRes();
    await ShiftController.decline(
      { user: { id: 'carer-1' }, params: { shiftId: 's1' } } as any,
      res,
      mock()
    );
    expect(decline).toHaveBeenCalledWith('carer-1', 's1');
    expect(res.statusCode).toBe(200);
    // No clash warnings on the decline leg: a declined shift is not on the
    // carer's calendar at all, so there is nothing for it to clash with.
    expect(res.body.data).toEqual({
      shift: {
        id: 's1',
        status: 'declined',
        carer_id: 'carer-1',
        starts_at: '2026-08-05T09:00:00.000Z',
        ends_at: '2026-08-05T17:00:00.000Z',
        timezone: 'UTC',
      },
    });
  });

  it('decline forwards service errors to next()', async () => {
    decline.mockImplementationOnce(async () => {
      throw new Error('not pending');
    });
    const res = mockRes();
    const next = mock();
    await ShiftController.decline(
      { user: { id: 'carer-1' }, params: { shiftId: 's1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it('forwards service errors to next()', async () => {
    getOwned.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await ShiftController.getById(
      { user: { id: 'u1' }, params: { shiftId: 's1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
