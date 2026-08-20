/**
 * Draft households (3-O, D-34/D-36/D-49) — creation, the §2.2 draft-author
 * capability, the owner-invariant audit, and redemption dispatch.
 *
 * Kept out of `householdCommandService.test.ts` for the reason every other
 * `.pushes`/`.holidaySeed` sibling is: that file pins the shipped
 * parent-authored flow, and a draft is a different world with its own
 * fixtures. Nothing here may change an assertion over there.
 */
import { describe, expect, it, mock, spyOn } from 'bun:test';
import {
  AlreadyMemberError,
  CannotLeaveAsOwnerError,
  InviteNotFoundError,
  NotAHouseholdParentError,
} from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdCommandService } from '../../../../../src/domains/household/services/householdCommandService';
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
} from '../../../../../src/domains/household/types';
import { logger } from '../../../../../src/middlewares/logger';

const NANNY_ID = 'u-nanny';

/** A live household, the ordinary case every other test file assumes. */
const liveHousehold: Household = {
  id: 'h1',
  name: 'The Ahmeds',
  timezone: 'America/Chicago',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'short_notice_and_cancellations',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  currency: 'USD',
  jurisdiction: null,
  week_starts_on: 1,
  country: 'US',
  state: 'live',
  created_by: 'u1',
  created_at: 't',
  updated_at: 't',
};

/** Marisol's draft: no name, no owner, created by her. */
const draftHousehold: Household = {
  ...liveHousehold,
  id: 'h-draft',
  name: null,
  state: 'draft',
  created_by: NANNY_ID,
};

function draftAuthorMembership(
  overrides: Partial<HouseholdMember> = {}
): HouseholdMember {
  return {
    id: 'm-draft',
    household_id: 'h-draft',
    user_id: NANNY_ID,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: 't',
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function invite(overrides: Partial<HouseholdInvite> = {}): HouseholdInvite {
  return {
    id: 'i1',
    household_id: 'h-draft',
    code: 'ABC-234',
    email: null,
    role: 'nanny',
    invited_by: NANNY_ID,
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

function makeHouseholdRepo(household: Household = draftHousehold): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...liveHousehold,
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
    // §8's one-live-household-per-parent guard filters the caller's parent
    // memberships through this. Empty by default: these fixtures are about
    // drafts, and a draft never reaches the guard.
    listLiveIds: mock(async () => []),
    listActiveChildFirstNames: mock(async () => []),
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
    findMembershipAnyStatus: mock(async () => null),
    findMembershipIncludingCandidate: mock(async () => null),
    findById: mock(async () => null),
    listActiveByUser: mock(async () => []),
    listActiveByHousehold: mock(async () => []),
    // 110: `removeMember` stamps `ended_reason` through the generic update
    // right after the CAS flip.
    update: mock(async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    })),
    removeMembership: mock(async (id: string) => ({
      ...draftAuthorMembership(),
      id,
      status: 'removed',
    })),
    reactivateMembership: mock(async () => null),
    activateCandidate: mock(async () => null),
    ...overrides,
  };
}

function makeInviteRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByCode: mock(async () => invite()),
    findById: mock(async () => invite()),
    revokePending: mock(async (id: string) =>
      invite({ id, status: 'revoked' })
    ),
    create: mock(async (data: Record<string, unknown>) => ({
      ...invite(),
      ...data,
      id: 'i-new',
    })),
    claimPending: mock(async (id: string) =>
      invite({ id, status: 'accepted' })
    ),
    releaseClaim: mock(async () => {}),
    redeemDraftHousehold: mock(async () => ({
      outcome: 'not_a_draft_invite',
    })),
    ...overrides,
  };
}

function makeQueries(membership: HouseholdMember): any {
  return { getMembership: mock(async () => membership) };
}

