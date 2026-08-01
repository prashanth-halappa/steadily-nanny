import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let AvailabilityController: any;
let listOwn: any;
let listForUser: any;
let listBusyBlocks: any;
let upsertWeekday: any;

beforeAll(async () => {
  listOwn = mock(async () => [{ id: 'a1', weekday: 1 }]);
  listForUser = mock(async () => [{ id: 'a2', weekday: 3 }]);
  listBusyBlocks = mock(async () => [
    { starts_at: 's', ends_at: 'e', kind: 'time_off' },
  ]);
  upsertWeekday = mock(async () => ({ id: 'a1', weekday: 2 }));

  mock.module(
    '../../../../../src/domains/availability/services/availabilityQueryService',
    () => ({
      availabilityQueryService: { listOwn, listForUser, listBusyBlocks },
    })
  );
  mock.module(
    '../../../../../src/domains/availability/services/availabilityCommandService',
    () => ({
      availabilityCommandService: { upsertWeekday },
    })
  );

  AvailabilityController = (
    await import(
      '../../../../../src/domains/availability/controllers/availabilityController'
    )
  ).AvailabilityController;
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
  for (const m of [listOwn, listForUser, listBusyBlocks, upsertWeekday]) {
    m.mockClear?.();
  }
});

describe('AvailabilityController', () => {
  it('listOwn responds 200 with carer_availability', async () => {
    const res = mockRes();
    await AvailabilityController.listOwn(
      { user: { id: 'u1' } } as any,
      res,
      mock()
    );
    expect(listOwn).toHaveBeenCalledWith('u1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      carer_availability: [{ id: 'a1', weekday: 1 }],
    });
  });

  it('upsertOwn responds 200 with the singular upserted row', async () => {
    const res = mockRes();
    await AvailabilityController.upsertOwn(
      { user: { id: 'u1' }, body: { weekday: 2, is_available: true } } as any,
      res,
      mock()
    );
    expect(upsertWeekday).toHaveBeenCalledWith('u1', {
      weekday: 2,
      is_available: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      carer_availability: { id: 'a1', weekday: 2 },
    });
  });

  it('listForUser reads the userId param and responds with carer_availability', async () => {
    const res = mockRes();
    await AvailabilityController.listForUser(
      { user: { id: 'u1' }, params: { userId: 'carer-1' } } as any,
      res,
      mock()
    );
    expect(listForUser).toHaveBeenCalledWith('u1', 'carer-1');
    expect(res.body.data).toEqual({
      carer_availability: [{ id: 'a2', weekday: 3 }],
    });
  });

  it('listBusyBlocks reads the carerId param + validated from/to query and responds with busy_blocks', async () => {
    const res = mockRes();
    await AvailabilityController.listBusyBlocks(
      {
        user: { id: 'u1' },
        params: { carerId: 'carer-1' },
        validatedQuery: {
          from: '2026-08-01T00:00:00Z',
          to: '2026-08-07T00:00:00Z',
        },
      } as any,
      res,
      mock()
    );
    expect(listBusyBlocks).toHaveBeenCalledWith(
      'u1',
      'carer-1',
      '2026-08-01T00:00:00Z',
      '2026-08-07T00:00:00Z'
    );
    expect(res.body.data).toEqual({
      busy_blocks: [{ starts_at: 's', ends_at: 'e', kind: 'time_off' }],
    });
  });

  it('forwards service errors to next()', async () => {
    listForUser.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await AvailabilityController.listForUser(
      { user: { id: 'u1' }, params: { userId: 'carer-1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
