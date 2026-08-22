/**
 * invite_redeemed push when someone joins via invite code.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { HouseholdInvite } from '../../../../../src/domains/household/types';
import { OpenTermsProposalExistsError } from '../../../../../src/domains/termsProposal/errors/termsProposalErrors';

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
    // §8's one-live-household guard and A6's draft auto-archive both read
    // this. Empty: these fixtures are about pushes.
    listActiveByUser: mock(async () => []),
    reactivateMembership: mock(async (id: string, role: string) => ({
      id,
      role,
      household_id: 'h1',
      user_id: 'u2',
      can_edit: false,
      status: 'active',
    })),
    // 110: `removeMember` stamps `ended_reason` through the generic update
    // right after the CAS flip.
    update: mock(async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
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
    updatePayOfferPromotion: mock(async () => {}),
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
    findByIds: mock(async () => []),
    listLiveIds: mock(async () => []),
  };
}

describe('HouseholdCommandService.redeemInvite — invite_redeemed', () => {
  it('names the person who joined, not "someone"', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo() as never,
      makeInviteRepo() as never,
      { getMembership: mock() } as never,
      {
        ensureProfile: mock(async () => {}),
        getProfileById: mock(async () => ({ name: '  Priya  ' })),
      } as never
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ title: 'Priya joined your household' })
    );
  });

  it('falls back to the role when the profile has no name yet', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo() as never,
      makeInviteRepo() as never,
      { getMembership: mock() } as never,
      {
        ensureProfile: mock(async () => {}),
        getProfileById: mock(async () => ({ name: '   ' })),
      } as never
    );

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ title: 'A nanny joined your household' })
    );
  });

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
        // `role: 'parent'` — without it `notificationRouteMap.ts`'s
        // INVITE_REDEEMED resolver has nothing to branch its parent arm on
        // (it defaults to the parent destination only by falling through a
        // `!== 'carer'` check, which a MISSING role satisfies by accident,
        // not by design — pinned explicitly so that stays true on purpose).
        data: {
          type: PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED,
          householdId: 'h1',
          role: 'parent',
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
          role: 'parent',
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

  function leaveSvc(
    role: string,
    opts: { displayName?: string | null; profileName?: string | null } = {}
  ) {
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
          display_name_override: opts.displayName ?? null,
        })),
      } as never,
      {
        ensureProfile: mock(async () => {}),
        // `undefined` means "no stub asked for": resolve to a profile with no
        // name so the chain falls through to the role label, which is the
        // ordinary case for a member who never set one.
        getProfileById: mock(async () => ({
          name: opts.profileName ?? null,
        })),
      } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      makePtoRepo() as never,
      { existsForHousehold: mock(async () => false) } as never,
      { seedCountryPack: mock(async () => []) } as never,
      // F8: `leave` now calls `withdrawOpenForCarer` for a NANNY. Left
      // defaulted this constructs a REAL TermsProposalRepository and the test
      // dies on a network call rather than an assertion — same hazard the PTO
      // repo comment above already documents for this file.
      { withdrawOpenForCarer: mock(async () => null) } as never,
      undefined,
      // Same hazard again, for the pattern teardown `leave` now runs: the real
      // default lazily imports the live schedule service and reaches supabase.
      { endAcceptedPatternsForCarer: mock(async () => []) } as never,
      mock(() => undefined) as never
    );
  }

  it('notifies the household parents that the member LEFT, carrying the householdId', async () => {
    const svc = leaveSvc('nanny');

    await svc.leave('u2', 'h1');

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        title: expect.stringContaining('left'),
        // The body says what it COSTS them, not that it happened — the title
        // already carries the event and the name.
        body: expect.any(String),
        data: expect.objectContaining({ householdId: 'h1', role: 'parent' }),
      })
    );
  });

  // `docs/design/02-VOICE.md`'s first rule: name people. "A nanny left the
  // household" is the wrong answer to the only question a two-carer family
  // has, and it was what this push said.
  it('names the person in the title, preferring the household display override', async () => {
    await leaveSvc('nanny', {
      displayName: 'Priya',
      profileName: 'Priyanka Rao',
    }).leave('u2', 'h1');

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ title: 'Priya left your household' })
    );
  });

  it('falls back to the profile name when the household set no override', async () => {
    await leaveSvc('nanny', { profileName: 'Priyanka Rao' }).leave('u2', 'h1');

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ title: 'Priyanka Rao left your household' })
    );
  });

  // A name is decoration on a push; nothing decorative may cost a membership
  // write. The role label is the floor, never an exception.
  it('falls back to the role when there is no name anywhere', async () => {
    await leaveSvc('helper').leave('u2', 'h1');

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ title: 'A helper left your household' })
    );
  });

  it('survives a profile lookup that throws, and still sends the push', async () => {
    const svc = new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo() as never,
      makeInviteRepo() as never,
      {
        getMembership: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'u2',
          role: 'nanny',
          can_edit: false,
          status: 'active',
          display_name_override: null,
        })),
      } as never,
      {
        ensureProfile: mock(async () => {}),
        getProfileById: mock(async () => {
          throw new Error('profiles down');
        }),
      } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      makePtoRepo() as never,
      { existsForHousehold: mock(async () => false) } as never,
      { seedCountryPack: mock(async () => []) } as never,
      { withdrawOpenForCarer: mock(async () => null) } as never,
      undefined,
      { endAcceptedPatternsForCarer: mock(async () => []) } as never,
      mock(() => undefined) as never
    );

    await expect(svc.leave('u2', 'h1')).resolves.toMatchObject({
      status: 'removed',
    });
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ title: 'A nanny left your household' })
    );
  });

  // What the departure MEANS differs by what they did here: a carer leaving is
  // a hole in the week, a co-parent or helper leaving is a loss of access.
  it('says what the departure costs the family, keyed on the role', async () => {
    await leaveSvc('nanny').leave('u2', 'h1');
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: 'Nothing further is scheduled for them.',
      })
    );

    notifyHouseholdParents.mockClear();
    await leaveSvc('parent').leave('u2', 'h1');
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: 'They no longer have access to your household.',
      })
    );
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
          country: 'US',
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
      { ensureProfile: mock(async () => {}) } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      makePtoRepo() as never,
      { existsForHousehold: mock(async () => false) } as never,
      {
        seedCountryPack: mock(async () => []),
        deleteKeysNotIn: mock(async () => undefined),
      } as never
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
          // Without this, `notificationRouteMap.ts`'s carer arm
          // (`data.role === 'carer'`) is unreachable — the push lands her on
          // parent-facing household settings instead of the proposal she is
          // waiting on.
          role: 'carer',
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
          role: 'parent',
        }),
      }),
      { excludeUserId: 'u-parent' }
    );
  });
});

/**
 * F3 — the inviting parent is told when her pay offer did NOT become a
 * proposal, but only on the two outcomes she can act on: `failed` (transient,
 * try again) and `skipped_stale` (her date drifted, write a new one).
 * `skipped_no_inviter` has nobody to push, and `skipped_open_round` is not
 * news — she is already mid-negotiation with the carer.
 */
