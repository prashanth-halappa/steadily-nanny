import { describe, expect, it, mock } from 'bun:test';
import {
  AlreadyMemberError,
  CannotLeaveAsOwnerError,
  CannotLeaveWhileClockedInError,
  CannotRemoveOwnerError,
  CannotRemoveSelfError,
  HouseholdNotFoundError,
  InviteAlreadyAcceptedError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotPendingError,
  InviteRevokedError,
  MemberHasRunningEntryError,
  MemberNotFoundError,
  NotAHouseholdParentError,
  PayOfferNotForDraftHouseholdError,
  PayOfferNotForRoleError,
  WeekStartLockedError,
} from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdCommandService } from '../../../../../src/domains/household/services/householdCommandService';
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
} from '../../../../../src/domains/household/types';
import {
  OpenTermsProposalExistsError,
  TermsProposalValidationError,
} from '../../../../../src/domains/termsProposal/errors/termsProposalErrors';
import { DatabaseError } from '../../../../../src/errors';

const household: Household = {
  id: 'h1',
  name: 'The Smiths',
  timezone: 'Europe/London',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'short_notice_and_cancellations',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  currency: 'GBP',
  jurisdiction: null,
  week_starts_on: 1,
  country: 'US',
  state: 'live',
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
    link_expires_at: null,
    opened_at: null,
    label: null,
    pay_offer: null,
    pay_offer_promotion: null,
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
    findById: mock(async () => household),
    findByIds: mock(async () => [household]),
    listLiveIds: mock(async () => []),
    listActiveChildFirstNames: mock(async () => []),
    ...overrides,
  };
}

function acceptedInvite(
  minutesAgo: number,
  overrides: Partial<HouseholdInvite> = {}
): HouseholdInvite {
  return pendingInvite({
    status: 'accepted',
    accepted_by: 'u9',
    accepted_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ...overrides,
  });
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
    findMembershipIncludingCandidate: mock(async () => null),
    findById: mock(async () => null),
    // §8's one-live-household-per-parent guard and A6's draft auto-archive
    // both read this. Empty by default — the caller belongs nowhere else.
    listActiveByUser: mock(async () => []),
    listActiveByHousehold: mock(async () => []),
    // 110: `removeMember` stamps `ended_reason` through the generic update
    // right after the CAS flip.
    update: mock(async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    })),
    removeMembership: mock(async (id: string) => ({
      ...membershipFor('nanny'),
      id,
      status: 'removed',
    })),
    reactivateMembership: mock(async (id: string, role: string) => ({
      ...membershipFor('nanny'),
      id,
      role,
      can_edit: false,
      status: 'active',
    })),
    ...overrides,
  };
}

/** The removal target: a nanny in h1, distinct from the caller. */
function targetMember(
  overrides: Partial<HouseholdMember> = {}
): HouseholdMember {
  return {
    ...membershipFor('nanny'),
    id: 'm-target',
    user_id: 'u-nanny',
    ...overrides,
  };
}

function makeTimeEntries(overrides: Record<string, unknown> = {}): any {
  return {
    findRunningInHousehold: mock(async () => null),
    ...overrides,
  };
}

function makePayArrangements(overrides: Record<string, unknown> = {}): any {
  return {
    endForCarer: mock(async () => []),
    ...overrides,
  };
}

/** Fixed instant for the household-local date assertions below. */
const AT_NOON_UTC = () => new Date('2026-07-01T12:00:00.000Z');

function makeInviteRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByCode: mock(async () => pendingInvite()),
    findById: mock(async () => pendingInvite()),
    revokePending: mock(async (id: string) =>
      pendingInvite({ id, status: 'revoked' })
    ),
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
    updatePayOfferPromotion: mock(async () => {}),
    ...overrides,
  };
}

/**
 * A caller with no `user_profiles` row, the way Postgres sees one: every FK
 * that points at it (households.created_by, household_members.user_id) raises
 * 23503 until the row exists. `ensureProfile` is what creates it.
 */
function makeProfileWorld() {
  const profiles = new Set<string>();
  const fk = (userId: string, constraint: string): void => {
    if (!profiles.has(userId)) {
      throw new DatabaseError(
        'insert or update violates foreign key constraint',
        'DATABASE_ERROR',
        {
          code: '23503',
          constraint,
        }
      );
    }
  };
  return {
    profiles,
    users: {
      ensureProfile: mock(async (userId: string) => {
        profiles.add(userId);
      }),
    } as any,
    householdRepo: makeHouseholdRepo({
      create: mock(async (data: Record<string, unknown>) => {
        fk(String(data.created_by), 'households_created_by_fkey');
        return { ...household, ...data, id: 'h-new' };
      }),
    }),
    memberRepo: makeMemberRepo({
      createMembership: mock(async (data: Record<string, unknown>) => {
        fk(String(data.user_id), 'household_members_user_id_fkey');
        return { id: 'm-new', ...data };
      }),
    }),
  };
}

const stubUsers: any = { ensureProfile: mock(async () => {}) };

/**
 * The rejoin path's carried-over-PTO sentence reads the ledger; every test
 * that reaches it must stub this, or the ctor default constructs a REAL
 * PtoLedgerRepository whose supabase call turns a unit test into a slow
 * network failure.
 */
const stubPtoLedger: any = { listForCarerYear: mock(async () => []) };

/**
 * The departure-side pattern teardown, stubbed. Empty list of vacated days by
 * default: every test that is not ABOUT the teardown still has to construct
 * past it, or the real default lazily imports the live command service and
 * reaches a real Supabase call.
 */
const stubPatterns: any = {
  endAcceptedPatternsForCarer: mock(async () => []),
};

/**
 * Uncovered-care detection, stubbed for the same reason. Void by design — it
 * is fire-and-forget in production and swallows its own failures.
 */
const stubDetectUncovered: any = mock(
  (_args: Record<string, unknown>) => undefined
);

/**
 * Same hazard as `stubPtoLedger`, on the create path: `create` seeds the
 * country's holiday pack, so a test that reaches it and leaves this defaulted
 * constructs a REAL HouseholdHolidayRepository and waits on a supabase call.
 * The seed failure is swallowed by design, so the symptom is a five-second
 * timeout rather than an assertion — which is exactly why it needs a name.
 */
const stubHolidays: any = { seedCountryPack: mock(async () => []) };

/**
 * Same hazard again, for F8's new write: `removeMember`/`leave` now call
 * `proposals.withdrawOpenForCarer`, so a test that reaches it and leaves this
 * defaulted constructs a REAL TermsProposalRepository and waits on a supabase
 * call. `create` is stubbed to blow up loudly — nothing outside the P8 promote
 * block should ever reach it.
 */
const stubProposals: any = {
  create: mock(async () => {
    throw new Error('stubProposals.create should not be reached here');
  }),
  withdrawOpenForCarer: mock(async () => null),
};

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
      makeQueries(),
      stubUsers,
      undefined,
      undefined,
      undefined,
      undefined,
      stubHolidays
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

  // Phase 1, T4: currency/jurisdiction are wire-schema-only additions — the
  // service already writes `{ ...input, created_by: userId }`, so passthrough
  // requires no service change, only the schema allowing the fields.
  it('passes currency and jurisdiction through to the repository create call', async () => {
    const householdRepo = makeHouseholdRepo();
    const memberRepo = makeMemberRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      memberRepo,
      makeInviteRepo(),
      makeQueries(),
      stubUsers,
      undefined,
      undefined,
      undefined,
      undefined,
      stubHolidays
    );

    await svc.create('u1', {
      name: 'The Smiths',
      currency: 'USD',
      jurisdiction: 'NY',
    });

    expect(householdRepo.create).toHaveBeenCalledWith({
      name: 'The Smiths',
      currency: 'USD',
      jurisdiction: 'NY',
      created_by: 'u1',
    });
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
      makeQueries(),
      stubUsers
    );

    await expect(svc.create('u1', { name: 'The Smiths' })).rejects.toThrow(
      'insert failed'
    );
    expect(householdRepo.delete).toHaveBeenCalledWith('h-new');
  });
});

