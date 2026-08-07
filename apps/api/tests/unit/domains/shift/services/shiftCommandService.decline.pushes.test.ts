/**
 * Push leg of the carer decline (Wave 1B). Parent-targeted: the family now
 * has a gap where they thought they had cover, and they cannot see the
 * refusal from the carer app.
 *
 * The `data` payload is a wire contract with the mobile deep-link route map
 * (`shiftDetailHref` reads `shiftId` + `householdId`), so it is asserted
 * field-exact here, not with `objectContaining`.
 *
 * mock.module BEFORE the dynamic import — see docs/09-TESTING.md.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

const pendingShift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
  kind: 'extra',
  status: 'pending',
  source_pattern_id: null,
  origin: 'parent_proposed',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'uid-1',
  sequence: 0,
  created_by: null,
  created_at: 't',
  updated_at: 't',
  shift_children: [],
};

let ShiftCommandService: typeof import('../../../../../src/domains/shift/services/shiftCommandService').ShiftCommandService;
let notifyHouseholdParents: ReturnType<typeof mock>;
let notifyUser: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents,
  }));

  ({ ShiftCommandService } = await import(
    '../../../../../src/domains/shift/services/shiftCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
  notifyHouseholdParents.mockImplementation(() => undefined);
});

function makeShiftRepo(): any {
  const assertMutable = mock(async (_id: string) => undefined);
  return {
    assertMutable,
    declinePending: mock(async (id: string) => {
      await assertMutable(id);
      return { ...pendingShift, id, status: 'declined' };
    }),
  };
}

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return { insertMany: mock(async () => []), ...overrides };
}

function makeCarerMemberRepo(): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm2',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
    })),
  };
}

function makeQueries(): any {
  return { getOwned: mock(async () => pendingShift) };
}

function makeService(eventRepo = makeEventRepo()) {
  return new ShiftCommandService(
    makeShiftRepo(),
    makeCarerMemberRepo(),
    makeQueries(),
    eventRepo
  );
}

describe('ShiftCommandService.decline — pushes', () => {
  it('pushes household parents with shift_declined exactly once', async () => {
    await makeService().decline('carer-1', 's1');

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = notifyHouseholdParents.mock.calls[0] as [
      string,
      { title: string; body: string; data: Record<string, unknown> },
    ];
    expect(householdId).toBe('h1');
    expect(payload.title).toBe('Shift declined');
    expect(payload.body).toBe('The nanny declined a pending shift.');
    // Field-exact: the mobile route map reads shiftId/householdId off `data`.
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED,
      shiftId: 's1',
      householdId: 'h1',
    });
  });

  it('never pushes the declining carer herself', async () => {
    await makeService().decline('carer-1', 's1');

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('push failure never fails the decline', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('push boom');
    });

    const result = await makeService().decline('carer-1', 's1');

    expect(result.status).toBe('declined');
  });

  it('still pushes when the day-thread event write failed', async () => {
    // The status write already committed; parents must learn about the gap
    // even if the advisory audit row did not land.
    const eventRepo = makeEventRepo({
      insertMany: mock(async () => {
        throw new Error('db down');
      }),
    });

    await makeService(eventRepo).decline('carer-1', 's1');

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });
});