describe('HouseholdCommandService.redeemInvite — pay-offer-not-promoted push (F3)', () => {
  const offer = {
    rate_minor: 2800,
    overtime_multiplier: 1.5,
    valid_from: '2026-09-01',
  };

  // Fixed instant so the D-16 horizon boundary is deterministic: noon UTC on
  // 1 Jul 2026 is the 1st in Europe/London (`makeHouseholdRepo`'s fixture
  // timezone), and the horizon lands on 1 Jul 2027 exactly — same fixture
  // `householdCommandService.test.ts` pins its own horizon tests against.
  const AT_NOON_UTC = () => new Date('2026-07-01T12:00:00.000Z');

  function svcWith(overrides: Record<string, any> = {}) {
    return new HouseholdCommandService(
      makeHouseholdRepo() as never,
      makeMemberRepo() as never,
      makeInviteRepo({
        findByCode: mock(async () =>
          pendingInvite({ role: 'nanny', pay_offer: offer })
        ),
        ...overrides.inviteRepo,
      }) as never,
      { getMembership: mock() } as never,
      {
        ensureProfile: mock(async () => {}),
        getProfileById: mock(async () => ({ name: 'Nia' })),
      } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      makePtoRepo() as never,
      { existsForHousehold: mock(async () => false) } as never,
      { seedCountryPack: mock(async () => []) } as never,
      {
        create: mock(async (row: Record<string, unknown>) => ({
          id: 'p-new',
          ...row,
        })),
        ...overrides.proposals,
      } as never
    );
  }

  it('pushes the inviting parent when the promotion fails, naming the carer', async () => {
    const svc = svcWith({
      proposals: {
        create: mock(async () => {
          throw new Error('boom');
        }),
      },
    });

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyUser).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        body: 'Your pay offer for Nia needs another look',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.PAY_OFFER_NOT_PROMOTED,
          householdId: 'h1',
        }),
      })
    );
  });

  it('pushes the inviting parent when the offer has drifted past the horizon', async () => {
    const svc = svcWith({
      inviteRepo: {
        findByCode: mock(async () =>
          pendingInvite({
            role: 'nanny',
            pay_offer: { ...offer, valid_from: '2027-07-02' },
          })
        ),
      },
    });

    await svc.redeemInvite('u2', { code: 'ABC-234' }, AT_NOON_UTC);

    expect(notifyUser).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        body: 'Your pay offer for Nia needs another look',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.PAY_OFFER_NOT_PROMOTED,
          householdId: 'h1',
        }),
      })
    );
  });

  it('does NOT push when there is nobody to push to (the inviting parent is gone)', async () => {
    const svc = svcWith({
      inviteRepo: {
        findByCode: mock(async () =>
          pendingInvite({ role: 'nanny', pay_offer: offer, invited_by: null })
        ),
      },
    });

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('does NOT push when a round is already open — not news, she is already negotiating', async () => {
    const svc = svcWith({
      proposals: {
        create: mock(async () => {
          throw new OpenTermsProposalExistsError('h1', 'u2');
        }),
      },
    });

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('does NOT push on a successful promotion', async () => {
    const svc = svcWith();

    await svc.redeemInvite('u2', { code: 'ABC-234' });

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('still completes the redeem when the push itself throws', async () => {
    notifyUser.mockImplementationOnce(() => {
      throw new Error('expo down');
    });
    const svc = svcWith({
      proposals: {
        create: mock(async () => {
          throw new Error('boom');
        }),
      },
    });

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).resolves.toMatchObject({ role: 'nanny' });
  });
});

describe('HouseholdCommandService.removeMember — membership_ended', () => {
  /**
   * Until Phase 2 a removed member was told NOTHING: no push, no inbox item,
   * no card. She opened the app and watched her controls disappear.
   */
  function makeSvcForRemoval(
    memberRepoOverrides: Record<string, unknown> = {}
  ) {
    const memberRepo = makeMemberRepo({
      findById: mock(async () => ({
        id: 'm-target',
        household_id: 'h1',
        user_id: 'u-nanny',
        role: 'nanny',
        can_edit: false,
        status: 'active',
      })),
      update: mock(async (id: string, patch: Record<string, unknown>) => ({
        id,
        ...patch,
      })),
      removeMembership: mock(async (id: string) => ({
        id,
        role: 'nanny',
        household_id: 'h1',
        user_id: 'u-nanny',
        can_edit: false,
        status: 'removed',
      })),
      ...memberRepoOverrides,
    });
    const householdRepo = {
      ...makeHouseholdRepo(),
      findById: mock(async () => ({
        id: 'h1',
        name: 'The Okonkwos',
        timezone: 'Europe/London',
        state: 'live',
      })),
    };
    const svc = new HouseholdCommandService(
      householdRepo as never,
      memberRepo as never,
      makeInviteRepo() as never,
      {
        getMembership: mock(async () => ({
          id: 'm-caller',
          household_id: 'h1',
          user_id: 'u1',
          role: 'parent',
          status: 'active',
        })),
      } as never,
      { ensureProfile: mock(), getProfileById: mock() } as never,
      { findRunningInHousehold: mock(async () => null) } as never,
      { endForCarer: mock(async () => []) } as never,
      makePtoRepo() as never,
      undefined,
      undefined,
      { withdrawOpenForCarer: mock(async () => null) } as never,
      undefined,
      // Removal ends her accepted patterns; left defaulted this lazily imports
      // the REAL schedule command service and the test dies on a network call.
      { endAcceptedPatternsForCarer: mock(async () => []) } as never,
      mock(() => undefined) as never
    );
    return { svc, memberRepo };
  }

  it('tells the removed member, naming the family and nothing about money', async () => {
    const { svc } = makeSvcForRemoval();

    await svc.removeMember('u1', 'h1', 'm-target');

    expect(notifyUser).toHaveBeenCalledWith('u-nanny', {
      title: "You're no longer with The Okonkwos",
      body: 'Your record of the hours you worked stays here.',
      data: {
        type: PUSH_NOTIFICATION_TYPES.MEMBERSHIP_ENDED,
        householdId: 'h1',
        reason: 'removed_by_parent',
      },
    });
  });

  it('stamps WHY it ended, so a reader who missed the push still learns which', async () => {
    const { svc, memberRepo } = makeSvcForRemoval();

    await svc.removeMember('u1', 'h1', 'm-target');

    // 112 stamps three facts: the reason, WHEN (so the family's departure card
    // can age out) and WHO (so the parent who did it is not shown a card about
    // their own action). `ended_at` comes from an un-injected clock on this
    // path, so it is asserted as an instant rather than a value.
    const patch = memberRepo.update.mock.calls.find(
      call => call[0] === 'm-target'
    )?.[1];
    expect(patch).toMatchObject({
      ended_reason: 'removed_by_parent',
      ended_by: 'u1',
    });
    expect(typeof patch?.ended_at).toBe('string');
  });

  // The gap this closes: in a two-parent household one of them could remove
  // the nanny and the other would find out when a shift went uncovered. The
  // exclusion is the point — being told you did the thing you just did reads
  // as somebody else's decision.
  it('tells the OTHER parents, naming her, and never the parent who did it', async () => {
    const { svc } = makeSvcForRemoval();

    await svc.removeMember('u1', 'h1', 'm-target');

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        title: 'A nanny is no longer in your household',
        body: 'Nothing further is scheduled for them.',
        data: expect.objectContaining({ householdId: 'h1', role: 'parent' }),
      }),
      { excludeUserId: 'u1' }
    );
  });

  it('says nothing when the CAS found nothing to remove', async () => {
    const { svc } = makeSvcForRemoval({
      removeMembership: mock(async () => null),
    });

    await expect(svc.removeMember('u1', 'h1', 'm-target')).rejects.toThrow();

    expect(notifyUser).not.toHaveBeenCalled();
  });
});
