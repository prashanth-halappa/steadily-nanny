/**
 * Closure removal triggers uncovered-care detection per expanded local date.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { HouseholdClosure } from '../../../../../src/domains/availability/types';
import type { HouseholdMember } from '../../../../../src/domains/household/types';
import {
  addDays,
  localDatesCovered,
} from '../../../../../src/domains/pay/utils/localDateSpan';
import { localDateOf } from '../../../../../src/domains/timesheet/utils/weekStart';

const TIMEZONE = 'UTC';
const NOW = new Date();
const today = localDateOf(NOW, TIMEZONE);
const closureStartsAt = `${today}T00:00:00Z`;
const closureEndsAt = `${addDays(today, 3)}T00:00:00Z`;
const expectedDates = localDatesCovered(
  closureStartsAt,
  closureEndsAt,
  TIMEZONE
).filter(date => date >= today && date <= addDays(today, 30));

const closure: HouseholdClosure = {
  id: 'c1',
  household_id: 'h1',
  starts_at: closureStartsAt,
  ends_at: closureEndsAt,
  message: null,
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
};

const household = {
  id: 'h1',
  name: 'Smiths',
  timezone: TIMEZONE,
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

beforeEach(() => {
  detectUncoveredCareBestEffort.mockClear();
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
    expect(dates).toEqual(expectedDates);
    expect(dates).toHaveLength(3);
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
