/**
 * One LIVE household per parent (§8 / A4), enforced in the service rather than
 * in a dialog.
 *
 * The failure this closes is not exotic — it is the likeliest real path. A
 * co-parent already set up with his own family types the code his partner
 * sent, and the app silently gives him a SECOND parent membership and switches
 * him to it: the household he abandons still holds a nanny's schedule, her
 * hours and her pay history, and nothing tells anyone. `redeemInvite` checked
 * membership of the INVITED household only, so it never had a reason to look.
 *
 * Kept in its own file for the same reason `.draft`/`.pushes`/`.holidaySeed`
 * are: `householdCommandService.test.ts` pins the shipped flows, and nothing
 * here may move an assertion over there.
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  InviteExpiredError,
  ParentAlreadyHasHouseholdError,
} from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdCommandService } from '../../../../../src/domains/household/services/householdCommandService';
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
} from '../../../../../src/domains/household/types';

const PARENT_ID = 'u-parent';
/** The family he already speaks for — the one a second join would abandon. */
const EXISTING_ID = 'h-existing';
/** The family whose code he just typed. */
const INVITED_ID = 'h-invited';

const liveHousehold: Household = {
  id: EXISTING_ID,
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
  created_by: PARENT_ID,
  created_at: 't',
  updated_at: 't',
};

const draftHousehold: Household = {
  ...liveHousehold,
  id: 'h-draft',
  name: null,
  state: 'draft',
  created_by: 'u-nanny',
};

function membership(overrides: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    id: 'm-existing',
    household_id: EXISTING_ID,
    user_id: PARENT_ID,
    role: 'owner',
    can_edit: true,
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
    household_id: INVITED_ID,
    code: 'ABC-234',
    email: null,
    role: 'parent',
    invited_by: 'u-other-parent',
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

/**
 * A shared call log, so "archived BEFORE the claim" can be asserted as an
 * ORDER rather than as two independent "was called" facts. The order is the
 * whole decision (see `redeemInvite`'s header): a code that was going to fail
 * must never cost a parent his household.
 */
function makeOrderLog(): string[] {
  return [];
}

function makeHouseholdRepo(
  order: string[],
  overrides: Record<string, unknown> = {}
): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...liveHousehold,
      ...data,
      id: 'h-new',
    })),
    update: mock(async () => liveHousehold),
    delete: mock(async () => {}),
    findById: mock(async () => liveHousehold),
    findByIds: mock(async () => []),
    // Every id handed in is live unless a test says otherwise.
    listLiveIds: mock(async (ids: string[]) => {
      order.push('listLiveIds');
      return ids;
    }),
    listActiveChildFirstNames: mock(async () => []),
    ...overrides,
  };
}

function makeMemberRepo(
  order: string[],
  overrides: Record<string, unknown> = {}
): any {
  return {
    createMembership: mock(async (data: Record<string, unknown>) => {
      order.push('createMembership');
      return {
        id: 'm-new',
        joined_at: 't',
        created_at: 't',
        updated_at: 't',
        display_name_override: null,
        colour: null,
        ...data,
      };
    }),
    findActiveMembership: mock(async () => null),
    findMembershipAnyStatus: mock(async () => null),
    findMembershipIncludingCandidate: mock(async () => null),
    findById: mock(async () => null),
    listActiveByUser: mock(async () => []),
    listActiveByHousehold: mock(async () => []),
    removeMembership: mock(async (id: string) => {
      order.push('removeMembership');
      return { ...membership(), id, status: 'removed' };
    }),
    reactivateMembership: mock(async () => null),
    activateCandidate: mock(async () => null),
    ...overrides,
  };
}

function makeInviteRepo(
  order: string[],
  overrides: Record<string, unknown> = {}
): any {
  return {
    findByCode: mock(async () => invite()),
    findById: mock(async () => invite()),
    revokePending: mock(async () => invite({ status: 'revoked' })),
    create: mock(async () => invite()),
    claimPending: mock(async (id: string) => {
      order.push('claimPending');
      return invite({ id, status: 'accepted' });
    }),
    releaseClaim: mock(async () => {}),
    redeemDraftHousehold: mock(async () => ({
      outcome: 'not_a_draft_invite',
    })),
    ...overrides,
  };
}

const stubUsers: any = {
  ensureProfile: mock(async () => {}),
  getProfileById: mock(async () => null),
};
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

