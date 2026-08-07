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
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

let HouseholdCommandService: typeof import('../../../../../src/domains/household/services/householdCommandService').HouseholdCommandService;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents,
    notifyUser: mock(() => undefined),
  }));

  ({ HouseholdCommandService } = await import(
    '../../../../../src/domains/household/services/householdCommandService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
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
    findMembershipAnyStatus: mock(async () => null),
    reactivateMembership: mock(async (id: string, role: string) => ({
      id,
      role,
      household_id: 'h1',
      user_id: 'u2',
      can_edit: false,
      status: 'active',
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
    findById: mock(async () => ({ id: 'h1', timezone: 'Europe/London' })),
  };
}

describe('HouseholdCommandService.redeemInvite — invite_redeemed', () => {
  it('notifies household parents with the redeemed role in the body', async () => {
    const svc = new HouseholdCommandService(
      { create: mock(), update: mock(), delete: mock() } as never,
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
        { create: mock(), update: mock(), delete: mock() } as never,
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
      { create: mock(), update: mock(), delete: mock() } as never,
      makeMemberRepo({
        findMembershipAnyStatus: mock(async () => ({
          id: 'm-old',
          household_id: 'h1',
          user_id: 'u2',
          role: 'nanny',
          status: 'removed',
        })),
      }) as never,
      makeInviteRepo() as never,
      { getMembership: mock() } as never,
      { ensureProfile: mock(async () => {}) } as never
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
      { create: mock(), update: mock(), delete: mock() } as never,
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
        findMembershipAnyStatus: mock(async () => removedMember),
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
