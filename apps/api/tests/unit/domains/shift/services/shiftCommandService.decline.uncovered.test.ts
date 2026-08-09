/**
 * Decline uncovered-care detection — suppresses SHIFT_DECLINED when the day
 * is genuinely uncovered.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

const pendingShift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
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
  shift_children: [],
};

let ShiftCommandService: typeof import('../../../../../src/domains/shift/services/shiftCommandService').ShiftCommandService;
let detectUncoveredCareForDate: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  detectUncoveredCareForDate = mock(async () => []);
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate,
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
  detectUncoveredCareForDate.mockClear();
  notifyHouseholdParents.mockClear();
  detectUncoveredCareForDate.mockImplementation(async () => []);
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
      })),
    } as never,
    { getOwned: mock(async () => pendingShift) } as never,
    { insertMany: mock(async () => []) } as never
  );
}

describe('ShiftCommandService.decline — uncovered detection', () => {
  it('calls detection with cause declined', async () => {
    await makeService().decline('carer-1', 's1');

    expect(detectUncoveredCareForDate).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        localDate: '2026-08-03',
        cause: 'declined',
        actorId: 'carer-1',
      })
    );
  });

  it('suppresses shift_declined when uncovered windows were inserted', async () => {
    detectUncoveredCareForDate.mockImplementation(async () => [
      {
        childId: 'c1',
        commitmentId: 'cm1',
        startsAt: '2026-08-03T09:00:00.000Z',
        endsAt: '2026-08-03T12:00:00.000Z',
      },
    ]);

    await makeService().decline('carer-1', 's1');

    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('fires shift_declined when the day is still covered', async () => {
    await makeService().decline('carer-1', 's1');

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED,
        }),
      })
    );
  });
});