describe('HouseholdCommandService onboarding without a user_profiles row', () => {
  // Nothing creates the profile row: there is no trigger on auth.users, and the
  // client-side bootstrap added in 2ae309c only covers the parent flow. A nanny
  // redeeming an invite has no bootstrap on that path at all.
  it('creates the profile row before the household, so a fresh auth user can onboard', async () => {
    const world = makeProfileWorld();
    const svc = new HouseholdCommandService(
      world.householdRepo,
      world.memberRepo,
      makeInviteRepo(),
      makeQueries(),
      world.users,
      undefined,
      undefined,
      undefined,
      undefined,
      stubHolidays
    );

    const result = await svc.create('u-fresh', { name: 'The Smiths' });

    expect(world.users.ensureProfile).toHaveBeenCalledWith('u-fresh');
    expect(result.id).toBe('h-new');
    expect(world.householdRepo.delete).not.toHaveBeenCalled();
  });

  it('creates the profile row before redeeming an invite, so a fresh nanny can join', async () => {
    const world = makeProfileWorld();
    const svc = new HouseholdCommandService(
      world.householdRepo,
      world.memberRepo,
      makeInviteRepo(),
      makeQueries(),
      world.users
    );

    const membership = await svc.redeemInvite('u-fresh', { code: 'ABC-234' });

    expect(world.users.ensureProfile).toHaveBeenCalledWith('u-fresh');
    expect(membership.user_id).toBe('u-fresh');
  });

  it('leaves an existing profile alone — ensure is called, never a field-bearing upsert', async () => {
    const world = makeProfileWorld();
    world.profiles.add('u-existing');
    const svc = new HouseholdCommandService(
      world.householdRepo,
      world.memberRepo,
      makeInviteRepo(),
      makeQueries(),
      world.users,
      undefined,
      undefined,
      undefined,
      undefined,
      stubHolidays
    );

    await svc.create('u-existing', { name: 'The Smiths' });

    expect(world.users.ensureProfile.mock.calls).toEqual([['u-existing']]);
  });
});

describe('HouseholdCommandService.update', () => {
  it('allows a parent to update', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers
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
      makeQueries('nanny'),
      stubUsers
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
      makeQueries('helper'),
      stubUsers
    );
    await expect(
      svc.update('u1', 'h1', { name: 'New name' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  // ---------------------------------------------------------------------
  // 099 — the emergency contact rides THIS body. No new endpoint, no new
  // gate: the existing owner/parent check is the whole authorisation story,
  // and these tests are what pin that it actually covers the new fields.
  // ---------------------------------------------------------------------
  const emergency = {
    emergency_contact_name: 'Grace Adeyemi',
    emergency_contact_phone: '07700 900456',
    emergency_contact_relationship: 'Neighbour',
  };

  it('lets a parent set the emergency contact', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers
    );
    await svc.update('u1', 'h1', emergency);
    expect(householdRepo.update).toHaveBeenCalledWith('h1', emergency);
  });

  it('lets a parent clear the emergency contact', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers
    );
    const cleared = {
      emergency_contact_name: null,
      emergency_contact_phone: null,
      emergency_contact_relationship: null,
    };
    await svc.update('u1', 'h1', cleared);
    expect(householdRepo.update).toHaveBeenCalledWith('h1', cleared);
  });

  // The nanny READS this contact — it is the "If something happens" section of
  // her family screen — but she never writes it. The §2.2 draft-author
  // capability is name-only and does not widen here.
  it('refuses a nanny setting the emergency contact, and writes nothing', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('nanny'),
      stubUsers
    );
    await expect(svc.update('u1', 'h1', emergency)).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
    expect(householdRepo.update).not.toHaveBeenCalled();
  });

  it('refuses a helper setting the emergency contact', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('helper'),
      stubUsers
    );
    await expect(svc.update('u1', 'h1', emergency)).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
  });
});

describe('HouseholdCommandService.update — week_starts_on lock (T1)', () => {
  function makeTimesheetRepo(exists: boolean): any {
    return { existsForHousehold: mock(async () => exists) };
  }

  it('refuses a changed week_starts_on with WeekStartLockedError when a timesheet exists', async () => {
    const timesheets = makeTimesheetRepo(true);
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      undefined,
      undefined,
      undefined,
      timesheets
    );
    await expect(
      svc.update('u1', 'h1', { week_starts_on: 0 })
    ).rejects.toBeInstanceOf(WeekStartLockedError);
    expect(timesheets.existsForHousehold).toHaveBeenCalledWith('h1');
  });

  it('allows a changed week_starts_on when no timesheet exists', async () => {
    const timesheets = makeTimesheetRepo(false);
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdCommandService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      undefined,
      undefined,
      undefined,
      timesheets
    );
    const result = await svc.update('u1', 'h1', { week_starts_on: 0 });
    expect(result.week_starts_on).toBe(0);
    expect(householdRepo.update).toHaveBeenCalledWith('h1', {
      week_starts_on: 0,
    });
  });

  it('sends a same-value week_starts_on through WITHOUT calling the existence check — no false lock, no wasted query', async () => {
    const timesheets = makeTimesheetRepo(true);
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      undefined,
      undefined,
      undefined,
      timesheets
    );
    // `household` fixture's week_starts_on is 1 — same value in, no lock.
    await expect(
      svc.update('u1', 'h1', { week_starts_on: 1 })
    ).resolves.toBeTruthy();
    expect(timesheets.existsForHousehold).not.toHaveBeenCalled();
  });

  it('never calls the existence check when week_starts_on is absent from the input', async () => {
    const timesheets = makeTimesheetRepo(true);
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      undefined,
      undefined,
      undefined,
      timesheets
    );
    await svc.update('u1', 'h1', { name: 'New name' });
    expect(timesheets.existsForHousehold).not.toHaveBeenCalled();
  });
});

describe('HouseholdCommandService.createInvite', () => {
  it('generates a unique code and persists the invite for a parent caller', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('owner'),
      stubUsers
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
      makeQueries('nanny'),
      stubUsers
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
      makeQueries('helper'),
      stubUsers
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
    );
    await svc.redeemInvite('u2', { code: '  abc-234  ' });
    expect(inviteRepo.findByCode).toHaveBeenCalledWith('ABC-234');
  });

  it('throws InviteNotFoundError for an unknown code', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo({ findByCode: mock(async () => null) }),
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
    );
    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteExpiredError);
  });

  it('throws AlreadyMemberError when the caller is already an active member (self-redeem), BEFORE claiming the code', async () => {
    // The pre-check reads ANY status now, so it must distinguish active (refuse)
    // from removed (reactivate). Refusing after the claim would burn a
    // single-use code on a no-op.
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () =>
        membershipFor('owner')
      ),
    });
    const inviteRepo = makeInviteRepo();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );
    await expect(
      svc.redeemInvite('u1', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
    expect(memberRepo.createMembership).not.toHaveBeenCalled();
    expect(inviteRepo.claimPending).not.toHaveBeenCalled();
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
    );

    await expect(svc.redeemInvite('u2', { code: 'ABC-234' })).rejects.toThrow(
      'connection reset'
    );
    // Third argument is the accepted_at of the claim THIS request won, so the
    // release cannot free a claim taken after it.
    expect(inviteRepo.releaseClaim).toHaveBeenCalledWith('i1', 'u2', 't');
  });

  it('releases the claim when createMembership hits the unique constraint', async () => {
    // The same user redeeming twice concurrently: both pass the pre-check,
    // one insert wins and the other trips 23505. The loser's code must survive.
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
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
    expect(inviteRepo.releaseClaim).toHaveBeenCalledWith('i1', 'u2', 't');
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
      makeQueries(),
      stubUsers
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
      makeQueries(),
      stubUsers
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('heals a claim stranded by a crash: accepted 20 minutes ago with no membership row is re-claimable', async () => {
    // A process that dies between the claim and the membership insert leaves
    // the invite `accepted` with nobody in the household — the compensation in
    // the catch never runs, so today the code is burned for good.
    const stranded = acceptedInvite(20);
    const memberRepo = makeMemberRepo();
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => stranded),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    const membership = await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(inviteRepo.releaseClaim).toHaveBeenCalledWith(
      'i1',
      'u9',
      stranded.accepted_at
    );
    expect(inviteRepo.claimPending).toHaveBeenCalledWith('i1', 'u2');
    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ household_id: 'h1', user_id: 'u2' })
    );
    expect(membership.role).toBe('nanny');
  });

  it('refuses a claim accepted 5 minutes ago — the claimer may still be mid-insert', async () => {
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => acceptedInvite(5)),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('refuses to heal when the claimer has a REMOVED membership row — a consumed code must not resurrect', async () => {
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => ({
        ...membershipFor('nanny'),
        user_id: 'u9',
        status: 'removed',
      })),
    });
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => acceptedInvite(20)),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('refuses to heal when the claimer is an active member — the redeem actually completed', async () => {
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => ({
        ...membershipFor('nanny'),
        user_id: 'u9',
      })),
    });
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => acceptedInvite(20)),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('releases the ORIGINAL claimer, checks THEIR membership, and only then claims for the new caller', async () => {
    const order: string[] = [];
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(
        async (householdId: string, userId: string) => {
          order.push(`membership-lookup:${householdId}:${userId}`);
          return null;
        }
      ),
    });
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => acceptedInvite(20)),
      releaseClaim: mock(async (id: string, acceptedBy: string) => {
        order.push(`release:${id}:${acceptedBy}`);
      }),
      claimPending: mock(async (id: string, acceptedBy: string) => {
        order.push(`claim:${id}:${acceptedBy}`);
        return pendingInvite({
          id,
          status: 'accepted',
          accepted_by: acceptedBy,
        });
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    // The second lookup is the redeemer's own pre-check (active -> refuse,
    // removed -> reactivate), which now runs on the same any-status read.
    expect(order).toEqual([
      'membership-lookup:h1:u9',
      'release:i1:u9',
      'membership-lookup:h1:u2',
      'claim:i1:u2',
    ]);
  });

  it('does not resurrect a code that was re-claimed between the read and the release', async () => {
    // The window: this caller reads the 20-minute-old stranded claim, and
    // before it releases, the original claimer's own retry heals, re-claims and
    // joins. Releasing on (accepted, accepted_by) alone matches that FRESH
    // claim — the single-use code goes back to `pending` and this caller, who
    // was never invited by anyone still holding it, joins the household.
    // Keying the release to the accepted_at we OBSERVED makes it match 0 rows.
    const observed = acceptedInvite(20);
    const live: HouseholdInvite = {
      ...observed,
      accepted_at: new Date().toISOString(),
    };
    const memberRepo = makeMemberRepo();
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => observed),
      // Models the real SQL: each argument is one `.eq()` predicate, and an
      // argument the service never passes is a predicate that isn't there.
      releaseClaim: mock(
        async (id: string, acceptedBy: string, acceptedAt?: string) => {
          const matched =
            live.id === id &&
            live.status === 'accepted' &&
            live.accepted_by === acceptedBy &&
            (acceptedAt === undefined || live.accepted_at === acceptedAt);
          if (matched) {
            live.status = 'pending';
            live.accepted_by = null;
            live.accepted_at = null;
          }
        }
      ),
      claimPending: mock(async (id: string, acceptedBy: string) => {
        if (live.status !== 'pending') {
          return null;
        }
        live.status = 'accepted';
        live.accepted_by = acceptedBy;
        return { ...live, id };
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('uStranger', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
    expect(live.status).toBe('accepted');
    expect(live.accepted_by).toBe('u9');
    expect(memberRepo.createMembership).not.toHaveBeenCalled();
  });

  it('refuses to heal when the claimer account is gone (accepted_by nulled by the FK)', async () => {
    // `accepted_by` is `on delete set null` (009:125) and membership rows
    // cascade away with the account, so a deleted claimer leaves NO evidence
    // the code was consumed. This null guard, not the membership lookup, is
    // what stops that code being handed to the next person who types it.
    const memberRepo = makeMemberRepo();
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => acceptedInvite(20, { accepted_by: null })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
    expect(memberRepo.findMembershipIncludingCandidate).not.toHaveBeenCalled();
  });

  it('refuses to heal an accepted invite with no accepted_at to age', async () => {
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => acceptedInvite(20, { accepted_at: null })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteAlreadyAcceptedError);
    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('rejects a stranded but EXPIRED invite without releasing it', async () => {
    // Healing first would wipe accepted_by/accepted_at — the record of who
    // consumed the code — for an invite nobody can redeem anyway.
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () =>
        acceptedInvite(20, { expires_at: '2000-01-01T00:00:00Z' })
      ),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteExpiredError);
    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });

  it('surfaces a failed release during self-heal instead of silently claiming anyway', async () => {
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => acceptedInvite(20)),
      releaseClaim: mock(async () => {
        throw new Error('database unreachable');
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(svc.redeemInvite('u2', { code: 'ABC-234' })).rejects.toThrow(
      'database unreachable'
    );
    expect(inviteRepo.claimPending).not.toHaveBeenCalled();
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
      makeQueries(),
      stubUsers
    );
    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
  });
});

