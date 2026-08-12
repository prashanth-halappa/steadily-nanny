/**
 * Running-late shift event — carer-raised, parent push, no lateness metric in
 * the payload. mock.module BEFORE dynamic import.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { localDateOf } from '../../../../../src/domains/timesheet/utils/weekStart';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = 'Europe/London';
const FUTURE_START = new Date(Date.now() + 28 * DAY_MS).toISOString();
const FUTURE_END = new Date(
  Date.now() + 28 * DAY_MS + 9 * 60 * 60 * 1000
).toISOString();

const confirmedShift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: FUTURE_START,
  ends_at: FUTURE_END,
  timezone: TIMEZONE,
  local_date: localDateOf(new Date(FUTURE_START), TIMEZONE),
  kind: 'recurring',
  status: 'confirmed',
  source_pattern_id: null,
  origin: 'system_generated',
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
let insertMany: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
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
  insertMany = mock(async () => []);
});

function makeService() {
  return new ShiftCommandService(
    {} as never,
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
    { getOwned: mock(async () => confirmedShift) } as never,
    { insertMany } as never
  );
}

describe('ShiftCommandService.runningLate', () => {
  it('records a running_late event whose payload carries no minutes or ETA field', async () => {
    await makeService().runningLate('carer-1', 's1');

    expect(insertMany).toHaveBeenCalledTimes(1);
    const rows = insertMany.mock.calls[0]?.[0] as {
      event_type: string;
      payload: Record<string, unknown>;
    }[];
    expect(rows[0]?.event_type).toBe('running_late');
    const payload = rows[0]?.payload ?? {};
    expect(payload).not.toHaveProperty('minutes');
    expect(payload).not.toHaveProperty('minutes_late');
    expect(payload).not.toHaveProperty('eta');
    expect(payload).not.toHaveProperty('eta_at');
    expect(payload).not.toHaveProperty('expected_arrival');
  });

  it('pushes household parents with the carer name', async () => {
    await makeService().runningLate('carer-1', 's1');

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const pushPayload = notifyHouseholdParents.mock.calls[0]?.[1] as {
      body: string;
    };
    expect(pushPayload.body).toBe("H1 Nanny1 says she's running late.");
  });

  // The wire string shipped before it was registered in the shared push-type
  // union — pin it so registration stays a no-op for clients already out there.
  it('pushes the registered running_late type with an unchanged payload', async () => {
    await makeService().runningLate('carer-1', 's1');

    const pushPayload = notifyHouseholdParents.mock.calls[0]?.[1] as {
      data: Record<string, unknown>;
    };
    expect(pushPayload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.RUNNING_LATE,
      shiftId: 's1',
      householdId: 'h1',
    });
    expect(PUSH_NOTIFICATION_TYPES.RUNNING_LATE).toBe('running_late');
  });
});
