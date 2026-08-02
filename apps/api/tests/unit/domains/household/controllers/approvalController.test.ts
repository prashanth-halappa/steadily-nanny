import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Controllers don't have the circular-import problem services can have, so
// top-level mock.module + a normal top import is fine (docs/09-TESTING.md §4.2).
const listPending = mock(async () => [{ id: 'a1', status: 'pending' }]);
const respond = mock(async () => ({ id: 'a1', status: 'approved' }));

mock.module(
  '../../../../../src/domains/household/services/coParentApprovalQueryService',
  () => ({ coParentApprovalQueryService: { listPending } })
);
mock.module(
  '../../../../../src/domains/household/services/coParentApprovalCommandService',
  () => ({ coParentApprovalCommandService: { respond } })
);

const { ApprovalController } = await import(
  '../../../../../src/domains/household/controllers/approvalController'
);

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
  listPending.mockClear?.();
  respond.mockClear?.();
});

describe('ApprovalController.listPending', () => {
  it('responds with co_parent_approvals for the household', async () => {
    const res = mockRes();
    await ApprovalController.listPending(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      mock()
    );
    expect(listPending).toHaveBeenCalledWith('u1', 'h1');
    expect(res.body.data).toEqual({
      co_parent_approvals: [{ id: 'a1', status: 'pending' }],
    });
  });

  it('forwards service errors to next()', async () => {
    listPending.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await ApprovalController.listPending(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('ApprovalController.respond', () => {
  it('passes householdId, approvalId, and body through to the command service', async () => {
    const res = mockRes();
    await ApprovalController.respond(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', approvalId: 'a1' },
        body: { status: 'approved' },
      } as any,
      res,
      mock()
    );
    expect(respond).toHaveBeenCalledWith('u1', 'h1', 'a1', {
      status: 'approved',
    });
    expect(res.body.data).toEqual({
      approval: { id: 'a1', status: 'approved' },
    });
  });
});
