import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// The controller delegates to the two service singletons; mock them and assert
// the HTTP shaping (status code + envelope payload) and error forwarding.
let HouseholdController: any;
let listForUser: any;
let getOwned: any;
let listMembers: any;
let previewInvite: any;
let create: any;
let update: any;
let createInvite: any;
let redeemInvite: any;
let removeMember: any;
let revokeInvite: any;

beforeAll(async () => {
  listForUser = mock(async () => [{ id: 'h1' }]);
  getOwned = mock(async () => ({ id: 'h1', name: 'The Smiths' }));
  listMembers = mock(async () => [{ id: 'm1' }]);
  previewInvite = mock(async () => ({
    household_name: 'The Smiths',
    children_first_names: ['Maya'],
    role: 'nanny',
  }));
  create = mock(async () => ({ id: 'h-new' }));
  update = mock(async () => ({ id: 'h1', name: 'Updated' }));
  createInvite = mock(async () => ({ id: 'i1', code: 'ABC-234' }));
  redeemInvite = mock(async () => ({ id: 'm-new', role: 'nanny' }));
  removeMember = mock(async () => ({ id: 'm-target', status: 'removed' }));
  revokeInvite = mock(async () => ({ id: 'i1', status: 'revoked' }));

  mock.module(
    '../../../../../src/domains/household/services/householdQueryService',
    () => ({
      householdQueryService: {
        listForUser,
        getOwned,
        listMembers,
        previewInvite,
      },
    })
  );
  mock.module(
    '../../../../../src/domains/household/services/householdCommandService',
    () => ({
      householdCommandService: {
        create,
        update,
        createInvite,
        redeemInvite,
        removeMember,
        revokeInvite,
      },
    })
  );

  HouseholdController = (
    await import(
      '../../../../../src/domains/household/controllers/householdController'
    )
  ).HouseholdController;
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
    listForUser,
    getOwned,
    listMembers,
    previewInvite,
    create,
    update,
    createInvite,
    redeemInvite,
    removeMember,
    revokeInvite,
  ]) {
    m.mockClear?.();
  }
});

describe('HouseholdController', () => {
  it('list responds 200 with households', async () => {
    const res = mockRes();
    await HouseholdController.list({ user: { id: 'u1' } } as any, res, mock());
    expect(listForUser).toHaveBeenCalledWith('u1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ households: [{ id: 'h1' }] });
  });

  it('create responds 201', async () => {
    const res = mockRes();
    await HouseholdController.create(
      { user: { id: 'u1' }, body: { name: 'The Smiths' } } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('u1', { name: 'The Smiths' });
    expect(res.statusCode).toBe(201);
  });

  it('getById reads the householdId param', async () => {
    const res = mockRes();
    await HouseholdController.getById(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      mock()
    );
    expect(getOwned).toHaveBeenCalledWith('u1', 'h1');
    expect(res.body.data).toEqual({
      household: { id: 'h1', name: 'The Smiths' },
    });
  });

  it('update passes body through to the command service', async () => {
    const res = mockRes();
    await HouseholdController.update(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        body: { name: 'Updated' },
      } as any,
      res,
      mock()
    );
    expect(update).toHaveBeenCalledWith('u1', 'h1', { name: 'Updated' });
  });

  it('listMembers responds with household_members', async () => {
    const res = mockRes();
    await HouseholdController.listMembers(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      mock()
    );
    expect(listMembers).toHaveBeenCalledWith('u1', 'h1');
    expect(res.body.data).toEqual({ household_members: [{ id: 'm1' }] });
  });

  it('createInvite responds 201', async () => {
    const res = mockRes();
    await HouseholdController.createInvite(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1' },
        body: { role: 'nanny' },
      } as any,
      res,
      mock()
    );
    expect(createInvite).toHaveBeenCalledWith('u1', 'h1', { role: 'nanny' });
    expect(res.statusCode).toBe(201);
  });

  it('redeemInvite responds with the new membership', async () => {
    const res = mockRes();
    await HouseholdController.redeemInvite(
      { user: { id: 'u1' }, body: { code: 'ABC-234' } } as any,
      res,
      mock()
    );
    expect(redeemInvite).toHaveBeenCalledWith('u1', { code: 'ABC-234' });
  });

  it('previewInvite reads the code param and requires no membership', async () => {
    const res = mockRes();
    await HouseholdController.previewInvite(
      { params: { code: 'ABC-234' } } as any,
      res,
      mock()
    );
    expect(previewInvite).toHaveBeenCalledWith('ABC-234');
    expect(res.body.data).toEqual({
      household_name: 'The Smiths',
      children_first_names: ['Maya'],
      role: 'nanny',
    });
  });

  it("updateMember removes the member when the body says status: 'removed'", async () => {
    const res = mockRes();
    await HouseholdController.updateMember(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', memberId: 'm-target' },
        body: { status: 'removed' },
      } as any,
      res,
      mock()
    );
    expect(removeMember).toHaveBeenCalledWith('u1', 'h1', 'm-target');
    expect(res.body.data).toEqual({
      household_member: { id: 'm-target', status: 'removed' },
    });
  });

  it("updateMember forwards a 400 for status: 'active' without touching the service", async () => {
    // Reactivation is redeem-only: a parent flipping a member back to active
    // would hand out household access without a single-use code.
    const res = mockRes();
    const next = mock();
    await HouseholdController.updateMember(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', memberId: 'm-target' },
        body: { status: 'active' },
      } as any,
      res,
      next
    );
    expect(removeMember).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 400 });
  });

  it('updateMember forwards a 400 for a body with no status at all', async () => {
    const res = mockRes();
    const next = mock();
    await HouseholdController.updateMember(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', memberId: 'm-target' },
        body: { colour: '#fff' },
      } as any,
      res,
      next
    );
    expect(removeMember).not.toHaveBeenCalled();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 400 });
  });

  it('updateInvite revokes the invite', async () => {
    const res = mockRes();
    await HouseholdController.updateInvite(
      {
        user: { id: 'u1' },
        params: { householdId: 'h1', inviteId: 'i1' },
        body: { status: 'revoked' },
      } as any,
      res,
      mock()
    );
    expect(revokeInvite).toHaveBeenCalledWith('u1', 'h1', 'i1');
    expect(res.body.data).toEqual({ invite: { id: 'i1', status: 'revoked' } });
  });

  it('forwards service errors to next()', async () => {
    getOwned.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await HouseholdController.getById(
      { user: { id: 'u1' }, params: { householdId: 'h1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
