/**
 * invite_redeemed push when someone joins via invite code.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { HouseholdInvite } from '../../../../../src/domains/household/types';

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
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

let HouseholdCommandService: typeof import('../../../../../src/domains/household/services/householdCommandService').HouseholdCommandService;
let notifyHouseholdParents: ReturnType<typeof mock>;
let notifyUser: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  notifyUser = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents,
    notifyUser,
  }));

  ({ HouseholdCommandService } = await import(
    '../../../../../src/domains/household/services/householdCommandService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
  notifyUser.mockClear();
});

function makeMemberRepo(overrides: Record<string, unknown> = {}) {
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
    reactivateMembership: mock(async (id: string, role: string) => ({
      id,
      role,
      household_id: 'h1',
      user_id: 'u2',
      can_edit: false,
      status: 'active',
    })),
    removeMembership: mock(async (id: string) => ({
      id,
      role: 'nanny',
      household_id: 'h1',
      user_id: 'u2',
      can_edit: false,
      status: 'removed',
    })),
    ...overrides,
  };
}

function makeInviteRepo(overrides: Record<string, unknown> = {}) {
  return {
    findByCode: mock(async () => pendingInvite()),
    claimPending: mock(async (id: string, acceptedBy: string) =>
      pendingInvite({ id, status: 'accepted', accepted_by: acceptedBy })
    ),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...pendingInvite(),
      id,
      ...data,
    })),
    ...overrides,
  };
}

/** A rejoiner's still-live PTO for the current year: 20h granted, 5h used. */
function makePtoRepo(rows: Record<string, unknown>[] = []) {
  return { listForCarerYear: mock(async () => rows) };
}

function makeHouseholdRepo() {
  return {
    create: mock(),
    update: mock(),
    delete: mock(),
    // `state` matters from 3-O: `redeemInvite` reads the invite's household to
    // decide whether this is a nanny-authored draft (094's path) or the
    // parent-authored one these tests pin. 'live' keeps them on the latter.
    findById: mock(async () => ({
      id: 'h1',
      timezone: 'Europe/London',
      state: 'live',
    })),
  };
}

describe('HouseholdCommandService.redeemInvite — invite_redeemed', () => {
  it('notifies household parents with the redeemed role in the body', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo() as never,
      makeInviteRepo({
        findByCode: mock(async () => pendingInvite({ role: 'parent' })),
      }) as never,
      { getMembership: mock() } as never,
      { ensureProfile: mock(async () => {}) } as never
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: expect.stringContaining('parent'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId: 'h1',
        },
      })
    );
  });

  it('names nanny and helper roles in the body', async () => {
    for (const role of ['nanny', 'helper'] as const) {
      notifyHouseholdParents.mockClear();
      const svc = new HouseholdCommandService(
        makeHouseholdRepo() as never,
        makeMemberRepo() as never,
        makeInviteRepo({
          findByCode: mock(async () => pendingInvite({ role })),
        }) as never,
        { getMembership: mock() } as never,
        { ensureProfile: mock(async () => {}) } as never
      );

      await svc.redeemInvite('u2', { code: 'ABC-234' });

      expect(notifyHouseholdParents).toHaveBeenCalledWith(
        'h1',
        expect.objectContaining({
          body: expect.stringContaining(role),
          data: expect.objectContaining({
            type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          }),
        })
      );
    }
  });

  it('notifies parents when a REMOVED member rejoins, not just on a first-time join', async () => {
    // Reactivation is a join as far as the household is concerned: the parents
    // who did not send the invite still need to know someone regained access.
    const svc = new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo({
        findMembershipIncludingCandidate: mock(async () => ({
          id: 'm-old',
          household_id: 'h1',
          user_id: 'u2',
          role: 'nanny',
          status: 'removed',
        })),
      }) as never,
      makeInviteRepo() as never,
      { getMembership: mock() } as never,
      { ensureProfile: mock(async () => {}) } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      // The rejoin push appends the carried-over PTO sentence, so this arm
      // reaches the ledger. Left defaulted it constructs a real repository and
      // the test dies on a network timeout rather than an assertion.
      makePtoRepo() as never
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        // Distinct wording, same push type: "rejoined", not "a new nanny".
        title: expect.stringContaining('rejoined'),
        body: expect.stringContaining('nanny rejoined'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId: 'h1',
        },
      })
    );
  });

  it('push failure does not fail the redeem', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('expo down');
    });
    const svc = new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo() as never,
      makeInviteRepo() as never,
      { getMembership: mock() } as never,
      { ensureProfile: mock(async () => {}) } as never
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).resolves.toMatchObject({ role: 'nanny' });
  });
});