/** A membership this user already had and lost — the reactivation subject. */
function removedMembership(
  overrides: Partial<HouseholdMember> = {}
): HouseholdMember {
  return {
    ...membershipFor('nanny'),
    id: 'm-old',
    user_id: 'u2',
    status: 'removed',
    ...overrides,
  };
}

describe('HouseholdCommandService.redeemInvite — removed member rejoining', () => {
  it('reactivates the existing row on the new invite role instead of inserting a second one', async () => {
    // The unique (household_id, user_id) constraint makes a fresh insert
    // impossible for someone who was removed: without reactivation the only
    // outcome is a 409 the parent cannot get past.
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => removedMembership()),
    });
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => pendingInvite({ role: 'parent' })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger
    );

    const membership = await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(memberRepo.reactivateMembership).toHaveBeenCalledWith(
      'm-old',
      'parent'
    );
    expect(memberRepo.createMembership).not.toHaveBeenCalled();
    expect(membership).toMatchObject({
      id: 'm-old',
      role: 'parent',
      status: 'active',
      can_edit: false,
    });
  });

  it('consumes the code with claimPending BEFORE reactivating, so the invite stays single-use', async () => {
    const order: string[] = [];
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => removedMembership()),
      reactivateMembership: mock(async (id: string, role: string) => {
        order.push('reactivate');
        return { ...removedMembership(), id, role, status: 'active' };
      }),
    });
    const inviteRepo = makeInviteRepo({
      claimPending: mock(async (id: string, acceptedBy: string) => {
        order.push('claim');
        return pendingInvite({
          id,
          status: 'accepted',
          accepted_by: acceptedBy,
          accepted_at: 't',
        });
      }),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(order).toEqual(['claim', 'reactivate']);
    expect(inviteRepo.claimPending).toHaveBeenCalledWith('i1', 'u2');
  });

  it('releases the claim with the OBSERVED accepted_at when the reactivation CAS loses', async () => {
    // Two devices redeeming two codes at once: the other one reactivated the
    // row first, so this claim bought nothing and must go back — keyed to the
    // accepted_at THIS request won, never a later one.
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => removedMembership()),
      reactivateMembership: mock(async () => null),
    });
    const inviteRepo = makeInviteRepo();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
    expect(inviteRepo.releaseClaim).toHaveBeenCalledWith('i1', 'u2', 't');
  });

  it('still refuses a revoked code to a removed member', async () => {
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => removedMembership()),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo({
        findByCode: mock(async () => pendingInvite({ status: 'revoked' })),
      }),
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteRevokedError);
    expect(memberRepo.reactivateMembership).not.toHaveBeenCalled();
  });

  it('still refuses an expired code to a removed member', async () => {
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => removedMembership()),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo({
        findByCode: mock(async () =>
          pendingInvite({ expires_at: '2000-01-01T00:00:00Z' })
        ),
      }),
      makeQueries(),
      stubUsers
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(InviteExpiredError);
    expect(memberRepo.reactivateMembership).not.toHaveBeenCalled();
  });
});

