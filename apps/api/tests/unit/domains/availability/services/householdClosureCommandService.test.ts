/**
 * Household-closure pushes — carers learn when family closures change.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { HouseholdClosure } from '../../../../../src/domains/availability/types';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

const closure: HouseholdClosure = {
  id: 'c1',
  household_id: 'h1',
  starts_at: '2026-08-10T00:00:00Z',
  ends_at: '2026-08-12T00:00:00Z',
  message: null,
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
};

let HouseholdClosureCommandService: typeof import('../../../../../src/domains/availability/services/householdClosureCommandService').HouseholdClosureCommandService;
let notifyUser: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: mock(async () => []),
      detectUncoveredCareBestEffort: mock(() => undefined),
    })
  );
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents: mock(() => undefined),
  }));

  ({ HouseholdClosureCommandService } = await import(
    '../../../../../src/domains/availability/services/householdClosureCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
});

function membership(
  role: HouseholdMember['role'],
  userId: string
): HouseholdMember {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
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

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...closure,
      ...data,
      id: 'c-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...closure,
      id,
      ...data,
    })),
    delete: mock(async () => undefined),
    ...overrides,
  };
}

function makeHouseholds(role: HouseholdMember['role'] = 'owner') {
  return {
    getMembership: mock(async () => membership(role, 'parent-1')),
    getOwned: mock(async () => ({
      id: 'h1',
      name: 'Smiths',
      timezone: 'UTC',
    })),
  };
}

function makeQueries() {
  return {
    getOwned: mock(async () => closure),
  };
}

describe('HouseholdClosureCommandService — household_closure_changed', () => {
  it('create notifies each household nanny', async () => {
    const memberRepo = {
      listActiveByHousehold: mock(async () => [
        membership('nanny', 'carer-1'),
        membership('nanny', 'carer-2'),
        membership('parent', 'parent-2'),
      ]),
    };
    const svc = new HouseholdClosureCommandService(
      makeRepo() as never,
      makeHouseholds() as never,
      makeQueries() as never,
      memberRepo as never
    );

    await svc.create('parent-1', 'h1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: expect.stringContaining('added'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.HOUSEHOLD_CLOSURE_CHANGED,
          householdId: 'h1',
        },
      })
    );
  });

  it('update notifies carers with changed wording', async () => {
    const memberRepo = {
      listActiveByHousehold: mock(async () => [membership('nanny', 'carer-1')]),
    };
    const svc = new HouseholdClosureCommandService(
      makeRepo() as never,
      makeHouseholds() as never,
      makeQueries() as never,
      memberRepo as never
    );

    await svc.update('parent-1', 'h1', 'c1', {
      ends_at: '2026-08-14T00:00:00Z',
    });

    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: expect.stringContaining('updated'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.HOUSEHOLD_CLOSURE_CHANGED,
          householdId: 'h1',
        },
      })
    );
  });

  it('remove notifies carers with removed wording', async () => {
    const memberRepo = {
      listActiveByHousehold: mock(async () => [membership('nanny', 'carer-1')]),
    };
    const svc = new HouseholdClosureCommandService(
      makeRepo() as never,
      makeHouseholds() as never,
      makeQueries() as never,
      memberRepo as never
    );

    await svc.remove('parent-1', 'h1', 'c1');

    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: expect.stringContaining('removed'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.HOUSEHOLD_CLOSURE_CHANGED,
          householdId: 'h1',
        },
      })
    );
  });

  it('push failure does not fail the write', async () => {
    notifyUser.mockImplementation(() => {
      throw new Error('expo down');
    });
    const memberRepo = {
      listActiveByHousehold: mock(async () => [membership('nanny', 'carer-1')]),
    };
    const svc = new HouseholdClosureCommandService(
      makeRepo() as never,
      makeHouseholds() as never,
      makeQueries() as never,
      memberRepo as never
    );

    await expect(
      svc.create('parent-1', 'h1', {
        starts_at: '2026-08-10T00:00:00Z',
        ends_at: '2026-08-12T00:00:00Z',
      })
    ).resolves.toMatchObject({ id: 'c-new' });
  });
});
