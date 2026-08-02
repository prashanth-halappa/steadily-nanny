import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimeOffController: any;
let listOwn: any;
let create: any;
let cancel: any;
let update: any;

beforeAll(async () => {
  listOwn = mock(async () => [{ id: 't1', status: 'confirmed' }]);
  create = mock(async () => ({ id: 't-new', status: 'confirmed' }));
  cancel = mock(async () => ({ id: 't1', status: 'cancelled' }));
  update = mock(async () => ({
    id: 't1',
    status: 'confirmed',
    message: 'Updated',
  }));

  mock.module(
    '../../../../../src/domains/availability/services/timeOffQueryService',
    () => ({
      timeOffQueryService: { listOwn },
    })
  );
  mock.module(
    '../../../../../src/domains/availability/services/timeOffCommandService',
    () => ({
      timeOffCommandService: { create, cancel, update },
    })
  );

  TimeOffController = (
    await import(
      '../../../../../src/domains/availability/controllers/timeOffController'
    )
  ).TimeOffController;
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
  for (const m of [listOwn, create, cancel, update]) {
    m.mockClear?.();
  }
});

describe('TimeOffController', () => {
  it('list responds 200 with carer_time_off', async () => {
    const res = mockRes();
    await TimeOffController.list({ user: { id: 'u1' } } as any, res, mock());
    expect(listOwn).toHaveBeenCalledWith('u1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      carer_time_off: [{ id: 't1', status: 'confirmed' }],
    });
  });

  it('create responds 201', async () => {
    const res = mockRes();
    await TimeOffController.create(
      {
        user: { id: 'u1' },
        body: { starts_at: 's', ends_at: 'e' },
      } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('u1', { starts_at: 's', ends_at: 'e' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      carer_time_off: { id: 't-new', status: 'confirmed' },
    });
  });

  it('update reads the id param and body and responds 200 with the updated row', async () => {
    const res = mockRes();
    await TimeOffController.update(
      {
        user: { id: 'u1' },
        params: { id: 't1' },
        body: { message: 'Updated' },
      } as any,
      res,
      mock()
    );
    expect(update).toHaveBeenCalledWith('u1', 't1', { message: 'Updated' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      carer_time_off: { id: 't1', status: 'confirmed', message: 'Updated' },
    });
  });

  it('remove reads the id param and responds 200 with the cancelled row', async () => {
    const res = mockRes();
    await TimeOffController.remove(
      { user: { id: 'u1' }, params: { id: 't1' } } as any,
      res,
      mock()
    );
    expect(cancel).toHaveBeenCalledWith('u1', 't1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      carer_time_off: { id: 't1', status: 'cancelled' },
    });
  });

  it('forwards service errors to next()', async () => {
    cancel.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await TimeOffController.remove(
      { user: { id: 'u1' }, params: { id: 't1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
