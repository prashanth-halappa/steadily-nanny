/**
 * Gap push copy when cause is a known decline/cancellation — must carry the
 * cause, not a generic "someone is uncovered" line.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RaiseUncoveredArgs } from '../../../../../src/domains/child/services/uncoveredCareService';

const LONDON = 'Europe/London';
const MONDAY = '2026-08-10';

const baseArgs: RaiseUncoveredArgs = {
  householdId: 'h1',
  localDate: MONDAY,
  timezone: LONDON,
  shifts: [
    {
      id: 'declined-shift',
      startsAt: '2026-08-10T05:00:00.000Z',
      endsAt: '2026-08-10T19:00:00.000Z',
      status: 'declined',
      children: [{ childId: 'child1', startsAt: null, endsAt: null }],
    },
  ],
  needWindows: [
    {
      id: 'cm1',
      childId: 'child1',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
      startTime: '06:00',
      endTime: '20:00',
      startsOn: null,
      endsOn: null,
      exdates: [],
    },
  ],
  closures: [],
  cause: 'declined',
  actorId: 'carer-1',
};

let UncoveredCareService: typeof import('../../../../../src/domains/child/services/uncoveredCareService').UncoveredCareService;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents,
    notifyUser: mock(() => undefined),
  }));

  ({ UncoveredCareService } = await import(
    '../../../../../src/domains/child/services/uncoveredCareService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
});

function makeEventRepo(): any {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async (rows: unknown[]) => rows),
  };
}

function makeService(eventRepo = makeEventRepo()) {
  return new UncoveredCareService(
    eventRepo,
    {
      findByHouseholdAndLocalDate: mock(async () => [
        {
          id: 'declined-shift',
          household_id: 'h1',
          carer_id: 'carer-1',
          starts_at: '2026-08-10T05:00:00.000Z',
          ends_at: '2026-08-10T19:00:00.000Z',
          timezone: LONDON,
          local_date: MONDAY,
          status: 'declined',
          shift_children: [{ child_id: 'child1' }],
        },
      ]),
    } as never,
    {
      listActiveByHousehold: mock(async () => [
        {
          user_id: 'carer-1',
          role: 'nanny',
          display_name_override: 'H1 Nanny1',
          profile_name: null,
        },
      ]),
    } as never,
    {
      findActiveByHousehold: mock(async () => [
        { id: 'child1', household_id: 'h1', name: 'H1 Child1' },
      ]),
    } as never
  );
}

describe('UncoveredCareService.raiseUncoveredOnce — cause-aware gap push', () => {
  it('carries the decline cause in the push body instead of a generic uncovered line', async () => {
    await makeService().raiseUncoveredOnce(baseArgs);

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const payload = notifyHouseholdParents.mock.calls[0]?.[1] as {
      body: string;
    };
    expect(payload.body).toContain('H1 Nanny1 turned down');
    expect(payload.body).toContain('Mon 10 Aug');
    expect(payload.body).toContain('6:00 am');
    expect(payload.body).toContain('8:00 pm');
    expect(payload.body).toContain('H1 Child1');
    expect(payload.body).not.toContain('not on the schedule');
  });
});
