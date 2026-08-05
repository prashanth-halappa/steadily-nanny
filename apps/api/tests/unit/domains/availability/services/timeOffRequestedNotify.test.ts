/**
 * Time-off create must notify each nanny-household's parents even when no
 * shifts overlap — complements the conflict push in timeOffConflictNotify.
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

function membership(
  householdId: string,
  role: HouseholdMember['role']
): HouseholdMember {
  return {
    id: `m-${householdId}`,
    household_id: householdId,
    user_id: 'nanny-1',
    role,
    can_edit: false,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: 't',
    created_at: 't',
    updated_at: 't',
  };
}

function makeTimeOffRepo() {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...row,
      ...data,
      id: 't-new',
    })),
  };
}

function makeOverlapRepo() {
  return {
    listConfirmedForCarerInRange: mock(async () => []),
  };
}

describe('TimeOffCommandService.create — time_off_requested', () => {
  it('notifies parents of every household where the carer is a nanny', async () => {
    const notify = mock(() => undefined);
    const memberRepo = {
      listActiveByUser: mock(async () => [
        membership('hh-a', 'nanny'),
        membership('hh-b', 'nanny'),
        membership('hh-c', 'parent'),
      ]),
    };
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      { getOwned: mock(async () => row) } as never,
      makeOverlapRepo() as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      'hh-a',
      expect.objectContaining({
        data: {
          type: PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED,
          householdId: 'hh-a',
        },
      })
    );
    expect(notify).toHaveBeenCalledWith(
      'hh-b',
      expect.objectContaining({
        data: {
          type: PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED,
          householdId: 'hh-b',
        },
      })
    );
  });

  it('also sends time_off_requested when a conflict push fires for the same household', async () => {
    // Typed params so `notify.mock.calls` is a 2-tuple we can destructure below.
    const notify = mock((_householdId: string, _payload: unknown) => undefined);
    const memberRepo = {
      listActiveByUser: mock(async () => [membership('hh-reyes', 'nanny')]),
    };
    const overlapRepo = {
      listConfirmedForCarerInRange: mock(async () => [
        { id: 's1', household_id: 'hh-reyes' },
      ]),
    };
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      { getOwned: mock(async () => row) } as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(notify).toHaveBeenCalledTimes(2);
    const types = notify.mock.calls.map(
      ([, payload]) => (payload as { data: { type: string } }).data.type
    );
    expect(types).toContain(PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT);
    expect(types).toContain(PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED);
  });

  it('push failure still returns the created row', async () => {
    const notify = mock(() => {
      throw new Error('expo down');
    });
    const memberRepo = {
      listActiveByUser: mock(async () => [membership('hh-1', 'nanny')]),
    };
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      { getOwned: mock(async () => row) } as never,
      makeOverlapRepo() as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
    });

    expect(result.carer_time_off.id).toBe('t-new');
  });
});
