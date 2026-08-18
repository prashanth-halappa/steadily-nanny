/**
 * Push notifications for schedule-pattern send / amend (Wave 2A).
 * mock.module BEFORE dynamic import so notifyUser can be asserted.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';

function patternFor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    household_id: 'h1',
    carer_id: 'carer-1',
    status: 'draft',
    rrule: 'FREQ=WEEKLY;INTERVAL=1',
    dtstart: '2026-02-02',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: 'The usual week',
    created_by: 'u1',
    sent_at: null,
    responded_at: null,
    ical_uid: 'pattern-uid',
    sequence: 0,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function membershipFor(role: string) {
  return { id: 'm1', household_id: 'h1', user_id: 'u1', role };
}

let SchedulePatternCommandService: typeof import('../../../../../src/domains/schedule/services/schedulePatternCommandService').SchedulePatternCommandService;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents,
  }));

  ({ SchedulePatternCommandService } = await import(
    '../../../../../src/domains/schedule/services/schedulePatternCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
});

function makePatternRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async () => patternFor()),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...patternFor(),
      id,
      ...data,
    })),
    ...overrides,
  };
}

function makeMemberRepo(role: string | null = 'owner'): any {
  return {
    findActiveMembership: mock(async () => (role ? membershipFor(role) : null)),
  };
}

function makeQueries(pattern: Record<string, unknown> = patternFor()): any {
  return {
    getOwned: mock(async () => pattern),
    getWithDays: mock(async () => ({
      ...pattern,
      days: [
        {
          id: 'd1',
          pattern_id: 'p1',
          weekday: 4,
          start_time: '08:00',
          end_time: '17:00',
          children: [],
        },
      ],
    })),
    getDaysForPattern: mock(async () => []),
  };
}

function makeMaterialisation(): any {
  return {
    materialise: mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 1,
      cancelled: 0,
      conflicts: [],
      touchedDates: [],
    })),
  };
}

function makeEmptyRepos(): any {
  return {};
}

describe('SchedulePatternCommandService — carer pushes', () => {
  it('send pushes the carer with SCHEDULE_PATTERN_SENT', async () => {
    const svc = new SchedulePatternCommandService(
      makePatternRepo(),
      makeEmptyRepos(),
      makeEmptyRepos(),
      makeMemberRepo('owner'),
      makeEmptyRepos(),
      makeQueries(patternFor({ status: 'draft', carer_id: 'carer-1' })),
      makeMaterialisation()
    );

    await svc.send('u1', 'p1');

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT,
          patternId: 'p1',
          householdId: 'h1',
        }),
      })
    );
  });

  it('withdraw pushes the carer with SCHEDULE_PATTERN_WITHDRAWN', async () => {
    const pending = patternFor({ status: 'pending', carer_id: 'carer-1' });
    const svc = new SchedulePatternCommandService(
      makePatternRepo({
        update: mock(async (id: string, data: Record<string, unknown>) => ({
          ...pending,
          id,
          ...data,
        })),
      }),
      makeEmptyRepos(),
      makeEmptyRepos(),
      makeMemberRepo('owner'),
      makeEmptyRepos(),
      makeQueries(pending),
      makeMaterialisation()
    );

    await svc.withdraw('u1', 'p1');

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_WITHDRAWN,
          patternId: 'p1',
          householdId: 'h1',
        }),
      })
    );
  });

  it('amend pushes the carer with SCHEDULE_PATTERN_AMENDED', async () => {
    const accepted = patternFor({ status: 'accepted', carer_id: 'carer-1' });
    const svc = new SchedulePatternCommandService(
      makePatternRepo({
        update: mock(async (id: string, data: Record<string, unknown>) => ({
          ...accepted,
          id,
          ...data,
        })),
      }),
      makeEmptyRepos(),
      makeEmptyRepos(),
      makeMemberRepo('owner'),
      makeEmptyRepos(),
      makeQueries(accepted),
      makeMaterialisation()
    );

    await svc.amend('u1', 'p1', { exdates: ['2026-09-03'] });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED,
          patternId: 'p1',
          householdId: 'h1',
        }),
      })
    );
  });
});
