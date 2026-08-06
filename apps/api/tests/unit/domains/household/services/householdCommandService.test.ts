import { describe, expect, it, mock } from 'bun:test';
import {
  AlreadyMemberError,
  InviteAlreadyAcceptedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteRevokedError,
  NotAHouseholdParentError,
} from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdCommandService } from '../../../../../src/domains/household/services/householdCommandService';
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
} from '../../../../../src/domains/household/types';

const household: Household = {
  id: 'h1',
  name: 'The Smiths',
  timezone: 'Europe/London',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'short_notice_and_cancellations',
  approval_timeout_minutes: 120,
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: 'u1',
  created_at: 't',
  updated_at: 't',
};

function membershipFor(role: HouseholdMember['role']): HouseholdMember {
  return {
    id: 'm1',
    household_id: 'h1',
    user_id: 'u1',
    role,
    can_edit: role === 'owner',
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: 't',
    created_at: 't',
    updated_at: 't',
  };
}

function pendingInvite(
  overrides: Partial<HouseholdInvite> = {}
): HouseholdInvite {
  return {
    id: 'i1',
    household_id: 'h1',
    code: 'ABC-234',
    email: null,
    role: 'nanny',
    invited_by: 'u1',
    expires_at: '2999-01-01T00:00:00Z',
    status: 'pending',
    accepted_by: null,
    accepted_at: null,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...household,
      ...data,
      id: 'h-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...household,
      id,
      ...data,
    })),
    delete: mock(async () => {}),
    findByIds: mock(async () => [household]),
    listActiveChildFirstNames: mock(async () => []),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    createMembership: mock(async (data: Record<string, unknown>) => ({
      id: 'm-new',
      joined_at: 't',
      created_at: 't',
      updated_at: 't',
      display_name_override: null,
      colour: null,
      ...data,
    })),
    findActiveMembership: mock(async () => null),
    ...overrides,
  };
}

function makeInviteRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByCode: mock(async () => pendingInvite()),
    create: mock(async (data: Record<string, unknown>) => ({
      ...pendingInvite(),
      ...data,
      id: 'i-new',
    })),
    claimPending: mock(async (id: string, acceptedBy: string) =>
      pendingInvite({
        id,
        status: 'accepted',
        accepted_by: acceptedBy,
        accepted_at: 't',
      })
    ),
    releaseClaim: mock(async () => {}),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...pendingInvite(),
      id,
      ...data,
    })),
    ...overrides,
  };
}

function makeQueries(
  role: HouseholdMember['role'] = 'owner',
  overrides: Record<string, unknown> = {}
): any {
  return {
    getMembership: mock(async () => membershipFor(role)),
    ...overrides,
  };
}

describe('HouseholdCommandService.create', () => {
  it('creates the household and the owner membership together', async () => {
    const householdRepo = makeHouseholdRepo();
    const memberRepo = makeMemberRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      memberRepo,
      makeInviteRepo(),
      makeQueries()
    );

    const result = await svc.create('u1', { name: 'The Smiths' });

    expect(householdRepo.create).toHaveBeenCalledWith({
      name: 'The Smiths',
      created_by: 'u1',
    });
    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h-new',
        user_id: 'u1',
        role: 'owner',
        status: 'active',
      })
    );
    expect(householdRepo.delete).not.toHaveBeenCalled();
    expect(result.id).toBe('h-new');
  });

  it('deletes the orphaned household and rethrows when the owner-membership insert fails', async () => {
    const householdRepo = makeHouseholdRepo();
    const memberRepo = makeMemberRepo({
      createMembership: mock(async () => {
        throw new Error('insert failed');
      }),
    });
    const svc = new HouseholdCommandService(
      householdRepo,
      memberRepo,
      makeInviteRepo(),
      makeQueries()
    );

    await expect(svc.create('u1', { name: 'The Smiths' })).rejects.toThrow(
      'insert failed'
    );
    expect(householdRepo.delete).toHaveBeenCalledWith('h-new');
  });
});