const stubUsers: any = { ensureProfile: mock(async () => {}) };
const stubHolidays: any = {
  seedCountryPack: mock(async () => []),
  upsertMany: mock(async () => []),
  listForHousehold: mock(async () => []),
  deleteKeysNotIn: mock(async () => undefined),
};
const stubTimeEntries: any = { findRunningInHousehold: mock(async () => null) };
const stubPayArrangements: any = { endForCarer: mock(async () => []) };
const stubPtoLedger: any = { listForCarerYear: mock(async () => []) };
const stubTimesheets: any = { existsForHousehold: mock(async () => false) };
// F8: `leave`/`removeMember` now call `proposals.withdrawOpenForCarer`. Left
// defaulted this constructs a REAL TermsProposalRepository and the test dies
// on a network call rather than an assertion — same hazard every other stub*
// above already guards against for its own repository.
const stubProposals: any = { withdrawOpenForCarer: mock(async () => null) };

// Same hazard, same guard: `removeMember` now ends the carer's accepted
// patterns, and left defaulted this constructs a REAL SchedulePatternRepository.
const stubPatterns: any = {
  listAcceptedByHouseholdAndCarer: mock(async () => []),
  update: mock(async () => ({ id: 'p1', status: 'ended' })),
};
const stubMaterialisation: any = {
  cancelFutureShiftsForEndedPattern: mock(async () => 0),
};

/** The whole ctor, so a positional argument is never miscounted below. */
function makeService(parts: {
  householdRepo?: any;
  memberRepo?: any;
  inviteRepo?: any;
  queries?: any;
  holidays?: any;
}): HouseholdCommandService {
  return new HouseholdCommandService(
    parts.householdRepo ?? makeHouseholdRepo(),
    parts.memberRepo ?? makeMemberRepo(),
    parts.inviteRepo ?? makeInviteRepo(),
    parts.queries ?? makeQueries(draftAuthorMembership()),
    stubUsers,
    stubTimeEntries,
    stubPayArrangements,
    stubPtoLedger,
    stubTimesheets,
    parts.holidays ?? stubHolidays,
    stubProposals,
    undefined,
    stubPatterns,
    stubMaterialisation
  );
}

describe('HouseholdCommandService.create — a nanny-authored draft', () => {
  // The line that makes D-36 structural. A draft with an OWNER membership
  // would be a household where somebody passes WRITE_ROLES, which is a
  // household that can hold a pay_arrangement.
  it('gives the draft creator a nanny membership, never owner', async () => {
    const householdRepo = makeHouseholdRepo();
    const memberRepo = makeMemberRepo();
    const svc = makeService({ householdRepo, memberRepo });

    await svc.create(NANNY_ID, { state: 'draft' });

    expect(householdRepo.create).toHaveBeenCalledWith({
      state: 'draft',
      created_by: NANNY_ID,
    });
    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h-new',
        user_id: NANNY_ID,
        role: 'nanny',
        status: 'active',
        can_edit: false,
      })
    );
  });

  it('leaves the live path untouched — a live create still makes an owner', async () => {
    const memberRepo = makeMemberRepo();
    const svc = makeService({ memberRepo });

    await svc.create('u1', { name: 'The Ahmeds' });

    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner', can_edit: true })
    );
  });
});

