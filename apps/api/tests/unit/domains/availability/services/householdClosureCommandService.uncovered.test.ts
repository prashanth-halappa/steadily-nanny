/**
 * Closure removal triggers uncovered-care detection per expanded local date.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import type { HouseholdClosure } from '../../../../../src/domains/availability/types';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

const closure: HouseholdClosure = {
  id: 'c1',
  household_id: 'h1',
  starts_at: '2026-08-10T00:00:00Z',
  ends_at: '2026-08-13T00:00:00Z',
  message: null,
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
};

const household = {
  id: 'h1',
  name: 'Smiths',
  timezone: 'UTC',
};

let HouseholdClosureCommandService: typeof import('../../../../../src/domains/availability/services/householdClosureCommandService').HouseholdClosureCommandService;
let detectUncoveredCareBestEffort: ReturnType<typeof mock>;
let notifyUser: ReturnType<typeof mock>;

beforeAll(async () => {
  detectUncoveredCareBestEffort = mock(() => undefined);
  notifyUser = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: mock(async () => []),
      detectUncoveredCareBestEffort,
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

// `remove` clamps the closure span to `[today, today + 30]` against the REAL
// clock, and the assertions below name absolute dates. Without pinning `now`
// this file passes until the day the fixture's first date falls behind today,
// then fails forever — it did exactly that at 2026-08-11T00:00Z, taking `qc`
// red for a reason that had nothing to do with whatever was being changed.
const FIXED_NOW = new Date('2026-08-10T12:00:00.000Z');

beforeEach(() => {
  setSystemTime(FIXED_NOW);
  detectUncoveredCareBestEffort.mockClear();
  notifyUser.mockClear();
});

afterEach(() => {
  setSystemTime();
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

function makeSvc() {
  return new HouseholdClosureCommandService(
    { delete: mock(async () => undefined) } as never,
    {
      getMembership: mock(async () => membership('owner', 'parent-1')),
      getOwned: mock(async () => household),
    } as never,
    { getOwned: mock(async () => closure) } as never,
    {
      listActiveByHousehold: mock(async () => [membership('nanny', 'carer-1')]),
    } as never
  );
}

describe('HouseholdClosureCommandService.remove — uncovered detection', () => {
  it('runs detection once per expanded local date with closureRemoved', async () => {
    await makeSvc().remove('parent-1', 'h1', 'c1');

    const dates = detectUncoveredCareBestEffort.mock.calls.map(
      (call: unknown[]) => (call[0] as { localDate: string }).localDate
    );
    expect(dates).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
    expect(detectUncoveredCareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        cause: 'closureRemoved',
        actorId: 'parent-1',
        excludeUserId: 'parent-1',
      })
    );
  });

  it('detection failure does not fail the removal', async () => {
    detectUncoveredCareBestEffort.mockImplementation(() => {
      throw new Error('detect boom');
    });

    await expect(
      makeSvc().remove('parent-1', 'h1', 'c1')
    ).resolves.toBeUndefined();
  });
});