/** The whole ctor, so a positional argument is never miscounted below. */
function makeService(parts: {
  householdRepo?: any;
  memberRepo?: any;
  inviteRepo?: any;
  queries?: any;
  order?: string[];
}): HouseholdCommandService {
  const order = parts.order ?? makeOrderLog();
  return new HouseholdCommandService(
    parts.householdRepo ?? makeHouseholdRepo(order),
    parts.memberRepo ?? makeMemberRepo(order),
    parts.inviteRepo ?? makeInviteRepo(order),
    parts.queries ?? { getMembership: mock(async () => membership()) },
    stubUsers,
    stubTimeEntries,
    stubPayArrangements,
    stubPtoLedger,
    stubTimesheets,
    stubHolidays
  );
}

describe('create — one live household per parent', () => {
  it('refuses a second live household for an owner, naming the one he has', async () => {
    const order = makeOrderLog();
    const householdRepo = makeHouseholdRepo(order);
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const svc = makeService({ householdRepo, memberRepo, order });

    await expect(
      svc.create(PARENT_ID, { name: 'The Wilsons' })
    ).rejects.toMatchObject({
      statusCode: 409,
      metadata: {
        reason: 'PARENT_ALREADY_HAS_HOUSEHOLD',
        existingHouseholdId: EXISTING_ID,
      },
    });
    // Refused BEFORE anything is written — a half-created household is worse
    // than a refusal.
    expect(householdRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a co-parent too, not just the owner', async () => {
    const order = makeOrderLog();
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership({ role: 'parent' })]),
    });
    const svc = makeService({ memberRepo, order });

    await expect(
      svc.create(PARENT_ID, { name: 'The Wilsons' })
    ).rejects.toThrow(ParentAlreadyHasHouseholdError);
  });

  it('lets a user whose only membership is a nanny one create a household', async () => {
    // She works for the Ahmeds and is now setting up her own family. Belonging
    // to a household as a CARER says nothing about speaking for one.
    const order = makeOrderLog();
    const householdRepo = makeHouseholdRepo(order);
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership({ role: 'nanny' })]),
    });
    const svc = makeService({ householdRepo, memberRepo, order });

    await svc.create('u-nanny', { name: 'Her own family' });

    expect(householdRepo.create).toHaveBeenCalled();
    // The state read never happens: no parent membership, nothing to filter.
    expect(householdRepo.listLiveIds).not.toHaveBeenCalled();
  });

  it('lets the first live household through', async () => {
    const order = makeOrderLog();
    const householdRepo = makeHouseholdRepo(order);
    const svc = makeService({ householdRepo, order });

    await svc.create(PARENT_ID, { name: 'The Wilsons' });

    expect(householdRepo.create).toHaveBeenCalled();
  });

  it('never guards a DRAFT — a draft is nanny-authored and has no parent', async () => {
    const order = makeOrderLog();
    const householdRepo = makeHouseholdRepo(order);
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const svc = makeService({ householdRepo, memberRepo, order });

    await svc.create('u-nanny', { state: 'draft' });

    expect(householdRepo.create).toHaveBeenCalled();
    expect(memberRepo.listActiveByUser).not.toHaveBeenCalled();
  });
});

describe('redeemInvite — a parent-role code', () => {
  it('refuses when the redeemer already speaks for a live family', async () => {
    const order = makeOrderLog();
    const inviteRepo = makeInviteRepo(order);
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const svc = makeService({ inviteRepo, memberRepo, order });

    await expect(
      svc.redeemInvite(PARENT_ID, { code: 'ABC-234' })
    ).rejects.toMatchObject({
      statusCode: 409,
      metadata: { existingHouseholdId: EXISTING_ID },
    });
    // The refusal must not burn the code: he is going to be offered the escape
    // hatch and may well come back and type it again.
    expect(inviteRepo.claimPending).not.toHaveBeenCalled();
  });

  it('does NOT guard a nanny-role code — a nanny works for several families', async () => {
    const order = makeOrderLog();
    const inviteRepo = makeInviteRepo(order, {
      findByCode: mock(async () => invite({ role: 'nanny' })),
    });
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership({ role: 'nanny' })]),
    });
    const svc = makeService({ inviteRepo, memberRepo, order });

    await svc.redeemInvite('u-nanny', { code: 'ABC-234' });

    expect(inviteRepo.claimPending).toHaveBeenCalled();
  });

  it('does NOT guard a helper-role code', async () => {
    const order = makeOrderLog();
    const inviteRepo = makeInviteRepo(order, {
      findByCode: mock(async () => invite({ role: 'helper' })),
    });
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const svc = makeService({ inviteRepo, memberRepo, order });

    await svc.redeemInvite(PARENT_ID, { code: 'ABC-234' });

    expect(inviteRepo.claimPending).toHaveBeenCalled();
  });
});

