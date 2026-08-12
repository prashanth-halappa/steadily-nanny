/**
 * Time-off create must notify each nanny-household's parents even when no
 * shifts overlap — complements the conflict push in timeOffConflictNotify.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_START = new Date(Date.now() + 28 * DAY_MS).toISOString();
const FUTURE_END = new Date(Date.now() + 30 * DAY_MS).toISOString();

const row: CarerTimeOff = {
  id: 't1',
  user_id: 'nanny-1',
  starts_at: FUTURE_START,
  ends_at: FUTURE_END,
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
      {
        getOwned: mock(async () => row),
        assertActiveMember: mock(async () => undefined),
      } as never,
      makeOverlapRepo() as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    await svc.create('nanny-1', {
      starts_at: FUTURE_START,
      ends_at: FUTURE_END,
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
      {
        getOwned: mock(async () => row),
        assertActiveMember: mock(async () => undefined),
      } as never,
      overlapRepo as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    await svc.create('nanny-1', {
      starts_at: FUTURE_START,
      ends_at: FUTURE_END,
    });

    expect(notify).toHaveBeenCalledTimes(2);
    const types = notify.mock.calls.map(
      ([, payload]) => (payload as { data: { type: string } }).data.type
    );
    expect(types).toContain(PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT);
    expect(types).toContain(PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED);
  });

  it('sends sick wording when the persisted row kind is sick', async () => {
    const notify = mock((_householdId: string, _payload: unknown) => undefined);
    const memberRepo = {
      listActiveByUser: mock(async () => [membership('hh-sick', 'nanny')]),
    };
    const timeOffRepo = {
      create: mock(async (data: Record<string, unknown>) => ({
        ...row,
        ...data,
        id: 't-new',
        kind: 'sick',
      })),
    };
    const svc = new TimeOffCommandService(
      timeOffRepo as never,
      {
        getOwned: mock(async () => row),
        assertActiveMember: mock(async () => undefined),
      } as never,
      makeOverlapRepo() as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    await svc.create('nanny-1', {
      starts_at: FUTURE_START,
      ends_at: FUTURE_END,
      kind: 'sick',
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('hh-sick', {
      title: 'Carer is off sick',
      body: 'Your carer has recorded a sick day — open Time off to see the dates.',
      data: {
        type: PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED,
        householdId: 'hh-sick',
      },
    });
  });

  it('personal wording stays byte-identical (pin)', async () => {
    const notify = mock((_householdId: string, _payload: unknown) => undefined);
    const memberRepo = {
      listActiveByUser: mock(async () => [membership('hh-personal', 'nanny')]),
    };
    const svc = new TimeOffCommandService(
      makeTimeOffRepo() as never,
      {
        getOwned: mock(async () => row),
        assertActiveMember: mock(async () => undefined),
      } as never,
      makeOverlapRepo() as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    await svc.create('nanny-1', {
      starts_at: FUTURE_START,
      ends_at: FUTURE_END,
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('hh-personal', {
      title: 'Time off requested',
      body: 'Your nanny has requested time off — open Time off to review.',
      data: {
        type: PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED,
        householdId: 'hh-personal',
      },
    });
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
      {
        getOwned: mock(async () => row),
        assertActiveMember: mock(async () => undefined),
      } as never,
      makeOverlapRepo() as never,
      notify,
      async () => undefined,
      memberRepo as never
    );

    const result = await svc.create('nanny-1', {
      starts_at: FUTURE_START,
      ends_at: FUTURE_END,
    });

    expect(result.carer_time_off.id).toBe('t-new');
  });
});
