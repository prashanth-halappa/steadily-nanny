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

function makeMemberRepo() {
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
  };
}

function makeInviteRepo(overrides: Record<string, unknown> = {}) {
  return {
    findByCode: mock(async () => pendingInvite()),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...pendingInvite(),
      id,
      ...data,
    })),
    ...overrides,
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
      { getMembership: mock() } as never
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
        { getMembership: mock() } as never
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

  it('push failure does not fail the redeem', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('expo down');
    });
    const svc = new HouseholdCommandService(
      { create: mock(), update: mock(), delete: mock() } as never,
      makeMemberRepo() as never,
      makeInviteRepo() as never,
      { getMembership: mock() } as never
    );

    await expect(
      svc.redeemInvite('u2', { code: 'ABC-234' })
    ).resolves.toMatchObject({ role: 'nanny' });
  });
});
