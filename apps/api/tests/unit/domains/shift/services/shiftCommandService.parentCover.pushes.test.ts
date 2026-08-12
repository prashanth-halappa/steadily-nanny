/**
 * Parent-cover push — carers get a quiet FYI with BOTH sentences.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { localDateOf } from '../../../../../src/domains/timesheet/utils/weekStart';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = 'Europe/London';
const COVER_START = new Date(Date.now() + 28 * DAY_MS).toISOString();
const COVER_END = new Date(
  Date.now() + 28 * DAY_MS + 2 * 60 * 60 * 1000 + 20 * 60 * 1000
).toISOString();
const NEXT_END = new Date(
  Date.now() + 28 * DAY_MS + 10 * 60 * 60 * 1000
).toISOString();
const COVER_LOCAL_DATE = localDateOf(new Date(COVER_START), TIMEZONE);

function formatPushTimePlain(instantIso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantIso));
  const hour = parts.find(part => part.type === 'hour')?.value ?? '0';
  const minute = parts.find(part => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

const household = {
  id: 'h1',
  name: 'Smiths',
  timezone: TIMEZONE,
};

const parentCoverShift = {
  id: 'pc1',
  household_id: 'h1',
  carer_id: null,
  starts_at: COVER_START,
  ends_at: COVER_END,
  timezone: TIMEZONE,
  local_date: COVER_LOCAL_DATE,
  kind: 'parent_cover' as const,
  status: 'confirmed' as const,
  source_pattern_id: null,
  origin: 'parent_cover' as const,
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'uid-pc1',
  sequence: 0,
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
  shift_children: [],
};

const carerShift = {
  id: 's-next',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: COVER_END,
  ends_at: NEXT_END,
  timezone: TIMEZONE,
  local_date: COVER_LOCAL_DATE,
  kind: 'recurring' as const,
  status: 'confirmed' as const,
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

function makeService() {
  return new ShiftCommandService(
    {
      findParentCoverInWindow: mock(async () => null),
      createShift: mock(async () => parentCoverShift),
      insertChildren: mock(async () => undefined),
      findByHouseholdAndLocalDate: mock(async () => [
        parentCoverShift,
        carerShift,
      ]),
    } as never,
    {
      findActiveMembership: mock(async () => ({
        id: 'm1',
        household_id: 'h1',
        user_id: 'parent-1',
        role: 'parent',
      })),
      listActiveByHousehold: mock(async () => [
        {
          id: 'm1',
          household_id: 'h1',
          user_id: 'parent-1',
          role: 'parent',
        },
        {
          id: 'm2',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
        },
      ]),
    } as never,
    { getOwned: mock(async () => parentCoverShift) } as never,
    { insertMany: mock(async () => []) } as never,
    {
      getOwned: mock(async () => ({ id: 'child-1', household_id: 'h1' })),
    } as never,
    {
      findById: mock(async () => household),
    } as never
  );
}

describe('ShiftCommandService.createParentCover — carer push', () => {
  it('notifies household carers with both the cover window and the planned start', async () => {
    await makeService().createParentCover('parent-1', 'h1', {
      starts_at: COVER_START,
      ends_at: COVER_END,
      child_id: 'child-1',
    });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
    const payload = notifyUser.mock.calls[0]?.[1] as { body: string };
    expect(payload.body).toContain('Parent is covering');
    expect(payload.body).toContain(formatPushTimePlain(COVER_START, TIMEZONE));
    expect(payload.body).toContain(formatPushTimePlain(COVER_END, TIMEZONE));
    expect(payload.body).toContain(
      `Your day starts ${formatPushTimePlain(COVER_END, TIMEZONE)} as planned`
    );
  });

  // The wire string shipped before it was registered in the shared push-type
  // union — pin it so registration stays a no-op for clients already out there.
  it('pushes the registered parent_covering type with an unchanged payload', async () => {
    await makeService().createParentCover('parent-1', 'h1', {
      starts_at: COVER_START,
      ends_at: COVER_END,
      child_id: 'child-1',
    });

    const payload = notifyUser.mock.calls[0]?.[1] as {
      data: Record<string, unknown>;
    };
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.PARENT_COVERING,
      shiftId: 'pc1',
      householdId: 'h1',
    });
    expect(PUSH_NOTIFICATION_TYPES.PARENT_COVERING).toBe('parent_covering');
  });
});
