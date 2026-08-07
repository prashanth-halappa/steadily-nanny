/**
 * Time-off create/update must scan overlapping confirmed shifts and push
 * each affected household's parents with THAT household's count only.
 *
 * mock.module registers the notification barrel before the dynamic import so
 * the service's default notify import is a no-op; each test still injects its
 * own notify spy via the constructor for assertion.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

const row: CarerTimeOff = {
  id: 't1',
  user_id: 'nanny-1',
  starts_at: '2026-08-10T00:00:00Z',
  ends_at: '2026-08-12T00:00:00Z',
  all_day: true,
  kind: 'personal',
  message: null,
  status: 'confirmed',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: 't',
  updated_at: 't',
};

let TimeOffCommandService: typeof import('../../../../../src/domains/availability/services/timeOffCommandService').TimeOffCommandService;

beforeAll(async () => {
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents: mock(() => undefined),
    notifyUser: mock(() => undefined),
  }));

  ({ TimeOffCommandService } = await import(
    '../../../../../src/domains/availability/services/timeOffCommandService'
  ));
});

function makeTimeOffRepo(overrides: Record<string, unknown> = {}) {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...row,
      ...data,
      id: 't-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...row,
      id,
      ...data,
    })),
    cancelById: mock(async (id: string) => ({
      ...row,
      id,
      status: 'cancelled',
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}) {
  return {
    getOwned: mock(async () => row),
    assertActiveMember: mock(async () => undefined),
    ...overrides,
  };
}

function makeOverlapRepo(shifts: { id: string; household_id: string }[]) {
  return {
    listConfirmedForCarerInRange: mock(async () => shifts),
  };
}

function makeMemberRepo(memberships: HouseholdMember[] = []) {
  return {
    listActiveByUser: mock(async () => memberships),
  };
}

describe('TimeOffCommandService.create — conflict scan', () => {
  it('creates over 3 booked shifts in 2 households → 2 pushes with per-household counts, no cross-household leak', async () => {
    const shifts = [
      { id: 's1', household_id: 'hh-reyes' },
      { id: 's2', household_id: 'hh-reyes' },
      { id: 's3', household_id: 'hh-other' },
    ];
    const notify = mock(() => undefined);
    const overlapRepo = makeOverlapRepo(shifts);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
      all_day: true,
    });

    expect(result.affected_shift_count).toBe(3);
    expect(result.carer_time_off.id).toBe('t-new');
    expect(overlapRepo.listConfirmedForCarerInRange).toHaveBeenCalledWith(
      'nanny-1',
      '2026-08-10T00:00:00Z',
      '2026-08-12T00:00:00Z'
    );
    expect(notify).toHaveBeenCalledTimes(2);

    const calls = notify.mock.calls as unknown as [
      string,
      { title: string; body: string; data: Record<string, unknown> },
    ][];
    const byHousehold = new Map(
      calls.map(([householdId, payload]) => [householdId, payload])
    );

    expect(byHousehold.get('hh-reyes')?.data).toEqual(
      expect.objectContaining({
        type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
        householdId: 'hh-reyes',
        affectedShiftCount: 2,
      })
    );
    expect(byHousehold.get('hh-other')?.data).toEqual(
      expect.objectContaining({
        type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
        householdId: 'hh-other',
        affectedShiftCount: 1,
      })
    );

    for (const [householdId, payload] of byHousehold) {
      const serialized = JSON.stringify(payload);
      for (const otherId of ['hh-reyes', 'hh-other']) {
        if (otherId === householdId) continue;
        expect(serialized).not.toContain(otherId);
      }
      if (householdId === 'hh-reyes') {
        expect(payload.data.affectedShiftCount).toBe(2);
      } else {
        expect(payload.data.affectedShiftCount).toBe(1);
      }
    }
  });

  it('creates with no overlapping shifts → no conflict push, affected_shift_count 0', async () => {
    const notify = mock(() => undefined);
    const overlapRepo = makeOverlapRepo([]);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(result.affected_shift_count).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('push failure still returns the created row (write is not failed)', async () => {
    const notify = mock(() => {
      throw new Error('expo down');
    });
    const overlapRepo = makeOverlapRepo([{ id: 's1', household_id: 'hh-1' }]);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(result.carer_time_off.id).toBe('t-new');
    expect(result.affected_shift_count).toBe(1);
  });

  it('scan lookup failure still returns the created row with affected_shift_count 0', async () => {
    const notify = mock(() => undefined);
    const overlapRepo = {
      listConfirmedForCarerInRange: mock(async () => {
        throw new Error('db down');
      }),
    };
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(result.carer_time_off.id).toBe('t-new');
    expect(result.affected_shift_count).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('TimeOffCommandService.update — conflict scan', () => {
  it('re-scans the effective range and pushes per-household counts', async () => {
    const notify = mock(() => undefined);
    const overlapRepo = makeOverlapRepo([
      { id: 's1', household_id: 'hh-a' },
      { id: 's2', household_id: 'hh-a' },
    ]);
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      makeQueries() as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      makeMemberRepo() as never
    );

    const result = await svc.update('nanny-1', 't1', {
      starts_at: '2026-08-11T00:00:00Z',
      ends_at: '2026-08-13T00:00:00Z',
    });

    expect(result.affected_shift_count).toBe(2);
    expect(overlapRepo.listConfirmedForCarerInRange).toHaveBeenCalledWith(
      'nanny-1',
      '2026-08-11T00:00:00Z',
      '2026-08-13T00:00:00Z'
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'hh-a',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT,
          affectedShiftCount: 2,
        }),
      })
    );
  });
});
