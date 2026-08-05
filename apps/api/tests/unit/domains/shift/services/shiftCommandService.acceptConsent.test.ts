/**
 * Accept-pending + parent-edit consent parity (Wave 1A).
 * mock.module BEFORE dynamic import so notifyUser can be asserted.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  ShiftImmutableError,
  ShiftNotFoundError,
} from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { ValidationError } from '../../../../../src/errors';

const confirmedShift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
  kind: 'extra',
  status: 'confirmed',
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

const pendingShift: ShiftWithChildren = {
  ...confirmedShift,
  status: 'pending',
};

let ShiftCommandService: typeof import('../../../../../src/domains/shift/services/shiftCommandService').ShiftCommandService;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

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
});

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  const assertMutable = mock(async (_id: string) => undefined);
  return {
    applyParentEdit: mock(async (args: Record<string, unknown>) => {
      const timeChanged = Boolean(args.setStartsAt || args.setEndsAt);
      return {
        ...confirmedShift,
        starts_at: args.setStartsAt ? args.startsAt : confirmedShift.starts_at,
        ends_at: args.setEndsAt ? args.endsAt : confirmedShift.ends_at,
        note: args.setNote ? args.note : confirmedShift.note,
        origin: args.origin,
        status: timeChanged ? 'pending' : confirmedShift.status,
        sequence: confirmedShift.sequence + 1,
      };
    }),
    update: mock(async (_id: string, data: Record<string, unknown>) => ({
      ...pendingShift,
      ...data,
    })),
    assertMutable,
    confirmPending: mock(async (id: string) => {
      await assertMutable(id);
      return { ...pendingShift, id, status: 'confirmed' };
    }),
    ...overrides,
  };
}

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    insertMany: mock(async () => undefined),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'parent-1',
      role: 'parent',
    })),
    ...overrides,
  };
}

function makeQueries(
  shift: ShiftWithChildren = confirmedShift,
  overrides: Record<string, unknown> = {}
): any {
  return {
    getOwned: mock(async () => shift),
    ...overrides,
  };
}

describe('ShiftCommandService.accept', () => {
  it('lets the assigned carer confirm a pending shift and writes a day-thread event', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
      })),
    });
    const svc = new ShiftCommandService(
      shiftRepo,
      memberRepo,
      makeQueries(pendingShift),
      eventRepo
    );

    const result = await svc.accept('carer-1', 's1');

    expect(shiftRepo.confirmPending).toHaveBeenCalledWith('s1');
    expect(shiftRepo.assertMutable).toHaveBeenCalledWith('s1');
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        shift_id: 's1',
        event_type: 'shift_confirmed',
        actor_id: 'carer-1',
      }),
    ]);
    expect(result.status).toBe('confirmed');
  });

  it('still returns the confirmed shift when the day-thread event write fails', async () => {
    // confirmPending has already committed by then — failing the request would
    // 500 on a shift that IS confirmed, and the retry 400s SHIFT_NOT_PENDING.
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo({
      insertMany: mock(async () => {
        throw new Error('db down');
      }),
    });
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
      })),
    });
    const svc = new ShiftCommandService(
      shiftRepo,
      memberRepo,
      makeQueries(pendingShift),
      eventRepo
    );

    const result = await svc.accept('carer-1', 's1');

    expect(result.status).toBe('confirmed');
    expect(shiftRepo.confirmPending).toHaveBeenCalledWith('s1');
  });

  it('pushes household parents with shift_confirmed after a successful accept', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
      })),
    });
    const svc = new ShiftCommandService(
      shiftRepo,
      memberRepo,
      makeQueries(pendingShift),
      eventRepo
    );

    await svc.accept('carer-1', 's1');

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        title: 'Shift confirmed',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CONFIRMED,
          shiftId: 's1',
          householdId: 'h1',
        }),
      })
    );
  });

  it('push failure never fails accept', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('push boom');
    });
    const shiftRepo = makeShiftRepo();
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
      })),
    });
    const svc = new ShiftCommandService(
      shiftRepo,
      memberRepo,
      makeQueries(pendingShift),
      makeEventRepo()
    );

    const result = await svc.accept('carer-1', 's1');

    expect(result.status).toBe('confirmed');
  });

  it('rejects a non-carer with the same not-found-shaped error as a missing shift', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries(pendingShift),
      eventRepo
    );

    await expect(svc.accept('parent-1', 's1')).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
    expect(shiftRepo.confirmPending).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  it('rejects accept when the shift has time entries (immutable)', async () => {
    const assertMutable = mock(async (_id: string) => {
      throw new ShiftImmutableError('s1', 'pending', 'has_time_entries');
    });
    const shiftRepo = makeShiftRepo({
      assertMutable,
      confirmPending: mock(async (id: string) => {
        await assertMutable(id);
        return { ...pendingShift, id, status: 'confirmed' };
      }),
    });
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
      })),
    });
    const svc = new ShiftCommandService(
      shiftRepo,
      memberRepo,
      makeQueries(pendingShift),
      makeEventRepo()
    );

    await expect(svc.accept('carer-1', 's1')).rejects.toBeInstanceOf(
      ShiftImmutableError
    );
    expect(shiftRepo.confirmPending).toHaveBeenCalledWith('s1');
  });

  it('rejects accept on a non-pending shift', async () => {
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
      })),
    });
    const svc = new ShiftCommandService(
      makeShiftRepo(),
      memberRepo,
      makeQueries(confirmedShift),
      makeEventRepo()
    );

    await expect(svc.accept('carer-1', 's1')).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

describe('ShiftCommandService.update — consent parity', () => {
  it('on a time edit, returns pending and pushes the carer with shift_needs_reconfirm', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries(confirmedShift),
      makeEventRepo()
    );

    const result = await svc.update('parent-1', 's1', {
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T18:00:00.000Z',
    });

    expect(result.status).toBe('pending');
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM,
          shiftId: 's1',
          householdId: 'h1',
        }),
      })
    );
  });

  it('on a note-only edit, leaves status unchanged and does not demote-push', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries(confirmedShift),
      makeEventRepo()
    );

    const result = await svc.update('parent-1', 's1', {
      note: 'Running 15 min late',
    });

    expect(result.status).toBe('confirmed');
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('push failure never fails the parent edit', async () => {
    notifyUser.mockImplementation(() => {
      throw new Error('push boom');
    });
    const svc = new ShiftCommandService(
      makeShiftRepo(),
      makeMemberRepo(),
      makeQueries(confirmedShift),
      makeEventRepo()
    );

    const result = await svc.update('parent-1', 's1', {
      starts_at: '2026-08-03T09:00:00.000Z',
    });

    expect(result.status).toBe('pending');
  });

  it('still rejects a nanny editing', async () => {
    const svc = new ShiftCommandService(
      makeShiftRepo(),
      makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm2',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
        })),
      }),
      makeQueries(confirmedShift),
      makeEventRepo()
    );

    await expect(
      svc.update('carer-1', 's1', { note: 'x' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});