describe('HouseholdCommandService.removeMember', () => {
  it('removes an active nanny for a parent caller', async () => {
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    const removed = await svc.removeMember('u1', 'h1', 'm-target');

    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-target');
    expect(removed.status).toBe('removed');
  });

  it('rejects a nanny caller with NotAHouseholdParentError', async () => {
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('nanny'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target')
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('refuses to remove the owner — which is also what keeps a household from losing its last parent', async () => {
    const memberRepo = makeMemberRepo({
      findById: mock(async () =>
        targetMember({ role: 'owner', user_id: 'u-owner' })
      ),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target')
    ).rejects.toBeInstanceOf(CannotRemoveOwnerError);
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('refuses to remove yourself — leaving a household is a separate feature', async () => {
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember({ user_id: 'u1' })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target')
    ).rejects.toBeInstanceOf(CannotRemoveSelfError);
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('refuses to remove a carer who is still clocked in', async () => {
    // Removing mid-shift strands a running entry nobody can clock out: the
    // carer loses the household, and the hours never land on a timesheet.
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const timeEntries = makeTimeEntries({
      findRunningInHousehold: mock(async () => ({
        id: 'te1',
        household_id: 'h1',
        status: 'running',
      })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      timeEntries,
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target')
    ).rejects.toBeInstanceOf(MemberHasRunningEntryError);
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('removes a nanny who is clocked in at a DIFFERENT family', async () => {
    // A nanny works for several households. Their shift at Family B is none of
    // Family A's business: blocking on it strands A's removal AND discloses
    // that the nanny is currently working somewhere else. The household-scoped
    // lookup returns null here.
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const timeEntries = makeTimeEntries();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      timeEntries,
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    const removed = await svc.removeMember('u1', 'h1', 'm-target');

    expect(removed.status).toBe('removed');
    expect(timeEntries.findRunningInHousehold).toHaveBeenCalledWith(
      'h1',
      'u-nanny'
    );
  });

  it('checks the running entry for the TARGET carer, scoped to THIS household', async () => {
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const timeEntries = makeTimeEntries();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      timeEntries,
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await svc.removeMember('u1', 'h1', 'm-target');

    expect(timeEntries.findRunningInHousehold).toHaveBeenCalledWith(
      'h1',
      'u-nanny'
    );
  });

  it('404s a member id belonging to ANOTHER household, without revealing it exists', async () => {
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember({ household_id: 'h-other' })),
    });
    const timeEntries = makeTimeEntries();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      timeEntries,
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target')
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
    expect(timeEntries.findRunningInHousehold).not.toHaveBeenCalled();
  });

  it('404s an unknown member id', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo({ findById: mock(async () => null) }),
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await expect(svc.removeMember('u1', 'h1', 'm-gone')).rejects.toBeInstanceOf(
      MemberNotFoundError
    );
  });

  it('404s when the CAS matches nothing — the member was already removed', async () => {
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
      removeMembership: mock(async () => null),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      stubProposals,
      undefined,
      stubPatterns,
      stubDetectUncovered
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target')
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe('HouseholdCommandService.revokeInvite', () => {
  it('revokes a pending invite for a parent caller', async () => {
    const inviteRepo = makeInviteRepo();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements()
    );

    const invite = await svc.revokeInvite('u1', 'h1', 'i1');

    expect(inviteRepo.revokePending).toHaveBeenCalledWith('i1', 'h1');
    expect(invite.status).toBe('revoked');
  });

  it('rejects a nanny caller with NotAHouseholdParentError', async () => {
    const inviteRepo = makeInviteRepo();
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('nanny'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements()
    );

    await expect(svc.revokeInvite('u1', 'h1', 'i1')).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
    expect(inviteRepo.revokePending).not.toHaveBeenCalled();
  });

  it('409s an invite that has already been accepted', async () => {
    const inviteRepo = makeInviteRepo({
      revokePending: mock(async () => null),
      findById: mock(async () => pendingInvite({ status: 'accepted' })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements()
    );

    await expect(svc.revokeInvite('u1', 'h1', 'i1')).rejects.toBeInstanceOf(
      InviteNotPendingError
    );
  });

  it('404s an invite id from ANOTHER household, same as an unknown one', async () => {
    // Distinguishing the two would let a parent probe other families' invite
    // ids — the household is inside the CAS for exactly this reason.
    const inviteRepo = makeInviteRepo({
      revokePending: mock(async () => null),
      findById: mock(async () => pendingInvite({ household_id: 'h-other' })),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements()
    );

    await expect(svc.revokeInvite('u1', 'h1', 'i1')).rejects.toBeInstanceOf(
      InviteNotFoundError
    );
  });

  it('404s an unknown invite id', async () => {
    const inviteRepo = makeInviteRepo({
      revokePending: mock(async () => null),
      findById: mock(async () => null),
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      makePayArrangements()
    );

    await expect(svc.revokeInvite('u1', 'h1', 'i-gone')).rejects.toBeInstanceOf(
      InviteNotFoundError
    );
  });
});

describe('HouseholdCommandService.removeMember — pay arrangement (065)', () => {
  // The teardown is ONE injected method now, not a repository plus a
  // materialisation service driven from here. What it does internally — both
  // ids to the read, one `now` across the sweep, a throw leaving nothing
  // changed — is pinned in schedulePatternEndForCarer.test.ts, where the
  // method lives. What these tests owe is that removal DELEGATES to it, with
  // the right arguments, at the right point in the sequence.
  function makeSchedulePatterns(cancelledDates: string[] = []): any {
    return {
      endAcceptedPatternsForCarer: mock(async () => cancelledDates),
    };
  }

  function makeDetectUncovered(): any {
    return mock((_args: Record<string, unknown>) => undefined);
  }

  function svcWith(
    householdRepo: any,
    payArrangements: any,
    memberRepo = makeMemberRepo({ findById: mock(async () => targetMember()) }),
    proposals: any = stubProposals,
    schedulePatterns: any = makeSchedulePatterns(),
    detectUncovered: any = makeDetectUncovered()
  ) {
    return new HouseholdCommandService(
      householdRepo,
      memberRepo,
      makeInviteRepo(),
      makeQueries('parent'),
      stubUsers,
      makeTimeEntries(),
      payArrangements,
      stubPtoLedger,
      undefined,
      undefined,
      proposals,
      undefined,
      schedulePatterns,
      detectUncovered
    );
  }

  it('end-dates the carer pay arrangement, so a rejoin has no live terms', async () => {
    // Owner decision: rejoining re-confirms terms. Without this the
    // arrangement live at removal is still what `effectiveOn` resolves months
    // later, at the old rate, silently (docs/11-MONEY.md §10).
    const payArrangements = makePayArrangements();
    const svc = svcWith(makeHouseholdRepo(), payArrangements);

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(payArrangements.endForCarer).toHaveBeenCalledWith(
      'h1',
      'u-nanny',
      '2026-07-01'
    );
  });

  it('ends on the HOUSEHOLD-LOCAL date, not server UTC', async () => {
    // Noon UTC on 1 July is already 2 July in Auckland. Ending on the UTC date
    // would cut the terms a day short and leave that day's shift unpriced —
    // the same trap 041's header records for `valid_from`.
    const payArrangements = makePayArrangements();
    const svc = svcWith(
      makeHouseholdRepo({
        findById: mock(async () => ({
          ...household,
          timezone: 'Pacific/Auckland',
        })),
      }),
      payArrangements
    );

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(payArrangements.endForCarer).toHaveBeenCalledWith(
      'h1',
      'u-nanny',
      '2026-07-02'
    );
  });

  it('end-dates BEFORE flipping the membership — the ordering that cannot strand', async () => {
    // Either order can fail halfway. Membership-first leaves a removed member
    // with live terms (the exact bug) if the end-date throws. End-date-first
    // cannot strand: every other refusal has already run, so the only way the
    // CAS then fails is that someone else removed them — in which case the
    // end-date was correct anyway.
    const order: string[] = [];
    const payArrangements = makePayArrangements({
      endForCarer: mock(async () => {
        order.push('end-arrangement');
        return [];
      }),
    });
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
      removeMembership: mock(async (id: string) => {
        order.push('remove-membership');
        return { ...targetMember(), id, status: 'removed' };
      }),
    });
    const svc = svcWith(makeHouseholdRepo(), payArrangements, memberRepo);

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(order).toEqual(['end-arrangement', 'remove-membership']);
  });

  it('refuses the whole removal when the end-date write fails, rather than half-removing', async () => {
    const payArrangements = makePayArrangements({
      endForCarer: mock(async () => {
        throw new DatabaseError('boom', 'DATABASE_ERROR');
      }),
    });
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const svc = svcWith(makeHouseholdRepo(), payArrangements, memberRepo);

    await expect(
      svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC)
    ).rejects.toThrow('boom');
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('does not touch pay when the removal is refused for any other reason', async () => {
    const payArrangements = makePayArrangements();
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember({ role: 'owner' })),
    });
    const svc = svcWith(makeHouseholdRepo(), payArrangements, memberRepo);

    await expect(
      svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC)
    ).rejects.toBeInstanceOf(CannotRemoveOwnerError);
    expect(payArrangements.endForCarer).not.toHaveBeenCalled();
  });

  // F8 — a removed carer must not be left with an open round she can no
  // longer act on inside a household she no longer belongs to.
  it("withdraws the target carer's open terms proposal (F8)", async () => {
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => ({
        id: 'tp-1',
        status: 'withdrawn',
      })),
    };
    const svc = svcWith(
      makeHouseholdRepo(),
      makePayArrangements(),
      makeMemberRepo({ findById: mock(async () => targetMember()) }),
      proposals
    );

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(proposals.withdrawOpenForCarer).toHaveBeenCalledWith(
      'h1',
      'u-nanny'
    );
  });

  it('withdraws BEFORE flipping the membership, same ordering discipline as endForCarer', async () => {
    const order: string[] = [];
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => {
        order.push('withdraw-proposal');
        return null;
      }),
    };
    const payArrangements = makePayArrangements({
      endForCarer: mock(async () => {
        order.push('end-arrangement');
        return [];
      }),
    });
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
      removeMembership: mock(async (id: string) => {
        order.push('remove-membership');
        return { ...targetMember(), id, status: 'removed' };
      }),
    });
    const svc = svcWith(
      makeHouseholdRepo(),
      payArrangements,
      memberRepo,
      proposals
    );

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(order.indexOf('withdraw-proposal')).toBeLessThan(
      order.indexOf('remove-membership')
    );
  });

  // Same discipline as `endForCarer`'s own failure a few tests up: a throw
  // here refuses the WHOLE removal with nothing changed, rather than flipping
  // membership over a carer who still has an open round nobody withdrew.
  it('a withdraw failure refuses the whole removal, same discipline as endForCarer', async () => {
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => {
        throw new DatabaseError('boom', 'DATABASE_ERROR');
      }),
    };
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const svc = svcWith(
      makeHouseholdRepo(),
      makePayArrangements(),
      memberRepo,
      proposals
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC)
    ).rejects.toThrow('boom');
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  // The ghost-shift defect through the removal door. `listAccepted` (the read
  // `scheduleHorizonJob` runs over) has NO membership filter, so a surviving
  // `accepted` pattern keeps manufacturing confirmed shifts to the 84-day
  // horizon — and `reminderJob` keeps pushing "you have a shift tomorrow" at
  // a woman who no longer works there.
  // BOTH ids and the removal's OWN instant. She works for two families:
  // ending the pattern she still works under would be catastrophic, and
  // passing both ids is the only thing standing between here and there. The
  // instant matters because it is what draws the line between a shift already
  // worked (or half-worked today) and one that was never going to happen — a
  // fresh clock inside the teardown would move it.
  it('ends her accepted patterns for THIS household and carer, at the removal instant', async () => {
    const schedulePatterns = makeSchedulePatterns();
    const svc = svcWith(
      makeHouseholdRepo(),
      makePayArrangements(),
      undefined,
      undefined,
      schedulePatterns
    );

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(schedulePatterns.endAcceptedPatternsForCarer).toHaveBeenCalledWith(
      'h1',
      'u-nanny',
      AT_NOON_UTC()
    );
    expect(schedulePatterns.endAcceptedPatternsForCarer).toHaveBeenCalledTimes(
      1
    );
  });

  // The other half of the ghost-shift defect, and the one that reaches the
  // FAMILY. Cancelling her shifts empties days the children still need
  // covering, but membership change is not an uncovered-care trigger and
  // detection counts any shift with a carer_id as covered — so without this
  // the day reads as covered until the 03:00 sweep and the parents go to bed
  // believing they have childcare.
  it('re-runs uncovered-care detection for exactly the days it emptied', async () => {
    const schedulePatterns = makeSchedulePatterns(['2026-08-25', '2026-08-26']);
    const detectUncovered = makeDetectUncovered();
    const svc = svcWith(
      makeHouseholdRepo(),
      makePayArrangements(),
      undefined,
      undefined,
      schedulePatterns,
      detectUncovered
    );

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(detectUncovered).toHaveBeenCalledTimes(2);
    expect(detectUncovered).toHaveBeenCalledWith({
      householdId: 'h1',
      localDate: '2026-08-25',
      cause: 'cancelled',
      actorId: 'u1',
    });
    expect(detectUncovered).toHaveBeenCalledWith({
      householdId: 'h1',
      localDate: '2026-08-26',
      cause: 'cancelled',
      actorId: 'u1',
    });
  });

  it('raises nothing when the teardown emptied no days', async () => {
    const detectUncovered = makeDetectUncovered();
    const svc = svcWith(
      makeHouseholdRepo(),
      makePayArrangements(),
      undefined,
      undefined,
      makeSchedulePatterns([]),
      detectUncovered
    );

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(detectUncovered).not.toHaveBeenCalled();
  });

  // Same discipline as the withdraw and the end-date above it.
  it('a pattern-teardown failure refuses the whole removal, membership unchanged', async () => {
    const patterns = {
      endAcceptedPatternsForCarer: mock(async () => {
        throw new DatabaseError('patterns boom', 'DATABASE_ERROR');
      }),
    };
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
    });
    const svc = svcWith(
      makeHouseholdRepo(),
      makePayArrangements(),
      memberRepo,
      undefined,
      patterns
    );

    await expect(
      svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC)
    ).rejects.toThrow('patterns boom');
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('ends the pattern BEFORE the membership flip, like everything else that can strand', async () => {
    const order: string[] = [];
    const patterns = {
      endAcceptedPatternsForCarer: mock(async () => {
        order.push('end-pattern');
        return ['2026-08-25'];
      }),
    };
    const memberRepo = makeMemberRepo({
      findById: mock(async () => targetMember()),
      removeMembership: mock(async (id: string) => {
        order.push('remove-membership');
        return { ...targetMember(), id, status: 'removed' };
      }),
    });
    const svc = svcWith(
      makeHouseholdRepo(),
      makePayArrangements(),
      memberRepo,
      undefined,
      patterns
    );

    await svc.removeMember('u1', 'h1', 'm-target', AT_NOON_UTC);

    expect(order.indexOf('end-pattern')).toBeLessThan(
      order.indexOf('remove-membership')
    );
  });
});

/**
 * `removeMember` refuses a self-directed removal with CannotRemoveSelfError and
 * a comment promising leaving is its own feature. This is that feature: same
 * end state on the row, different authorization (nobody gates it but your own
 * membership) and different refusals (the owner is stuck, and you cannot walk
 * out mid-shift on yourself either).
 */
describe('HouseholdCommandService.leave', () => {
  // The last two MUST be injected, even where a test does not assert on them:
  // undefined falls through to the real defaults, and the schedule one lazily
  // imports the live command service and reaches a database.
  function makeSchedulePatterns(cancelledDates: string[] = []): any {
    return {
      endAcceptedPatternsForCarer: mock(async () => cancelledDates),
    };
  }

  function makeDetectUncovered(): any {
    return mock((_args: Record<string, unknown>) => undefined);
  }

  function svcWith(overrides: {
    role?: HouseholdMember['role'];
    householdRepo?: any;
    memberRepo?: any;
    queries?: any;
    timeEntries?: any;
    payArrangements?: any;
    proposals?: any;
    schedulePatterns?: any;
    detectUncovered?: any;
  }) {
    return new HouseholdCommandService(
      overrides.householdRepo ?? makeHouseholdRepo(),
      overrides.memberRepo ?? makeMemberRepo(),
      makeInviteRepo(),
      overrides.queries ?? makeQueries(overrides.role ?? 'nanny'),
      stubUsers,
      overrides.timeEntries ?? makeTimeEntries(),
      overrides.payArrangements ?? makePayArrangements(),
      stubPtoLedger,
      undefined,
      undefined,
      overrides.proposals ?? stubProposals,
      undefined,
      overrides.schedulePatterns ?? makeSchedulePatterns(),
      overrides.detectUncovered ?? makeDetectUncovered()
    );
  }

  it('refuses the owner — leaving would orphan the household', async () => {
    // Exactly the CannotRemoveOwnerError rationale seen from the other side:
    // the owner membership is created with the household and can never be
    // revoked, so no path may leave a household with nobody who can write.
    const memberRepo = makeMemberRepo();
    const payArrangements = makePayArrangements();
    const svc = svcWith({ role: 'owner', memberRepo, payArrangements });

    await expect(svc.leave('u1', 'h1')).rejects.toBeInstanceOf(
      CannotLeaveAsOwnerError
    );
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
    expect(payArrangements.endForCarer).not.toHaveBeenCalled();
  });

  it('refuses a non-member with the same HouseholdNotFoundError every other read gives', async () => {
    const memberRepo = makeMemberRepo();
    const svc = svcWith({
      memberRepo,
      queries: makeQueries('nanny', {
        getMembership: mock(async () => {
          throw new HouseholdNotFoundError('h1');
        }),
      }),
    });

    await expect(svc.leave('u-stranger', 'h1')).rejects.toBeInstanceOf(
      HouseholdNotFoundError
    );
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('refuses someone clocked in in THIS household', async () => {
    // Same strand as removal: walking out mid-shift leaves a running entry
    // nobody can close, and the hours never reach a timesheet.
    const memberRepo = makeMemberRepo();
    const payArrangements = makePayArrangements();
    const svc = svcWith({
      memberRepo,
      payArrangements,
      timeEntries: makeTimeEntries({
        findRunningInHousehold: mock(async () => ({
          id: 'te1',
          household_id: 'h1',
          status: 'running',
        })),
      }),
    });

    await expect(svc.leave('u1', 'h1')).rejects.toBeInstanceOf(
      CannotLeaveWhileClockedInError
    );
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
    expect(payArrangements.endForCarer).not.toHaveBeenCalled();
  });

  it('scopes the running-entry check to THIS household and the caller', async () => {
    const timeEntries = makeTimeEntries();
    const svc = svcWith({ timeEntries });

    await svc.leave('u1', 'h1');

    expect(timeEntries.findRunningInHousehold).toHaveBeenCalledWith('h1', 'u1');
  });

  it('writes removed on the CALLER OWN membership row', async () => {
    const memberRepo = makeMemberRepo();
    const svc = svcWith({ memberRepo });

    const left = await svc.leave('u1', 'h1');

    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m1');
    expect(left.status).toBe('removed');
  });

  it('404s when the CAS matches nothing — already removed, or removed underneath us', async () => {
    const svc = svcWith({
      memberRepo: makeMemberRepo({ removeMembership: mock(async () => null) }),
    });

    await expect(svc.leave('u1', 'h1')).rejects.toBeInstanceOf(
      MemberNotFoundError
    );
  });

  it('end-dates a leaving NANNY pay arrangement on the household-local date', async () => {
    // Identical 065 consequence to being removed: a rejoin must not resurrect
    // stale terms (docs/11-MONEY.md §10).
    const payArrangements = makePayArrangements();
    const svc = svcWith({ payArrangements });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(payArrangements.endForCarer).toHaveBeenCalledWith(
      'h1',
      'u1',
      '2026-07-01'
    );
  });

  it('ends on the HOUSEHOLD-LOCAL date, not server UTC', async () => {
    const payArrangements = makePayArrangements();
    const svc = svcWith({
      payArrangements,
      householdRepo: makeHouseholdRepo({
        findById: mock(async () => ({
          ...household,
          timezone: 'Pacific/Auckland',
        })),
      }),
    });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(payArrangements.endForCarer).toHaveBeenCalledWith(
      'h1',
      'u1',
      '2026-07-02'
    );
  });

  it('does NOT end-date pay when a non-owner PARENT leaves — they were never a carer', async () => {
    // `endForCarer` keys on (household, carer). A co-parent has no arrangement
    // to end, and calling it anyway would be a write nobody asked for.
    const payArrangements = makePayArrangements();
    const svc = svcWith({ role: 'parent', payArrangements });

    const left = await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(payArrangements.endForCarer).not.toHaveBeenCalled();
    expect(left.status).toBe('removed');
  });

  it('does NOT end-date pay when a HELPER leaves', async () => {
    const payArrangements = makePayArrangements();
    const svc = svcWith({ role: 'helper', payArrangements });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(payArrangements.endForCarer).not.toHaveBeenCalled();
  });

  it('end-dates BEFORE flipping the membership — the ordering that cannot strand', async () => {
    const order: string[] = [];
    const payArrangements = makePayArrangements({
      endForCarer: mock(async () => {
        order.push('end-arrangement');
        return [];
      }),
    });
    const memberRepo = makeMemberRepo({
      removeMembership: mock(async (id: string) => {
        order.push('remove-membership');
        return { ...membershipFor('nanny'), id, status: 'removed' };
      }),
    });
    const svc = svcWith({ payArrangements, memberRepo });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(order).toEqual(['end-arrangement', 'remove-membership']);
  });

  it('refuses the whole leave when the end-date write fails, rather than half-leaving', async () => {
    const memberRepo = makeMemberRepo();
    const svc = svcWith({
      memberRepo,
      payArrangements: makePayArrangements({
        endForCarer: mock(async () => {
          throw new DatabaseError('boom', 'DATABASE_ERROR');
        }),
      }),
    });

    await expect(svc.leave('u1', 'h1', AT_NOON_UTC)).rejects.toThrow('boom');
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  // F8 — a proposal only ever names a carer, so this is gated NANNY-only, the
  // same conditional `endForCarer` already carries a few tests up.
  it("withdraws the leaving NANNY's open terms proposal (F8)", async () => {
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => ({
        id: 'tp-1',
        status: 'withdrawn',
      })),
    };
    const svc = svcWith({ proposals });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(proposals.withdrawOpenForCarer).toHaveBeenCalledWith('h1', 'u1');
  });

  it('does NOT withdraw for a non-owner PARENT leaving — no carer_id to scope to', async () => {
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => null),
    };
    const svc = svcWith({ role: 'parent', proposals });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(proposals.withdrawOpenForCarer).not.toHaveBeenCalled();
  });

  it('does NOT withdraw for a HELPER leaving', async () => {
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => null),
    };
    const svc = svcWith({ role: 'helper', proposals });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(proposals.withdrawOpenForCarer).not.toHaveBeenCalled();
  });

  it('withdraws BEFORE flipping the membership, same ordering discipline as endForCarer', async () => {
    const order: string[] = [];
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => {
        order.push('withdraw-proposal');
        return null;
      }),
    };
    const memberRepo = makeMemberRepo({
      removeMembership: mock(async (id: string) => {
        order.push('remove-membership');
        return { ...membershipFor('nanny'), id, status: 'removed' };
      }),
    });
    const svc = svcWith({ memberRepo, proposals });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(order.indexOf('withdraw-proposal')).toBeLessThan(
      order.indexOf('remove-membership')
    );
  });

  // Same discipline as `endForCarer`'s own failure two tests up.
  it('a withdraw failure refuses the whole leave, same discipline as endForCarer', async () => {
    const memberRepo = makeMemberRepo();
    const proposals = {
      ...stubProposals,
      withdrawOpenForCarer: mock(async () => {
        throw new DatabaseError('boom', 'DATABASE_ERROR');
      }),
    };
    const svc = svcWith({ memberRepo, proposals });

    await expect(svc.leave('u1', 'h1', AT_NOON_UTC)).rejects.toThrow('boom');
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  // THE defect this whole feature had to fix before the button could exist.
  // `leave` did not end her patterns, and `listAccepted` — the read
  // `scheduleHorizonJob` iterates — has no membership filter. She left, and
  // the job kept manufacturing her shifts to the horizon while `reminderJob`
  // kept pushing "you have a shift tomorrow" at her.
  it('ends the leaving NANNY accepted patterns, for THIS household and carer, at the leave instant', async () => {
    const schedulePatterns = makeSchedulePatterns();
    const svc = svcWith({ schedulePatterns });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(schedulePatterns.endAcceptedPatternsForCarer).toHaveBeenCalledWith(
      'h1',
      'u1',
      AT_NOON_UTC()
    );
  });

  // A co-parent or helper holds no pattern — neither can be a shift's carer —
  // so the teardown is not merely unnecessary for them, it has nothing to act
  // on. Same NANNY-only gate as the withdraw and the end-date above.
  it('leaves patterns alone for a co-parent or helper, who hold none', async () => {
    for (const role of ['parent', 'helper'] as const) {
      const schedulePatterns = makeSchedulePatterns();
      const svc = svcWith({ role, schedulePatterns });

      await svc.leave('u1', 'h1', AT_NOON_UTC);

      expect(
        schedulePatterns.endAcceptedPatternsForCarer
      ).not.toHaveBeenCalled();
    }
  });

  it('ends the patterns BEFORE flipping the membership — the ordering that cannot strand', async () => {
    const order: string[] = [];
    const schedulePatterns = {
      endAcceptedPatternsForCarer: mock(async () => {
        order.push('end-patterns');
        return [];
      }),
    };
    const memberRepo = makeMemberRepo({
      removeMembership: mock(async (id: string) => {
        order.push('remove-membership');
        return { ...membershipFor('nanny'), id, status: 'removed' };
      }),
    });
    const svc = svcWith({ memberRepo, schedulePatterns });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(order).toEqual(['end-patterns', 'remove-membership']);
  });

  it('a pattern-teardown failure refuses the whole leave, membership unchanged', async () => {
    const memberRepo = makeMemberRepo();
    const svc = svcWith({
      memberRepo,
      schedulePatterns: {
        endAcceptedPatternsForCarer: mock(async () => {
          throw new DatabaseError('patterns boom', 'DATABASE_ERROR');
        }),
      },
    });

    await expect(svc.leave('u1', 'h1', AT_NOON_UTC)).rejects.toThrow(
      'patterns boom'
    );
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  // The half that reaches the FAMILY. Without it the day she vacated still
  // reads as covered — detection counts any shift with a carer_id as cover,
  // and membership change is not a trigger — so the parents learn nothing
  // until the 03:00 sweep.
  it('re-runs uncovered-care detection for exactly the days she vacated', async () => {
    const detectUncovered = makeDetectUncovered();
    const svc = svcWith({
      schedulePatterns: makeSchedulePatterns(['2026-08-25']),
      detectUncovered,
    });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(detectUncovered).toHaveBeenCalledTimes(1);
    expect(detectUncovered).toHaveBeenCalledWith({
      householdId: 'h1',
      localDate: '2026-08-25',
      cause: 'cancelled',
      actorId: 'u1',
    });
  });

  it('raises nothing for a co-parent, whose leaving takes nobody off the calendar', async () => {
    const detectUncovered = makeDetectUncovered();
    const svc = svcWith({ role: 'parent', detectUncovered });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(detectUncovered).not.toHaveBeenCalled();
  });

  // `status = 'removed'` alone cannot tell a resignation from a dismissal, and
  // the family's departure card says opposite things about them. Before 112
  // this path stamped nothing at all, so a self-departure was indistinguishable
  // from a row written before the column existed.
  it('stamps that she LEFT, when, and that it was her own doing', async () => {
    const memberRepo = makeMemberRepo();
    const svc = svcWith({ memberRepo });

    await svc.leave('u1', 'h1', AT_NOON_UTC);

    expect(memberRepo.update).toHaveBeenCalledWith('m1', {
      ended_reason: 'left',
      ended_at: AT_NOON_UTC().toISOString(),
      ended_by: 'u1',
    });
  });

  it('stamps nothing when the CAS found no row to flip', async () => {
    const memberRepo = makeMemberRepo({
      removeMembership: mock(async () => null),
    });
    const svc = svcWith({ memberRepo });

    await expect(svc.leave('u1', 'h1', AT_NOON_UTC)).rejects.toThrow();

    expect(memberRepo.update).not.toHaveBeenCalled();
  });
});

/**
 * P8 — the parent's pay OFFER, written before he has a nanny to hang it on.
 *
 * Two refusals are worth their tests here. A non-nanny invite carrying terms
 * is a client bug that would store a rate nobody will ever be shown (pay is
 * per-carer, D-21), and an offer whose `valid_from` is already impossible is
 * one the promotion would have to drop on redemption — better refused at the
 * keyboard, where he can fix it, than silently dropped a month later.
 */
describe('HouseholdCommandService.createInvite — the pay offer (P8)', () => {
  // Shaped as the wire hands it over: `CreatePayArrangementRequestSchema`
  // defaults `overtime_multiplier`, so a parsed offer always carries one.
  const offer = {
    rate_minor: 2800,
    overtime_multiplier: 1.5,
    valid_from: '2026-09-01',
  };

  function makeSvc(inviteRepo: any, role: HouseholdMember['role'] = 'owner') {
    return new HouseholdCommandService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      inviteRepo,
      makeQueries(role),
      stubUsers
    );
  }

  it('stores the offer on a nanny invite', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await makeSvc(inviteRepo).createInvite(
      'u1',
      'h1',
      { role: 'nanny', pay_offer: offer },
      AT_NOON_UTC
    );

    expect(inviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'nanny', pay_offer: offer })
    );
  });

  it('writes an explicit null when no offer was given', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await makeSvc(inviteRepo).createInvite('u1', 'h1', { role: 'nanny' });

    expect(inviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ pay_offer: null })
    );
  });

  it('refuses an offer on a parent invite — pay is per-carer (D-21)', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await expect(
      makeSvc(inviteRepo).createInvite('u1', 'h1', {
        role: 'parent',
        pay_offer: offer,
      })
    ).rejects.toBeInstanceOf(PayOfferNotForRoleError);
    expect(inviteRepo.create).not.toHaveBeenCalled();
  });

  it('refuses an offer on a helper invite', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await expect(
      makeSvc(inviteRepo).createInvite('u1', 'h1', {
        role: 'helper',
        pay_offer: offer,
      })
    ).rejects.toBeInstanceOf(PayOfferNotForRoleError);
  });

  it('still allows a parent or helper invite with no offer', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await makeSvc(inviteRepo).createInvite('u1', 'h1', { role: 'helper' });
    expect(inviteRepo.create).toHaveBeenCalledTimes(1);
  });

  // D-16's horizon, measured in HOUSEHOLD-local time: the fixture household is
  // Europe/London, so noon UTC on 1 Jul 2026 is the 1st there and the horizon
  // lands on 1 Jul 2027 exactly.
  it('accepts a valid_from on the last day of the 12-month horizon', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await makeSvc(inviteRepo).createInvite(
      'u1',
      'h1',
      { role: 'nanny', pay_offer: { ...offer, valid_from: '2027-07-01' } },
      AT_NOON_UTC
    );
    expect(inviteRepo.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a valid_from one day beyond the horizon', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await expect(
      makeSvc(inviteRepo).createInvite(
        'u1',
        'h1',
        { role: 'nanny', pay_offer: { ...offer, valid_from: '2027-07-02' } },
        AT_NOON_UTC
      )
    ).rejects.toBeInstanceOf(TermsProposalValidationError);
    expect(inviteRepo.create).not.toHaveBeenCalled();
  });

  // A past start date is legitimate — 076's effective-arrangement rule reads
  // the greatest `valid_from <= date`, and back-dating terms to the day she
  // actually started is the ordinary case, not an error.
  it('accepts a valid_from in the past', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await makeSvc(inviteRepo).createInvite(
      'u1',
      'h1',
      { role: 'nanny', pay_offer: { ...offer, valid_from: '2020-01-01' } },
      AT_NOON_UTC
    );
    expect(inviteRepo.create).toHaveBeenCalledTimes(1);
  });

  it('refuses before the role gate is passed — a nanny cannot write an offer', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    await expect(
      makeSvc(inviteRepo, 'nanny').createInvite('u1', 'h1', {
        role: 'nanny',
        pay_offer: offer,
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  // F7 — defence in depth. Unreachable from either client today (no client
  // attaches an offer to a draft invite, and the offer UI is parent-gated
  // while a draft's only member is always the nanny who authored it), but a
  // direct API call must still be refused rather than silently write a rate
  // nobody in the household can have offered.
  it('refuses an offer on a draft household (F7)', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo({
        findById: mock(async () => ({ ...household, state: 'draft' })),
      }),
      makeMemberRepo(),
      inviteRepo,
      makeQueries('owner'),
      stubUsers
    );

    await expect(
      svc.createInvite(
        'u1',
        'h1',
        { role: 'nanny', pay_offer: offer },
        AT_NOON_UTC
      )
    ).rejects.toBeInstanceOf(PayOfferNotForDraftHouseholdError);
    expect(inviteRepo.create).not.toHaveBeenCalled();
  });
});

