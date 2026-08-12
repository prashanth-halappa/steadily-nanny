/**
 * Decline push copy — names the carer, the day, the hours, and a child in the
 * household timezone. mock.module BEFORE dynamic import.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  formatPushShortDate,
  formatPushTime12h,
} from '../../../../../src/domains/child/services/uncoveredCareService';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { localDateOf } from '../../../../../src/domains/timesheet/utils/weekStart';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = 'Europe/London';
const FUTURE_START = new Date(Date.now() + 28 * DAY_MS).toISOString();
const FUTURE_END = new Date(
  Date.now() + 28 * DAY_MS + 14 * 60 * 60 * 1000
).toISOString();
const FUTURE_LOCAL_DATE = localDateOf(new Date(FUTURE_START), TIMEZONE);

const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const pendingShift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: FUTURE_START,
  ends_at: FUTURE_END,
  timezone: TIMEZONE,
  local_date: FUTURE_LOCAL_DATE,
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
  shift_children: [
    {
      id: 'sc1',
      shift_id: 's1',
      child_id: CHILD_ID,
      starts_at: null,
      ends_at: null,
      created_at: 't',
    },
  ],
};

let ShiftCommandService: typeof import('../../../../../src/domains/shift/services/shiftCommandService').ShiftCommandService;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: mock(async () => ({
        inserted: [],
        pushed: [],
      })),
      detectUncoveredCareBestEffort: mock(() => undefined),
    })
  );
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser: mock(() => undefined),
    notifyHouseholdParents,
  }));

  ({ ShiftCommandService } = await import(
    '../../../../../src/domains/shift/services/shiftCommandService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
});

function makeService() {
  return new ShiftCommandService(
    {
      declinePending: mock(async (id: string) => ({
        ...pendingShift,
        id,
        status: 'declined',
      })),
    } as never,
    {
      findActiveMembership: mock(async () => ({
        id: 'm2',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
        display_name_override: 'H1 Nanny1',
        profile_name: null,
      })),
      listActiveByHousehold: mock(async () => [
        {
          id: 'm2',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
          display_name_override: 'H1 Nanny1',
          profile_name: null,
        },
      ]),
    } as never,
    { getOwned: mock(async () => pendingShift) } as never,
    { insertMany: mock(async () => []) } as never,
    {
      getOwned: mock(async () => ({
        id: CHILD_ID,
        household_id: 'h1',
        name: 'H1 Child1',
      })),
    } as never,
    {
      findById: mock(async () => ({
        id: 'h1',
        name: 'H1',
        timezone: 'Europe/London',
      })),
    } as never
  );
}

/**
 * The decline push is not awaited by `decline()` — building the enriched copy
 * needs a member and a child lookup, and neither may sit on the critical path
 * of her saying no. So it lands a tick later; let the queue drain.
 */
async function flushPush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('ShiftCommandService.decline — push copy', () => {
  it('names the carer, the date, both times, and a child in the household timezone', async () => {
    await makeService().decline('carer-1', 's1');
    await flushPush();

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const payload = notifyHouseholdParents.mock.calls[0]?.[1] as {
      body: string;
    };
    expect(payload.body).toBe(
      `H1 Nanny1 turned down ${formatPushShortDate(FUTURE_LOCAL_DATE, TIMEZONE)}, ${formatPushTime12h(FUTURE_START, TIMEZONE)}–${formatPushTime12h(FUTURE_END, TIMEZONE)} (H1 Child1).`
    );
  });
});
