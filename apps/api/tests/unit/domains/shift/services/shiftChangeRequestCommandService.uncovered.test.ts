/**
 * Cancel-accept uncovered-care detection — suppresses SHIFT_CANCELLED when
 * the day is genuinely uncovered.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

const household = {
  id: 'h1',
  name: 'Smiths',
  timezone: 'Europe/London',
  approval_mode: 'either' as const,
  approval_scope: 'short_notice_and_cancellations' as const,
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
};

const shift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  local_date: '2026-08-03',
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

const pendingRequest = {
  id: 'cr1',
  shift_id: 's1',
  requested_by: 'parent-1',
  kind: 'cancel' as const,
  proposed_starts_at: null,
  proposed_ends_at: null,
  message: 'Cannot make it',
  response_message: null,
  status: 'pending' as const,
  responded_by: null,
  responded_at: null,
  created_at: 't',
  updated_at: 't',
};

function membershipFor(role: string, userId = 'u1') {
  return { id: 'm1', household_id: 'h1', user_id: userId, role };
}

let ShiftChangeRequestCommandService: typeof import('../../../../../src/domains/shift/services/shiftChangeRequestCommandService').ShiftChangeRequestCommandService;
let setCancellationPaidEntryRecorder: typeof import('../../../../../src/domains/shift/services/shiftChangeRequestCommandService').setCancellationPaidEntryRecorder;
let detectUncoveredCareForDate: ReturnType<typeof mock>;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

const NOTHING = { inserted: [], pushed: [] };

beforeAll(async () => {
  detectUncoveredCareForDate = mock(async () => NOTHING);
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate,
      detectUncoveredCareBestEffort: mock(() => undefined),
    })
  );
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents,
  }));

  ({ ShiftChangeRequestCommandService, setCancellationPaidEntryRecorder } =
    await import(
      '../../../../../src/domains/shift/services/shiftChangeRequestCommandService'
    ));
  setCancellationPaidEntryRecorder(async () => null);
});

beforeEach(() => {
  detectUncoveredCareForDate.mockClear();
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
  detectUncoveredCareForDate.mockImplementation(async () => NOTHING);
  setCancellationPaidEntryRecorder(async () => null);
});

function makeChangeRequestRepo(overrides: Record<string, unknown> = {}): any {
  return {
    acceptAndApply: mock(async () => ({
      changeRequest: { ...pendingRequest, status: 'accepted' },
      shift: { ...shift, status: 'cancelled' },
      superseded: [],
    })),
    respond: mock(async () => pendingRequest),
    ...overrides,
  };
}

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    assertMutable: mock(async () => undefined),
    findByIdWithChildren: mock(async () => shift),
    ...overrides,
  };
}

function makeSvc(overrides: Record<string, unknown> = {}) {
  return new ShiftChangeRequestCommandService(
    (overrides.changeRequestRepo ?? makeChangeRequestRepo()) as any,
    (overrides.shiftRepo ?? makeShiftRepo()) as any,
    (overrides.eventRepo ?? { insertMany: mock(async () => []) }) as any,
    (overrides.memberRepo ?? {
      findActiveMembership: mock(async (_h: string, userId: string) => {
        if (userId === 'carer-1') return membershipFor('nanny', 'carer-1');
        if (userId === 'parent-1') return membershipFor('parent', 'parent-1');
        return membershipFor('parent', userId);
      }),
    }) as any,
    (overrides.householdRepo ?? {
      findById: mock(async () => household),
    }) as any,
    (overrides.queries ?? {
      getOwned: mock(async () => pendingRequest),
    }) as any,
    (overrides.shiftQueries ?? { getOwned: mock(async () => shift) }) as any,
    (overrides.gate ?? {
      assertApprovalAllows: mock(async () => undefined),
    }) as any,
    (overrides.children ?? {
      getOwned: mock(async () => ({ id: 'child-1' })),
    }) as any,
    (overrides.payArrangementRepo ?? {
      effectiveOn: mock(async () => null),
    }) as any
  );
}

describe('ShiftChangeRequestCommandService.cancel — uncovered detection', () => {
  it('calls detection with cause cancelled on cancel accept', async () => {
    await makeSvc().respond('carer-1', 'cr1', { status: 'accepted' });

    expect(detectUncoveredCareForDate).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        localDate: '2026-08-03',
        cause: 'cancelled',
        actorId: 'carer-1',
      })
    );
  });

  it('suppresses shift_cancelled when uncovered windows were pushed', async () => {
    const window = {
      childId: 'c1',
      commitmentId: 'cm1',
      startsAt: '2026-08-03T09:00:00.000Z',
      endsAt: '2026-08-03T12:00:00.000Z',
    };
    detectUncoveredCareForDate.mockImplementation(async () => ({
      inserted: [window],
      pushed: [window],
    }));

    await makeSvc().respond('carer-1', 'cr1', { status: 'accepted' });

    const cancelledCalls = notifyHouseholdParents.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as { data?: { type?: string } })?.data?.type ===
        PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED
    );
    expect(cancelledCalls).toHaveLength(0);
  });

  it('still fires shift_cancelled when a window was inserted but gated to the digest (nobody heard anything otherwise)', async () => {
    detectUncoveredCareForDate.mockImplementation(async () => ({
      inserted: [
        {
          childId: 'c1',
          commitmentId: 'cm1',
          startsAt: '2026-08-13T09:00:00.000Z',
          endsAt: '2026-08-13T12:00:00.000Z',
        },
      ],
      pushed: [],
    }));

    await makeSvc().respond('carer-1', 'cr1', { status: 'accepted' });

    const cancelledCalls = notifyHouseholdParents.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as { data?: { type?: string } })?.data?.type ===
        PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED
    );
    expect(cancelledCalls).toHaveLength(1);
  });

  it('fires shift_cancelled when the day is still covered', async () => {
    await makeSvc().respond('carer-1', 'cr1', { status: 'accepted' });

    const cancelledCalls = notifyHouseholdParents.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as { data?: { type?: string } })?.data?.type ===
        PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED
    );
    expect(cancelledCalls).toHaveLength(1);
  });

  it('still pings carer requester with CHANGE_REQUEST_ACCEPTED when uncovered', async () => {
    const carerRequest = { ...pendingRequest, requested_by: 'carer-1' };
    const window = {
      childId: 'c1',
      commitmentId: 'cm1',
      startsAt: '2026-08-03T09:00:00.000Z',
      endsAt: '2026-08-03T12:00:00.000Z',
    };
    detectUncoveredCareForDate.mockImplementation(async () => ({
      inserted: [window],
      pushed: [window],
    }));
    const svc = makeSvc({
      changeRequestRepo: makeChangeRequestRepo({
        acceptAndApply: mock(async () => ({
          changeRequest: { ...carerRequest, status: 'accepted' },
          shift: { ...shift, status: 'cancelled' },
          superseded: [],
        })),
      }),
      queries: { getOwned: mock(async () => carerRequest) },
    });

    await svc.respond('parent-1', 'cr1', { status: 'accepted' });

    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED,
        }),
      })
    );
  });
});