describe('HouseholdCommandService.redeemInvite — carried-over PTO in the rejoin push', () => {
  const removedMember = {
    id: 'm-old',
    household_id: 'h1',
    user_id: 'u2',
    role: 'nanny',
    status: 'removed',
  };

  function svcWith(ptoRepo: any) {
    return new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo({
        findMembershipIncludingCandidate: mock(async () => removedMember),
      }) as never,
      makeInviteRepo() as never,
      { getMembership: mock() } as never,
      { ensureProfile: mock(async () => {}) } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      ptoRepo as never
    );
  }

  it('names the leftover PTO balance so a parent can correct it', async () => {
    // The balance survives the removal (owner decision: keep, do not forfeit),
    // so the parents who see the rejoin are the people who can adjust it — a
    // PTO correction already exists as a feature.
    const svc = svcWith(
      makePtoRepo([
        { kind: 'accrual', minutes: 1200, effective_date: '2026-01-01' },
        { kind: 'usage', minutes: -300, effective_date: '2026-04-02' },
      ])
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: expect.stringContaining('15 hours'),
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
        }),
      })
    );
  });

  it('says nothing about PTO when there is no balance to carry', async () => {
    // A rejoin in a new calendar year, or a carer nobody ever read a balance
    // for: "0 hours carried over" is noise, not information.
    const svc = svcWith(makePtoRepo([]));

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    const [, payload] = notifyHouseholdParents.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(payload.body).not.toContain('carried over');
  });

  it('still completes the rejoin when the PTO lookup fails', async () => {
    // A push detail must never cost the carer their household access.
    const svc = svcWith({
      listForCarerYear: mock(async () => {
        throw new Error('pto down');
      }),
    });

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).resolves.toMatchObject({ status: 'active' });
  });
});

/**
 * A self-service leave is the one membership change no parent initiates, so
 * without a push the household finds out when a shift goes uncovered. Same
 * fan-out and the same household-membership push type the redeem path uses
 * (both land the parent on the household settings screen); only the wording
 * separates "joined" from "left".
 */
describe('HouseholdCommandService.leave — parents are told', () => {
  // An earlier test in this file leaves a throwing implementation behind
  // (beforeEach only clears calls), so restore the no-op explicitly.
  beforeEach(() => {
    notifyHouseholdParents.mockImplementation(() => undefined);
  });

  function leaveSvc(role: string) {
    return new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo() as never,
      makeInviteRepo() as never,
      {
        getMembership: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'u2',
          role,
          can_edit: false,
          status: 'active',
        })),
      } as never,
      { ensureProfile: mock(async () => {}) } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      makePtoRepo() as never
    );
  }

  it('notifies the household parents that the member LEFT, carrying the householdId', async () => {
    const svc = leaveSvc('nanny');

    await svc.leave('u2', 'h1');

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        title: expect.stringContaining('left'),
        body: expect.stringContaining('left'),
        data: expect.objectContaining({ householdId: 'h1' }),
      })
    );
  });

  it('names the leaving role in the body, so a parent knows whose cover just vanished', async () => {
    for (const role of ['nanny', 'parent', 'helper']) {
      notifyHouseholdParents.mockClear();
      await leaveSvc(role).leave('u2', 'h1');

      expect(notifyHouseholdParents).toHaveBeenCalledWith(
        'h1',
        expect.objectContaining({ body: expect.stringContaining(role) })
      );
    }
  });

  it('push failure never fails the leave — the row is already flipped', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('expo down');
    });

    await expect(leaveSvc('nanny').leave('u2', 'h1')).resolves.toMatchObject({
      status: 'removed',
    });
  });
});

/**
 * §13 — `invite_redeemed` is WIDENED to audience `both`, not split into a
 * second type. One fact, one type, two arms of copy.
 */
describe('HouseholdCommandService.redeemInvite — the draft carer arm', () => {
  const draftInviteRepo = () =>
    makeInviteRepo({
      redeemDraftHousehold: mock(async () => ({
        outcome: 'redeemed',
        instantiated: true,
        household_id: 'h-target',
        draft_household_id: 'h-draft',
        carer_id: 'u-nanny',
        membership: {
          id: 'm-joined',
          household_id: 'h-target',
          user_id: 'u-nanny',
          role: 'nanny',
          can_edit: false,
          status: 'active',
        },
        proposal: { id: 'p1' },
      })),
    });

  function draftSvc() {
    return new HouseholdCommandService(
      {
        create: mock(),
        update: mock(),
        delete: mock(),
        findById: mock(async () => ({
          id: 'h-draft',
          timezone: 'America/Chicago',
          name: 'The Ahmeds',
          state: 'draft',
        })),
      } as never,
      makeMemberRepo() as never,
      draftInviteRepo() as never,
      {
        getMembership: mock(async () => ({
          id: 'm-owner',
          household_id: 'h-target',
          user_id: 'u-parent',
          role: 'owner',
          can_edit: true,
          status: 'active',
        })),
      } as never,
      { ensureProfile: mock(async () => {}) } as never
    );
  }

  it('tells the CARER her code was used, with the proposal to route to', async () => {
    await draftSvc().redeemInvite('u-parent', { code: 'ABC-234' });

    expect(notifyUser).toHaveBeenCalledWith(
      'u-nanny',
      expect.objectContaining({
        body: expect.stringContaining('Your terms are with them to review'),
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId: 'h-target',
          proposalId: 'p1',
        }),
      })
    );
  });

  it('carries no figure in the carer body — a lock screen is a public surface (A8)', async () => {
    await draftSvc().redeemInvite('u-parent', { code: 'ABC-234' });

    const body = String((notifyUser.mock.calls[0] as any[])[1].body);
    expect(body).not.toMatch(/[0-9]/);
  });

  it('still fires the parent arm, excluding the parent who just tapped', async () => {
    await draftSvc().redeemInvite('u-parent', { code: 'ABC-234' });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h-target',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
        }),
      }),
      { excludeUserId: 'u-parent' }
    );
  });
});