describe('redeemInvite — archive_household_id, the A4 consent token', () => {
  it('archives the old household BEFORE claiming the code, then joins', async () => {
    const order = makeOrderLog();
    const inviteRepo = makeInviteRepo(order);
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const svc = makeService({ inviteRepo, memberRepo, order });

    await svc.redeemInvite(PARENT_ID, {
      code: 'ABC-234',
      archive_household_id: EXISTING_ID,
    });

    // The ORDER is the assertion. Claiming first and archiving second would
    // leave a parent in two households whenever the archive throws.
    expect(order.indexOf('removeMembership')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('removeMembership')).toBeLessThan(
      order.indexOf('claimPending')
    );
    expect(order.indexOf('claimPending')).toBeLessThan(
      order.indexOf('createMembership')
    );
    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-existing');
  });

  it('refuses an archive_household_id that is not the caller’s own live household', async () => {
    const order = makeOrderLog();
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const svc = makeService({ memberRepo, order });

    await expect(
      svc.redeemInvite(PARENT_ID, {
        code: 'ABC-234',
        archive_household_id: 'h-somebody-elses',
      })
    ).rejects.toThrow(ParentAlreadyHasHouseholdError);
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('refuses to archive when the household still has a carer', async () => {
    // A4: the destructive option is hidden when a carer is attached. Hidden is
    // not enforced — this is.
    const order = makeOrderLog();
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
      listActiveByHousehold: mock(async () => [
        membership(),
        membership({ id: 'm-nanny', user_id: 'u-nanny', role: 'nanny' }),
      ]),
    });
    const svc = makeService({ memberRepo, order });

    await expect(
      svc.redeemInvite(PARENT_ID, {
        code: 'ABC-234',
        archive_household_id: EXISTING_ID,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      metadata: { reason: 'HOUSEHOLD_HAS_CARER' },
    });
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('validates the code BEFORE archiving anything', async () => {
    // An expired code was never going to work. Archiving on it would cost a
    // parent his family for nothing.
    const order = makeOrderLog();
    const inviteRepo = makeInviteRepo(order, {
      findByCode: mock(async () =>
        invite({ expires_at: '2020-01-01T00:00:00Z' })
      ),
    });
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const svc = makeService({ inviteRepo, memberRepo, order });

    await expect(
      svc.redeemInvite(PARENT_ID, {
        code: 'ABC-234',
        archive_household_id: EXISTING_ID,
      })
    ).rejects.toThrow(InviteExpiredError);
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });
});

describe('redeemDraftInvite — the nanny-code path', () => {
  function draftService(order: string[], memberRepo: any) {
    const inviteRepo = makeInviteRepo(order, {
      findByCode: mock(async () =>
        invite({ household_id: 'h-draft', role: 'nanny' })
      ),
      redeemDraftHousehold: mock(async () => ({
        outcome: 'redeemed',
        household_id: 'h-new-family',
        carer_id: 'u-nanny',
        proposal: null,
      })),
    });
    return {
      inviteRepo,
      svc: makeService({
        householdRepo: makeHouseholdRepo(order, {
          findById: mock(async () => draftHousehold),
        }),
        inviteRepo,
        memberRepo,
        order,
      }),
    };
  }

  it('refuses to INSTANTIATE a second family for a parent who already has one', async () => {
    // No `target_household_id` means "make me a household out of her draft" —
    // a second live one, reached by the back door.
    const order = makeOrderLog();
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const { inviteRepo, svc } = draftService(order, memberRepo);

    await expect(
      svc.redeemInvite(PARENT_ID, { code: 'ABC-234' })
    ).rejects.toThrow(ParentAlreadyHasHouseholdError);
    expect(inviteRepo.redeemDraftHousehold).not.toHaveBeenCalled();
  });

  it('allows an ABSORB — a target household is the existing one, not a second', async () => {
    const order = makeOrderLog();
    const memberRepo = makeMemberRepo(order, {
      listActiveByUser: mock(async () => [membership()]),
    });
    const { inviteRepo, svc } = draftService(order, memberRepo);

    await svc.redeemInvite(PARENT_ID, {
      code: 'ABC-234',
      target_household_id: EXISTING_ID,
    });

    expect(inviteRepo.redeemDraftHousehold).toHaveBeenCalled();
  });
});