/**
 * P8 — promoting the parent's offer on redemption.
 *
 * THE FAILURE POLICY IS THE POINT OF THIS BLOCK. She has already claimed the
 * code and her membership row exists by the time promotion runs; the claim is
 * burned and cannot be handed back. So NOTHING here may throw — a promotion
 * that fails must cost her a proposal, never the household she legitimately
 * joined. Every test below that ends in `.resolves` is guarding that, and a
 * refactor that lets one of these errors escape would strand a real nanny
 * outside a real family with a code that no longer works.
 */
describe('HouseholdCommandService.redeemInvite — promoting the pay offer (P8)', () => {
  // Shaped as the wire hands it over: `CreatePayArrangementRequestSchema`
  // defaults `overtime_multiplier`, so a parsed offer always carries one.
  const offer = {
    rate_minor: 2800,
    overtime_multiplier: 1.5,
    valid_from: '2026-09-01',
  };

  function makeProposals(overrides: Record<string, unknown> = {}): any {
    return {
      create: mock(async (row: Record<string, unknown>) => ({
        id: 'p-new',
        ...row,
      })),
      ...overrides,
    };
  }

  function makeUsers(name: string | null = 'Nia'): any {
    return {
      ensureProfile: mock(async () => {}),
      getProfileById: mock(async () => (name === null ? null : { name })),
    };
  }

  function makeSvc({
    inviteRepo = makeInviteRepo(),
    memberRepo = makeMemberRepo(),
    proposals = makeProposals(),
    users = makeUsers(),
  }: Record<string, any> = {}) {
    return new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      users,
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      { existsForHousehold: mock(async () => false) } as any,
      stubHolidays,
      proposals
    );
  }

  function offerInvite(overrides: Partial<HouseholdInvite> = {}): any {
    return makeInviteRepo({
      findByCode: mock(async () =>
        pendingInvite({ role: 'nanny', pay_offer: offer, ...overrides })
      ),
    });
  }

  it('promotes the offer into a parent-direction proposal for the redeemer', async () => {
    const proposals = makeProposals();
    const svc = makeSvc({ inviteRepo: offerInvite(), proposals });

    const membership = await svc.redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(membership.role).toBe('nanny');
    expect(proposals.create).toHaveBeenCalledWith({
      household_id: 'h1',
      carer_id: 'u-nanny',
      // The PARENT who wrote the terms, never the person who typed the code.
      // Getting this backwards makes §10 render "Proposed by Nia" on terms
      // she is being asked to accept.
      proposed_by: 'u1',
      direction: 'parent',
      terms: offer,
      note: null,
      supersedes_id: null,
      from_invite_id: 'i1',
      carer_display_name: 'Nia',
    });
  });

  // 092 defaults `status` to 'proposed', and `NewTermsProposalRow` has no such
  // field — the same insert shape `termsProposalCommandService.propose` uses.
  it('leaves status to the column default rather than inventing one', async () => {
    const proposals = makeProposals();
    await makeSvc({ inviteRepo: offerInvite(), proposals }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );
    expect(proposals.create.mock.calls[0][0].status).toBeUndefined();
  });

  it('falls back to "Carer" when the redeemer has no profile name', async () => {
    const proposals = makeProposals();
    await makeSvc({
      inviteRepo: offerInvite(),
      proposals,
      users: makeUsers(null),
    }).redeemInvite('u-nanny', { code: 'ABC-234' }, AT_NOON_UTC);

    expect(proposals.create.mock.calls[0][0].carer_display_name).toBe('Carer');
  });

  it('joins her anyway when she already has an open round in this household', async () => {
    const proposals = makeProposals({
      create: mock(async () => {
        throw new OpenTermsProposalExistsError('h1', 'u-nanny');
      }),
    });
    const svc = makeSvc({ inviteRepo: offerInvite(), proposals });

    const membership = await svc.redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(membership.role).toBe('nanny');
  });

  it('joins her anyway when the proposal insert fails for any other reason', async () => {
    const proposals = makeProposals({
      create: mock(async () => {
        throw new DatabaseError('boom', 'DATABASE_ERROR');
      }),
    });
    const svc = makeSvc({ inviteRepo: offerInvite(), proposals });

    await expect(
      svc.redeemInvite('u-nanny', { code: 'ABC-234' }, AT_NOON_UTC)
    ).resolves.toMatchObject({ role: 'nanny' });
  });

  // An invite lives 30 days, so a start date written in month 12 can be out of
  // reach by the time she types the code. The parent's date is NEVER rewritten
  // to make it fit (§7.4) — the promotion is skipped and she joins with no
  // terms, which is exactly where she would have been without P8.
  it('skips a promotion whose valid_from has drifted past the horizon', async () => {
    const proposals = makeProposals();
    const inviteRepo = offerInvite({
      pay_offer: { ...offer, valid_from: '2027-07-02' },
    });

    const membership = await makeSvc({ inviteRepo, proposals }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(membership.role).toBe('nanny');
    expect(proposals.create).not.toHaveBeenCalled();
  });

  it('does not promote when the invite carries no offer', async () => {
    const proposals = makeProposals();
    await makeSvc({ proposals }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );
    expect(proposals.create).not.toHaveBeenCalled();
  });

  // Defence in depth: `createInvite` refuses this shape, so a row like it can
  // only predate the guard or come from a direct database write. Pay is
  // per-carer (D-21) and a co-parent has no carer_id to scope a proposal to.
  it('never promotes an offer that somehow rode a non-nanny invite', async () => {
    const proposals = makeProposals();
    const inviteRepo = offerInvite({ role: 'parent' });

    await makeSvc({ inviteRepo, proposals }).redeemInvite(
      'u-parent',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(proposals.create).not.toHaveBeenCalled();
  });

  // 009 declares `invited_by ... on delete set null`, so the parent who wrote
  // the terms can be gone by redemption. `terms_proposals.proposed_by` is
  // `not null` (092), and there is nobody honest to name — skip it.
  it('skips the promotion when the inviting parent no longer exists', async () => {
    const proposals = makeProposals();
    const inviteRepo = offerInvite({ invited_by: null });

    const membership = await makeSvc({ inviteRepo, proposals }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(membership.role).toBe('nanny');
    expect(proposals.create).not.toHaveBeenCalled();
  });

  // A removed nanny redeeming a fresh code takes the reactivation branch. Her
  // old arrangement was end-dated on removal (065), so terms are exactly what
  // she needs on the way back in — the promotion belongs on this arm too.
  it('promotes on a rejoin as well as a first join', async () => {
    const proposals = makeProposals();
    const memberRepo = makeMemberRepo({
      findMembershipIncludingCandidate: mock(async () => ({
        id: 'm-old',
        status: 'removed',
      })),
    });

    await makeSvc({
      inviteRepo: offerInvite(),
      memberRepo,
      proposals,
    }).redeemInvite('u-nanny', { code: 'ABC-234' }, AT_NOON_UTC);

    expect(memberRepo.reactivateMembership).toHaveBeenCalled();
    expect(proposals.create).toHaveBeenCalledWith(
      expect.objectContaining({ carer_id: 'u-nanny', direction: 'parent' })
    );
  });

  // The membership on this path stays `active`, unlike 094/096's `candidate`:
  // she was invited BY NAME, she is hired, only the rate is open. That is what
  // keeps `assertActiveNanny` passing when she accepts.
  it('leaves the membership active — only the rate is open', async () => {
    const memberRepo = makeMemberRepo();
    await makeSvc({ inviteRepo: offerInvite(), memberRepo }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  // F5 — bring this resolver in line with `payArrangementCommandService` and
  // `termsProposalCommandService.resolveCarerDisplayName`: the household's own
  // `display_name_override` (what THIS family calls her) wins over the
  // profile name.
  it('honours display_name_override over the profile name (F5)', async () => {
    const proposals = makeProposals();
    const memberRepo = makeMemberRepo({
      createMembership: mock(async (data: Record<string, unknown>) => ({
        id: 'm-new',
        joined_at: 't',
        created_at: 't',
        updated_at: 't',
        display_name_override: 'Nini',
        colour: null,
        ...data,
      })),
    });

    await makeSvc({
      inviteRepo: offerInvite(),
      memberRepo,
      proposals,
      users: makeUsers('Nia'),
    }).redeemInvite('u-nanny', { code: 'ABC-234' }, AT_NOON_UTC);

    expect(proposals.create.mock.calls[0][0].carer_display_name).toBe('Nini');
  });

  it('whitespace-only display_name_override counts as absent, falls through to the profile', async () => {
    const proposals = makeProposals();
    const memberRepo = makeMemberRepo({
      createMembership: mock(async (data: Record<string, unknown>) => ({
        id: 'm-new',
        joined_at: 't',
        created_at: 't',
        updated_at: 't',
        display_name_override: '   ',
        colour: null,
        ...data,
      })),
    });

    await makeSvc({
      inviteRepo: offerInvite(),
      memberRepo,
      proposals,
      users: makeUsers('Nia'),
    }).redeemInvite('u-nanny', { code: 'ABC-234' }, AT_NOON_UTC);

    expect(proposals.create.mock.calls[0][0].carer_display_name).toBe('Nia');
  });
});

/**
 * F3 — every exit path of `promoteOfferToProposal` records its outcome on
 * `household_invites.pay_offer_promotion`, since the method itself never
 * throws and the column is the only record of what happened.
 */
describe('HouseholdCommandService.redeemInvite — recording the pay-offer promotion outcome (F3)', () => {
  const offer = {
    rate_minor: 2800,
    overtime_multiplier: 1.5,
    valid_from: '2026-09-01',
  };

  function makeProposals(overrides: Record<string, unknown> = {}): any {
    return {
      create: mock(async (row: Record<string, unknown>) => ({
        id: 'p-new',
        ...row,
      })),
      ...overrides,
    };
  }

  function makeSvc({
    inviteRepo,
    memberRepo = makeMemberRepo(),
    proposals = makeProposals(),
  }: Record<string, any>) {
    return new HouseholdCommandService(
      makeHouseholdRepo(),
      memberRepo,
      inviteRepo,
      makeQueries(),
      makeUsers2(),
      makeTimeEntries(),
      makePayArrangements(),
      stubPtoLedger,
      { existsForHousehold: mock(async () => false) } as any,
      stubHolidays,
      proposals
    );
  }

  function makeUsers2(): any {
    return {
      ensureProfile: mock(async () => {}),
      getProfileById: mock(async () => ({ name: 'Nia' })),
    };
  }

  function offerInvite(
    overrides: Partial<HouseholdInvite> = {},
    repoOverrides: Record<string, unknown> = {}
  ): any {
    return makeInviteRepo({
      findByCode: mock(async () =>
        pendingInvite({ role: 'nanny', pay_offer: offer, ...overrides })
      ),
      ...repoOverrides,
    });
  }

  it('records "promoted" on a successful promotion', async () => {
    const inviteRepo = offerInvite();
    await makeSvc({ inviteRepo }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(inviteRepo.updatePayOfferPromotion).toHaveBeenCalledWith(
      'i1',
      'promoted'
    );
  });

  it('records "skipped_no_inviter" and never writes when there is no offer to begin with', async () => {
    const noOfferInviteRepo = makeInviteRepo();
    await makeSvc({ inviteRepo: noOfferInviteRepo }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    // No offer attached at all — nothing was being promoted, so the outcome
    // column is left alone rather than stamped with a verdict about nothing.
    expect(noOfferInviteRepo.updatePayOfferPromotion).not.toHaveBeenCalled();
  });

  it('records "skipped_no_inviter" when the inviting parent is gone', async () => {
    const inviteRepo = offerInvite({ invited_by: null });
    await makeSvc({ inviteRepo }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(inviteRepo.updatePayOfferPromotion).toHaveBeenCalledWith(
      'i1',
      'skipped_no_inviter'
    );
  });

  it('records "skipped_stale" when valid_from has drifted past the horizon', async () => {
    const inviteRepo = offerInvite({
      pay_offer: { ...offer, valid_from: '2027-07-02' },
    });
    await makeSvc({ inviteRepo }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(inviteRepo.updatePayOfferPromotion).toHaveBeenCalledWith(
      'i1',
      'skipped_stale'
    );
  });

  it('records "skipped_open_round" when a round is already open', async () => {
    const inviteRepo = offerInvite();
    const proposals = makeProposals({
      create: mock(async () => {
        throw new OpenTermsProposalExistsError('h1', 'u-nanny');
      }),
    });
    await makeSvc({ inviteRepo, proposals }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(inviteRepo.updatePayOfferPromotion).toHaveBeenCalledWith(
      'i1',
      'skipped_open_round'
    );
  });

  it('records "failed" on a generic insert failure', async () => {
    const inviteRepo = offerInvite();
    const proposals = makeProposals({
      create: mock(async () => {
        throw new DatabaseError('boom', 'DATABASE_ERROR');
      }),
    });
    await makeSvc({ inviteRepo, proposals }).redeemInvite(
      'u-nanny',
      { code: 'ABC-234' },
      AT_NOON_UTC
    );

    expect(inviteRepo.updatePayOfferPromotion).toHaveBeenCalledWith(
      'i1',
      'failed'
    );
  });

  it('a failure recording the outcome never escapes — the redeem still resolves', async () => {
    const inviteRepo = offerInvite(
      {},
      {
        updatePayOfferPromotion: mock(async () => {
          throw new DatabaseError('boom', 'DATABASE_ERROR');
        }),
      }
    );

    await expect(
      makeSvc({ inviteRepo }).redeemInvite(
        'u-nanny',
        { code: 'ABC-234' },
        AT_NOON_UTC
      )
    ).resolves.toMatchObject({ role: 'nanny' });
  });
});
