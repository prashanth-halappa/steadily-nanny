import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Controllers don't have the circular-import problem services can have, so
// top-level mock.module + a normal top import is fine here (docs/09-TESTING.md §4.2).
const listMembershipsForUser = mock(async () => [
  { id: 'm1', household_id: 'h1', role: 'owner' },
  { id: 'm2', household_id: 'h2', role: 'nanny' },
]);

mock.module(
  '../../../../../src/domains/household/services/householdQueryService',
  () => ({
    householdQueryService: { listMembershipsForUser },
  })
);

const { UserController } = await import(
  '../../../../../src/domains/user/controllers/userController'
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
  listMembershipsForUser.mockClear?.();
});

describe('UserController.listMemberships', () => {
  it('responds 200 with the caller memberships across all households', async () => {
    const res = mockRes();
    await UserController.listMemberships(
      { user: { id: 'u1' } } as any,
      res,
      mock()
    );
    expect(listMembershipsForUser).toHaveBeenCalledWith('u1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      household_members: [
        { id: 'm1', household_id: 'h1', role: 'owner' },
        { id: 'm2', household_id: 'h2', role: 'nanny' },
      ],
    });
  });

  it('forwards service errors to next()', async () => {
    listMembershipsForUser.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await UserController.listMemberships(
      { user: { id: 'u1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
