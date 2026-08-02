import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ChildCommitmentController: any;
let listForChild: any;
let getOwned: any;
let create: any;
let update: any;
let remove: any;

beforeAll(async () => {
  listForChild = mock(async () => [{ id: 'cm1' }]);
  getOwned = mock(async () => ({ id: 'cm1', household_id: 'h1' }));
  create = mock(async () => ({ id: 'cm-new', label: 'Preschool' }));
  update = mock(async () => ({ id: 'cm1', label: 'Nursery' }));
  remove = mock(async () => undefined);

  mock.module(
    '../../../../../src/domains/child/services/childCommitmentQueryService',
    () => ({
      childCommitmentQueryService: { listForChild, getOwned },
    })
  );
  mock.module(
    '../../../../../src/domains/child/services/childCommitmentCommandService',
    () => ({
      childCommitmentCommandService: { create, update, remove },
    })
  );

  ChildCommitmentController = (
    await import(
      '../../../../../src/domains/child/controllers/childCommitmentController'
    )
  ).ChildCommitmentController;
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
  for (const m of [listForChild, getOwned, create, update, remove]) {
    m.mockClear?.();
  }
});

describe('ChildCommitmentController', () => {
  it('list responds 200 with child_commitments', async () => {
    const res = mockRes();
    await ChildCommitmentController.list(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', childId: 'c1' },
      } as any,
      res,
      mock()
    );
    expect(listForChild).toHaveBeenCalledWith('u1', 'h1', 'c1');
    expect(res.body.data).toEqual({ child_commitments: [{ id: 'cm1' }] });
  });

  it('create responds 201', async () => {
    const res = mockRes();
    await ChildCommitmentController.create(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', childId: 'c1' },
        body: { label: 'Preschool' },
      } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('u1', 'h1', 'c1', {
      label: 'Preschool',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      child_commitment: { id: 'cm-new', label: 'Preschool' },
    });
  });

  it('update passes the body through using the flat commitmentId param', async () => {
    const res = mockRes();
    await ChildCommitmentController.update(
      {
        user: { id: 'u1' },
        params: { commitmentId: 'cm1' },
        body: { label: 'Nursery' },
      } as any,
      res,
      mock()
    );
    expect(update).toHaveBeenCalledWith('u1', 'cm1', { label: 'Nursery' });
  });

  it('remove hard-deletes and responds with success:true', async () => {
    const res = mockRes();
    await ChildCommitmentController.remove(
      { user: { id: 'u1' }, params: { commitmentId: 'cm1' } } as any,
      res,
      mock()
    );
    expect(remove).toHaveBeenCalledWith('u1', 'cm1');
    expect(res.body.data).toEqual({ success: true });
  });

  it('forwards service errors to next()', async () => {
    update.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await ChildCommitmentController.update(
      {
        user: { id: 'u1' },
        params: { commitmentId: 'cm1' },
        body: { label: 'Nursery' },
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