describe('the §2.2 draftAuthor capability', () => {
  it('lets the author rename her own draft', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = makeService({ householdRepo });

    await svc.update(NANNY_ID, 'h-draft', { name: 'The Bakers' });

    expect(householdRepo.update).toHaveBeenCalledWith('h-draft', {
      name: 'The Bakers',
    });
  });

  it('refuses every other field on that same update — it grants the NAME, not the household', async () => {
    const svc = makeService({});

    await expect(
      svc.update(NANNY_ID, 'h-draft', { timezone: 'America/New_York' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('lets the author mint an invite for her own draft', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    const svc = makeService({ inviteRepo });

    await svc.createInvite(NANNY_ID, 'h-draft', { role: 'parent' });

    expect(inviteRepo.create).toHaveBeenCalled();
  });

  it('lets the author revoke an invite for her own draft', async () => {
    const inviteRepo = makeInviteRepo();
    const svc = makeService({ inviteRepo });

    await svc.revokeInvite(NANNY_ID, 'h-draft', 'i1');

    expect(inviteRepo.revokePending).toHaveBeenCalledWith('i1', 'h-draft');
  });

  it('refuses setHolidays — the capability is four doors, not a role', async () => {
    const svc = makeService({});

    await expect(
      svc.setHolidays(NANNY_ID, 'h-draft', { holidays: [] })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('evaluates false once the household is live, on a membership that is otherwise identical', async () => {
    // The safety property: her role and her created_by never change, so if the
    // state check were dropped she would keep writing after the family joined.
    const svc = makeService({
      householdRepo: makeHouseholdRepo({
        ...draftHousehold,
        state: 'live',
        name: 'The Ahmeds',
      }),
    });

    await expect(
      svc.update(NANNY_ID, 'h-draft', { name: 'Something else' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('refuses a SECOND nanny in the draft — created_by is load-bearing', async () => {
    const svc = makeService({
      queries: makeQueries(
        draftAuthorMembership({ id: 'm-other', user_id: 'u-other-nanny' })
      ),
    });

    await expect(
      svc.update('u-other-nanny', 'h-draft', { name: 'Mine now' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('owner invariants tolerate a household with no owner', () => {
  // A draft has none, so the rule that protects a live household must simply
  // not fire rather than throw looking for one.
  it('lets the draft author LEAVE — abandoning her own draft is not orphaning a household', async () => {
    const memberRepo = makeMemberRepo();
    const svc = makeService({ memberRepo });

    const result = await svc.leave(NANNY_ID, 'h-draft');

    expect(result.status).toBe('removed');
    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-draft');
  });

  it('still refuses an owner leaving a live household', async () => {
    const svc = makeService({
      householdRepo: makeHouseholdRepo(liveHousehold),
      queries: makeQueries(
        draftAuthorMembership({ role: 'owner', household_id: 'h1' })
      ),
    });

    await expect(svc.leave('u1', 'h1')).rejects.toBeInstanceOf(
      CannotLeaveAsOwnerError
    );
  });
});

describe('createInvite — the §6.1 share fields', () => {
  it('defaults the public link window to 7 days, not the code’s 30', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    const svc = makeService({ inviteRepo });
    const before = Date.now();

    await svc.createInvite(NANNY_ID, 'h-draft', { role: 'parent' });

    const written = inviteRepo.create.mock.calls[0][0];
    const days =
      (new Date(written.link_expires_at).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(written.label).toBeNull();
  });

  it('honours the 30-day chip and stores her private label', async () => {
    const inviteRepo = makeInviteRepo({ findByCode: mock(async () => null) });
    const svc = makeService({ inviteRepo });
    const before = Date.now();

    await svc.createInvite(NANNY_ID, 'h-draft', {
      role: 'parent',
      label: 'The Bakers',
      link_expires_in_days: 30,
    });

    const written = inviteRepo.create.mock.calls[0][0];
    const days =
      (new Date(written.link_expires_at).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(written.label).toBe('The Bakers');
  });
});

describe('redeemInvite — dispatch to the draft redemption function', () => {
  const membershipRow = {
    ...draftAuthorMembership(),
    id: 'm-joined',
    household_id: 'h-target',
    status: 'candidate',
  };

  function redeemWith(payload: Record<string, unknown>) {
    const inviteRepo = makeInviteRepo({
      redeemDraftHousehold: mock(async () => payload),
    });
    // Redeemer is the OWNER of the instantiated household — 094 returns the
    // nanny row in `membership`, but redeemInvite must hand the client the
    // caller's own row so setup role resolves correctly.
    const redeemerMembership = {
      id: 'm-owner',
      household_id: 'h-target',
      user_id: 'u-parent',
      role: 'owner',
      can_edit: true,
      status: 'active',
      display_name_override: null,
      colour: null,
      joined_at: 't',
      created_at: 't',
      updated_at: 't',
    };
    return {
      inviteRepo,
      svc: makeService({
        inviteRepo,
        queries: makeQueries(redeemerMembership as HouseholdMember),
      }),
    };
  }

  it('passes the code, the redeemer and the picked target household to the RPC', async () => {
    const { inviteRepo, svc } = redeemWith({
      outcome: 'redeemed',
      household_id: 'h-target',
      membership: membershipRow,
    });

    await svc.redeemInvite('u-parent', {
      code: 'abc-234',
      target_household_id: 'h-target',
    });

    expect(inviteRepo.redeemDraftHousehold).toHaveBeenCalledWith(
      'ABC-234',
      'u-parent',
      'h-target',
      null
    );
  });

  it('carries the REDEEMER’s week start into an instantiated household (D-8)', async () => {
    // Nothing ever sets `week_starts_on` on a nanny-authored draft, so 094
    // would otherwise copy 075's SQL default of 1 (Monday) into a brand-new
    // live household — an FLSA workweek a US family never chose, locked the
    // moment a timesheet exists. The employer's device decides it, exactly as
    // it does on the parent-authored create path.
    const { inviteRepo, svc } = redeemWith({
      outcome: 'redeemed',
      household_id: 'h-target',
      membership: membershipRow,
    });

    await svc.redeemInvite('u-parent', {
      code: 'ABC-234',
      week_starts_on: 0,
    });

    expect(inviteRepo.redeemDraftHousehold).toHaveBeenCalledWith(
      'ABC-234',
      'u-parent',
      null,
      0
    );
  });

  it('sends null when the parent has no live household to absorb into', async () => {
    const { inviteRepo, svc } = redeemWith({
      outcome: 'redeemed',
      household_id: 'h-target',
      membership: membershipRow,
    });

    await svc.redeemInvite('u-parent', { code: 'ABC-234' });

    expect(inviteRepo.redeemDraftHousehold).toHaveBeenCalledWith(
      'ABC-234',
      'u-parent',
      null,
      null
    );
  });

  it('returns the REDEEMER membership, not the carer row 094 inserted', async () => {
    // 094's `membership` field is the nanny join. Handing that to mobile made
    // CodeEntryScreen resolve SETUP_ROLES.NANNY and route a joining parent to
    // Availability (Phase 6 Maestro B2). The ordinary redeemInvite contract is
    // "the caller's membership" — keep that here.
    const { svc } = redeemWith({
      outcome: 'redeemed',
      household_id: 'h-target',
      membership: membershipRow,
    });

    const result = await svc.redeemInvite('u-parent', { code: 'ABC-234' });

    expect(result).toMatchObject({
      id: 'm-owner',
      user_id: 'u-parent',
      role: 'owner',
    });
  });

  it.each([
    ['invite_unavailable', InviteNotFoundError],
    ['target_not_permitted', InviteNotFoundError],
    ['self_redemption', InviteNotFoundError],
    ['draft_has_no_author', InviteNotFoundError],
  ])('maps %s to the opaque invite 404', async (outcome, expected) => {
    const { svc } = redeemWith({ outcome });
    await expect(
      svc.redeemInvite('u-parent', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(expected);
  });

  it('maps already_member to AlreadyMemberError', async () => {
    const { svc } = redeemWith({
      outcome: 'already_member',
      household_id: 'h-target',
    });
    await expect(
      svc.redeemInvite('u-parent', { code: 'ABC-234' })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
  });

  it('maps proposal_already_open to a 409, not a 404', async () => {
    // Two of her codes redeemed by the same family. The refusal is real and
    // nameable — unlike the four above, nothing is being hidden.
    const { svc } = redeemWith({
      outcome: 'proposal_already_open',
      household_id: 'h-target',
    });
    await expect(
      svc.redeemInvite('u-parent', { code: 'ABC-234' })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('falls through to the shipped parent-authored path when the household is live', async () => {
    // Not a draft: the RPC is never consulted, and today's claim/insert/push
    // sequence runs exactly as it always has.
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () => invite({ household_id: 'h1' })),
    });
    const memberRepo = makeMemberRepo();
    const svc = makeService({
      householdRepo: makeHouseholdRepo(liveHousehold),
      inviteRepo,
      memberRepo,
    });

    await svc.redeemInvite('u-parent', { code: 'ABC-234' });

    expect(inviteRepo.redeemDraftHousehold).not.toHaveBeenCalled();
    expect(inviteRepo.claimPending).toHaveBeenCalled();
    expect(memberRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });
});

describe('redeemInvite — instantiate seeds the draft’s country pack', () => {
  const NEW_HOUSEHOLD_ID = 'h-live-from-draft';

  function instantiateService(
    opts: {
      draftCountry?: string;
      holidays?: {
        seedCountryPack: ReturnType<typeof mock>;
        upsertMany: ReturnType<typeof mock>;
        listForHousehold: ReturnType<typeof mock>;
        deleteKeysNotIn: ReturnType<typeof mock>;
      };
    } = {}
  ) {
    const draft = {
      ...draftHousehold,
      country: opts.draftCountry ?? 'CA',
    };
    const householdRepo = makeHouseholdRepo(draft);
    const holidays = opts.holidays ?? {
      seedCountryPack: mock(async () => []),
      upsertMany: mock(async () => []),
      listForHousehold: mock(async () => []),
      deleteKeysNotIn: mock(async () => undefined),
    };
    const inviteRepo = makeInviteRepo({
      redeemDraftHousehold: mock(async () => ({
        outcome: 'redeemed',
        household_id: NEW_HOUSEHOLD_ID,
        carer_id: NANNY_ID,
        proposal: null,
      })),
    });
    const redeemerMembership = {
      id: 'm-owner',
      household_id: NEW_HOUSEHOLD_ID,
      user_id: 'u-parent',
      role: 'owner',
      can_edit: true,
      status: 'active',
      display_name_override: null,
      colour: null,
      joined_at: 't',
      created_at: 't',
      updated_at: 't',
    };
    const svc = makeService({
      householdRepo,
      inviteRepo,
      holidays,
      queries: makeQueries(redeemerMembership as HouseholdMember),
    });
    return { svc, householdRepo, holidays, inviteRepo };
  }

  it('copies the draft country onto the new household and seeds that pack', async () => {
    const { svc, householdRepo, holidays } = instantiateService({
      draftCountry: 'CA',
    });

    await svc.redeemInvite('u-parent', { code: 'ABC-234' });

    expect(householdRepo.update).toHaveBeenCalledWith(NEW_HOUSEHOLD_ID, {
      country: 'CA',
    });
    expect(holidays.seedCountryPack).toHaveBeenCalledWith(
      NEW_HOUSEHOLD_ID,
      'CA'
    );
  });

  it('does not seed when the redemption absorbs into an existing household', async () => {
    const { svc, householdRepo, holidays } = instantiateService();

    await svc.redeemInvite('u-parent', {
      code: 'ABC-234',
      target_household_id: 'h-already-live',
    });

    expect(householdRepo.update).not.toHaveBeenCalled();
    expect(holidays.seedCountryPack).not.toHaveBeenCalled();
  });

  it('logs a seed failure and still returns the membership', async () => {
    const loggerError = spyOn(logger, 'error').mockImplementation(() => logger);
    const { svc } = instantiateService({
      holidays: {
        seedCountryPack: mock(async () => {
          throw new Error('seed exploded');
        }),
        upsertMany: mock(async () => []),
        listForHousehold: mock(async () => []),
        deleteKeysNotIn: mock(async () => undefined),
      },
    });

    const result = await svc.redeemInvite('u-parent', { code: 'ABC-234' });

    expect(result).toMatchObject({ id: 'm-owner' });
    expect(loggerError).toHaveBeenCalled();
    loggerError.mockRestore();
  });
});

describe('declining a candidate', () => {
  // The parent read her terms and said no. Her row has to have somewhere to
  // go: `activateCandidate` CASes on 'candidate' and `reactivateMembership` on
  // 'removed', so without the widened removal CAS the candidate window had no
  // exit and she would sit pending in his household forever.
  it('removes a candidate through the ordinary member removal', async () => {
    const candidate = draftAuthorMembership({
      id: 'm-candidate',
      household_id: 'h1',
      user_id: 'u-nanny',
      status: 'candidate',
    });
    const memberRepo = makeMemberRepo({
      findById: mock(async () => candidate),
      removeMembership: mock(async (id: string) => ({
        ...candidate,
        id,
        status: 'removed',
      })),
    });
    const svc = makeService({
      householdRepo: makeHouseholdRepo(liveHousehold),
      memberRepo,
      queries: makeQueries(
        draftAuthorMembership({
          id: 'm-parent',
          household_id: 'h1',
          user_id: 'u-parent',
          role: 'owner',
        })
      ),
    });

    const result = await svc.removeMember('u-parent', 'h1', 'm-candidate');

    expect(result.status).toBe('removed');
    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-candidate');
  });
});

/**
 * A membership fake that knows what each lookup MEANS — the three do not
 * answer alike, so a test can tell a correct method choice from a wrong one.
 *
 * A stub that returns the same row from every lookup cannot: it passes
 * whichever sibling the source happens to call, which makes the D-49 narrowing
 * invisible to the suite that most needs to see it.
 */
function makeSemanticMemberRepo(row: HouseholdMember | null): any {
  const ifStatus = (...statuses: string[]) =>
    mock(async () => (row && statuses.includes(row.status) ? row : null));
  return makeMemberRepo({
    findActiveMembership: ifStatus('active'),
    findMembershipAnyStatus: ifStatus('active', 'removed'),
    findMembershipIncludingCandidate: ifStatus(
      'active',
      'removed',
      'candidate'
    ),
  });
}

describe('redeemInvite reads membership with the lookup that can SEE a candidate', () => {
  const candidate = draftAuthorMembership({
    id: 'm-candidate',
    household_id: 'h1',
    status: 'candidate',
  });

  function liveInviteService(memberRepo: any, inviteRepo = makeInviteRepo()) {
    return makeService({
      householdRepo: makeHouseholdRepo(liveHousehold),
      inviteRepo,
      memberRepo,
    });
  }

  it('uses findMembershipIncludingCandidate, never the money-read sibling', async () => {
    // The negative assertion is the point. `findMembershipAnyStatus` excludes a
    // candidate, so redeeming past her row would burn the single-use code and
    // then die on the unique (household_id, user_id) index.
    const memberRepo = makeSemanticMemberRepo(candidate);
    await liveInviteService(memberRepo)
      .redeemInvite('u-nanny', { code: 'ABC-234' })
      .catch(() => undefined);

    expect(memberRepo.findMembershipIncludingCandidate).toHaveBeenCalled();
    expect(memberRepo.findMembershipAnyStatus).not.toHaveBeenCalled();
  });

  it('refuses to heal a stranded claim whose claimer is a CANDIDATE', async () => {
    // The self-heal releases a claim only when the claimer has NO row at all.
    // A candidate row means the redeem DID land, so healing here would put a
    // consumed code back in play against a membership that already exists.
    const inviteRepo = makeInviteRepo({
      findByCode: mock(async () =>
        invite({
          household_id: 'h1',
          status: 'accepted',
          accepted_by: 'u-nanny',
          accepted_at: new Date(Date.now() - 60 * 60_000).toISOString(),
        })
      ),
    });
    const memberRepo = makeSemanticMemberRepo(candidate);

    await expect(
      liveInviteService(memberRepo, inviteRepo).redeemInvite('u-parent', {
        code: 'ABC-234',
      })
    ).rejects.toThrow(/already/i);
    expect(inviteRepo.releaseClaim).not.toHaveBeenCalled();
  });
});

/**
 * A6 — a nanny's draft is auto-archived the moment she joins a live family.
 *
 * Why the service and not 094: the RPC is applied to production and stays
 * frozen, and its header records that it deliberately leaves the draft
 * standing. That permanent zombie is the root cause of the shell-swap trap
 * (§0), so the retirement happens on this side of the boundary — best-effort,
 * because a redemption that already committed must never be undone over it.
 */
describe('A6 — auto-archiving the draft on redemption', () => {
  function draftRedemptionService(
    memberRepoOverrides: Record<string, unknown> = {}
  ) {
    const memberRepo = makeMemberRepo({
      // The author's own row in her own draft — the one that gets retired.
      findActiveMembership: mock(async () => draftAuthorMembership()),
      ...memberRepoOverrides,
    });
    const inviteRepo = makeInviteRepo({
      redeemDraftHousehold: mock(async () => ({
        outcome: 'redeemed',
        household_id: 'h-target',
        carer_id: NANNY_ID,
        proposal: null,
      })),
    });
    const svc = makeService({
      inviteRepo,
      memberRepo,
      queries: makeQueries(
        draftAuthorMembership({
          id: 'm-owner',
          household_id: 'h-target',
          user_id: 'u-parent',
          role: 'owner',
        })
      ),
    });
    return { svc, memberRepo, inviteRepo };
  }

  it('retires the AUTHOR’s draft membership, not the redeemer’s', async () => {
    const { svc, memberRepo } = draftRedemptionService();

    await svc.redeemInvite('u-parent', { code: 'ABC-234' });

    expect(memberRepo.findActiveMembership).toHaveBeenCalledWith(
      'h-draft',
      NANNY_ID
    );
    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-draft');
  });

  it('logs an archive failure and lets the redemption stand', async () => {
    // The join has already committed inside 094. A throw here would strand a
    // real nanny outside a household she legitimately joined, over a tidy-up.
    const loggerError = spyOn(logger, 'error').mockImplementation(() => logger);
    const { svc } = draftRedemptionService({
      removeMembership: mock(async () => {
        throw new Error('boom');
      }),
    });

    const result = await svc.redeemInvite('u-parent', { code: 'ABC-234' });

    expect(result).toMatchObject({ id: 'm-owner' });
    expect(loggerError).toHaveBeenCalled();
    loggerError.mockRestore();
  });
});

describe('A6 — the other direction: she joins a family the ordinary way', () => {
  // Her code was never redeemed; the family invited her instead. The draft is
  // just as dead, and just as much a zombie in her switcher.
  function ordinaryJoinService(household: Household) {
    const memberRepo = makeMemberRepo({
      listActiveByUser: mock(async () => [draftAuthorMembership()]),
      findActiveMembership: mock(async () => draftAuthorMembership()),
    });
    const svc = makeService({
      householdRepo: makeHouseholdRepo(household),
      inviteRepo: makeInviteRepo({
        // A parent-authored, LIVE household invite — the ordinary path. The
        // household read for the DRAFT sweep is `findByIds`, which the repo
        // fake answers with this same fixture.
        findByCode: mock(async () =>
          invite({ household_id: 'h1', role: 'nanny' })
        ),
      }),
      memberRepo,
    });
    return { svc, memberRepo };
  }

  it('archives the drafts SHE authored when she redeems a nanny invite', async () => {
    const { svc, memberRepo } = ordinaryJoinService(draftHousehold);

    await svc.redeemInvite(NANNY_ID, { code: 'ABC-234' });

    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-draft');
  });

  it('leaves someone else’s draft alone', async () => {
    // `created_by` is checked as well as `state`: a second nanny sitting in a
    // draft must never archive it out from under its author.
    const { svc, memberRepo } = ordinaryJoinService({
      ...draftHousehold,
      created_by: 'u-someone-else',
    });

    await svc.redeemInvite(NANNY_ID, { code: 'ABC-234' });

    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });
});