describe('HouseholdCommandService.update', () => {
  it('allows a parent to update', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent')
    );
    const result = await svc.update('u1', 'h1', { name: 'New name' });
    expect(householdRepo.update).toHaveBeenCalledWith('h1', {
      name: 'New name',
    });
    expect(result.name).toBe('New name');
  });

  it('rejects a nanny with NotAHouseholdParentError', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('nanny')
    );
    await expect(
      svc.update('u1', 'h1', { name: 'New name' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('rejects a helper with NotAHouseholdParentError', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('helper')
    );
    await expect(
      svc.update('u1', 'h1', { name: 'New name' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('HouseholdCommandService.createInvite', () => {
  it('generates a unique code and persists the invite for a parent caller', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('owner')
    );
    const invite = await svc.createInvite('u1', 'h1', { role: 'nanny' });

    expect(invite.household_id).toBe('h1');
    expect(inviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        role: 'nanny',
        invited_by: 'u1',
      })
    );
    const [createArg] = inviteRepo.create.mock.calls[0];
    expect(createArg.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  });

  it('rejects a nanny caller', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('nanny')
    );
    await expect(
      svc.createInvite('u1', 'h1', { role: 'nanny' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('rejects a helper caller', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('helper')
    );
    await expect(
      svc.createInvite('u1', 'h1', { role: 'nanny' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('HouseholdCommandService.redeemInvite', () => {
  it('creates the membership and marks the invite accepted on a valid pending code', async () => {
    const memberRepo = makeMemberRepo();
    const inviteRepo = makeInviteRepo();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    const membership = await svc.redeemInvite('u2', { code: 'abc-234' });

    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        user_id: 'u2',
        role: 'nanny',
        status: 'active',
      })
    );
    expect(inviteRepo.claimPending).toHaveBeenCalledWith('i1', 'u2');
    expect(membership.role).toBe('nanny');
  });

  it('redeems an invite with role parent, producing a parent membership', async () => {
    const memberRepo = makeMemberRepo();
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => pendingInvite({ role: 'parent' })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    const membership = await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'parent' })
    );
    expect(membership.role).toBe('parent');
  });

  it('redeems an invite with role helper, producing a helper membership', async () => {
    const memberRepo = makeMemberRepo();
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => pendingInvite({ role: 'helper' })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    const membership = await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'helper' })
    );
    expect(membership.role).toBe('helper');
  });

  it('is case-insensitive and trims whitespace on the code', async () => {
    const inviteRepo = makeInviteRepo();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries()
    );
    await svc.redeemInvite('u2', { code: '  abc-234  ' });
    expect(inviteRepo.findByCode).toHaveBeenCalledWith('ABC-234');
  });

  it('throws InviteNotFoundError for an unknown code', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo({ findByCode: mock(async () => null) }),
      makeQueries()
    );
    await expect(
      svc.redeemInvite('u2', { code: 'ZZZ-999' })
    ).rejects.toBeInstanceOf(InviteNotFoundError);
  });

  it('throws InviteRevokedError for a revoked invite', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo({
        findByCode: mock(async () => pendingInvite({ status: 'revoked' })),
      }),
      makeQueries()
    );
    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteRevokedError);
  });

  it('throws InviteAlreadyAcceptedError for an already-accepted invite (sequential double-redeem)', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo({
        findByCode: mock(async () => pendingInvite({ status: 'accepted' })),
      }),
      makeQueries()
    );
    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
  });

  it('throws InviteExpiredError for an expired invite', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo({
        findByCode: mock(async () =>
          pendingInvite({ expires_at: '2000-01-01T00:00:00Z' })
        ),
      }),
      makeQueries()
    );
    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteExpiredError);
  });

  it('throws AlreadyMemberError when the caller is already an active member (self-redeem)', async () => {
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => membershipFor('owner')),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries()
    );
    await expect(
      svc.redeemInvite('u1', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
    expect(memberRepo.createMembership).not.toHaveBeenCalled();
  });

  it('claims the invite with a conditional write BEFORE creating the membership', async () => {
    // The claim is what makes the code single-use, so it has to happen first:
    // claiming after the membership insert means both racers already have a
    // membership by the time either one loses.
    const order: string[] = [];
    const inviteRepo = makeInviteRepo({
      claimPending: mock(async (id: string, acceptedBy: string) => {
        order.push('claim');
        return pendingInvite({
          id,
          status: 'accepted',
          accepted_by: acceptedBy,
        });
      }),
    });
    const memberRepo = makeMemberRepo({
      createMembership: mock(async (data: Record<string, unknown>) => {
        order.push('membership');
        return { id: 'm-new', ...data };
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(inviteRepo.claimPending).toHaveBeenCalledWith('i1', 'u2');
    expect(order).toEqual(['claim', 'membership']);
  });

  it('refuses the loser when a DIFFERENT user has already claimed the same code', async () => {
    // Two different users redeeming one code both pass every in-memory check
    // and the unique constraint on (household_id, user_id) does NOT catch it —
    // only the conditional write decides who wins.
    const memberRepo = makeMemberRepo();
    const inviteRepo = makeInviteRepo({
      claimPending: mock(async () => null),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    await expect(
      svc.redeemInvite('u3', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
    expect(memberRepo.createMembership).not.toHaveBeenCalled();
  });

  it('releases the claim when the membership insert fails, so a transient error does not burn the code', async () => {
    // Claim-then-create is the right order, but it means a failed membership
    // insert leaves the invite `accepted` with no membership: the same user
    // retrying would hit InviteAlreadyAcceptedError and be locked out for good.
    const inviteRepo = makeInviteRepo();
    const memberRepo = makeMemberRepo({
      createMembership: mock(async () => {
        throw new Error('connection reset');
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    await expect(svc.redeemInvite('u2', { code: 'ABC-234' })).rejects.toThrow(
      'connection reset'
    );
    expect(inviteRepo.releaseClaim).toHaveBeenCalledWith('i1', 'u2');
  });

  it('releases the claim for the removed-member case too, where createMembership hits the unique constraint', async () => {
    // `findActiveMembership` only sees ACTIVE rows, so a user with a `removed`
    // membership sails past the pre-check and trips 23505 instead. The code
    // must survive that.
    const inviteRepo = makeInviteRepo();
    const memberRepo = makeMemberRepo({
      createMembership: mock(async () => {
        throw new AlreadyMemberError('h1');
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
    expect(inviteRepo.releaseClaim).toHaveBeenCalledWith('i1', 'u2');
  });

  it('does not mask the membership error when the release itself fails', async () => {
    const inviteRepo = makeInviteRepo({
      releaseClaim: mock(async () => {
        throw new Error('database unreachable');
      }),
    });
    const memberRepo = makeMemberRepo({
      createMembership: mock(async () => {
        throw new Error('connection reset');
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries()
    );

    await expect(svc.redeemInvite('u2', { code: 'ABC-234' })).rejects.toThrow(
      'connection reset'
    );
  });

  it('releases nothing on the happy path', async () => {
    const inviteRepo = makeInviteRepo();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries()
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('surfaces the repository AlreadyMemberError (concurrent double-redeem) without a 500', async () => {
    const memberRepo = makeMemberRepo({
      createMembership: mock(async () => {
        throw new AlreadyMemberError('h1');
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries()
    );
    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
  });
});
