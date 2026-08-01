import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ChildController: any;
let listForHousehold: any;
let getOwned: any;
let create: any;
let update: any;
let archive: any;

beforeAll(async () => {
  listForHousehold = mock(async () => [{ id: 'c1' }]);
  getOwned = mock(async () => ({ id: 'c1', name: 'Maya' }));
  create = mock(async () => ({ id: 'c-new', name: 'Maya' }));
  update = mock(async () => ({ id: 'c1', name: 'Maya R.' }));
  archive = mock(async () => ({ id: 'c1', archived_at: 't' }));

  mock.module(
    '../../../../../src/domains/child/services/childQueryService',
    () => ({
      childQueryService: { listForHousehold, getOwned },
    })
  );
  mock.module(
    '../../../../../src/domains/child/services/childCommandService',
    () => ({
      childCommandService: { create, update, archive },
    })
  );

  ChildController = (
    await import('../../../../../src/domains/child/controllers/childController')
  ).ChildController;
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
  for (const m of [listForHousehold, getOwned, create, update, archive]) {
    m.mockClear?.();
  }
});

describe('ChildController', () => {
  it('list responds 200 with children', async () => {
    const res = mockRes();
    await ChildController.list(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      mock()
    );
    expect(listForHousehold).toHaveBeenCalledWith('u1', 'h1');
    expect(res.body.data).toEqual({ children: [{ id: 'c1' }] });
  });

  it('getById reads both params', async () => {
    const res = mockRes();
    await ChildController.getById(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', childId: 'c1' },
      } as any,
      res,
      mock()
    );
    expect(getOwned).toHaveBeenCalledWith('u1', 'h1', 'c1');
  });

  it('create responds 201', async () => {
    const res = mockRes();
    await ChildController.create(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        body: { name: 'Maya' },
      } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('u1', 'h1', { name: 'Maya' });
    expect(res.statusCode).toBe(201);
  });

  it('update passes the body through', async () => {
    const res = mockRes();
    await ChildController.update(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', childId: 'c1' },
        body: { name: 'Maya R.' },
      } as any,
      res,
      mock()
    );
    expect(update).toHaveBeenCalledWith('u1', 'h1', 'c1', { name: 'Maya R.' });
  });

  it('remove archives rather than deleting', async () => {
    const res = mockRes();
    await ChildController.remove(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', childId: 'c1' },
      } as any,
      res,
      mock()
    );
    expect(archive).toHaveBeenCalledWith('u1', 'h1', 'c1');
    expect(res.body.data).toEqual({ child: { id: 'c1', archived_at: 't' } });
  });

  it('forwards service errors to next()', async () => {
    getOwned.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await ChildController.getById(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', childId: 'c1' },
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
