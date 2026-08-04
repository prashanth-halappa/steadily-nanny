/**
 * Response-leg pushes for change-request / extra-shift flows (Wave 1A),
 * plus paid-cancel recorder seam (Wave 4B).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

const loggerError = mock(() => undefined);

const household = {
  id: 'h1',
  name: 'Smiths',
  timezone: 'Europe/London',
  approval_mode: 'ask_other' as const,
  approval_scope: 'short_notice_and_cancellations' as const,
  approval_timeout_minutes: 60,
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
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents,
  }));
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: {
      info: mock(() => undefined),
      error: loggerError,
      warn: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));

  ({ ShiftChangeRequestCommandService, setCancellationPaidEntryRecorder } =
    await import(
      '../../../../../src/domains/shift/services/shiftChangeRequestCommandService'
    ));
  // Avoid loading the timesheet domain (and hanging on unmocked repos) in
  // this push-focused suite — cancellation-pay has its own timesheet tests.
  setCancellationPaidEntryRecorder(async () => null);
});

beforeEach(() => {
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
  loggerError.mockClear();
  // Reset seam so push cases never inherit a throwing recorder from a
  // prior paid-cancel assertion.
  setCancellationPaidEntryRecorder(async () => null);
});

function makeChangeRequestRepo(overrides: Record<string, unknown> = {}): any {
  return {
    openWithSupersede: mock(async () => ({
      changeRequest: { ...pendingRequest, id: 'cr-new' },
      superseded: [],
    })),
    acceptAndApply: mock(async () => ({
      changeRequest: { ...pendingRequest, status: 'accepted' },
      shift: { ...shift, status: 'cancelled', cancellation_paid: true },
      superseded: [],
    })),
    respond: mock(async (_id: string, status: string) => ({
      ...pendingRequest,
      status,
      responded_by: 'carer-1',
      responded_at: 'now',
    })),
    withdraw: mock(async () => ({ ...pendingRequest, status: 'withdrawn' })),
    ...overrides,
  };
}

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    createShift: mock(async (data: Record<string, unknown>) => ({
      ...shift,
      ...data,
      id: 's-extra',
    })),
    insertChildren: mock(async () => undefined),
    findByIdWithChildren: mock(async () => ({
      ...shift,
      id: 's-extra',
      kind: 'extra',
      status: 'pending',
      shift_children: [],
    })),
    update: mock(async (_id: string, data: Record<string, unknown>) => ({
      ...shift,
      ...data,
    })),
    assertMutable: mock(async () => undefined),
    ...overrides,
  };
}

function makeSvc(overrides: Record<string, unknown> = {}) {
  return new ShiftChangeRequestCommandService(
    (overrides.changeRequestRepo ?? makeChangeRequestRepo()) as any,
    (overrides.shiftRepo ?? makeShiftRepo()) as any,
    (overrides.eventRepo ?? {
      insertMany: mock(async () => undefined),
    }) as any,
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
    (overrides.shiftQueries ?? {
      getOwned: mock(async () => shift),
    }) as any,
    (overrides.gate ?? {
      assertApprovalAllows: mock(async () => ({ needsApproval: false })),
    }) as any,
    (overrides.children ?? {
      getOwned: mock(async () => ({ id: 'child-1' })),
    }) as any
  );
}

describe('response-leg pushes', () => {
  it('fires change_request_accepted exactly once on accept', async () => {
    const timeRequest = {
      ...pendingRequest,
      kind: 'time_change' as const,
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    };
    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...timeRequest, status: 'accepted' },
        shift: {
          ...shift,
          starts_at: timeRequest.proposed_starts_at,
          ends_at: timeRequest.proposed_ends_at,
        },
        superseded: [],
      })),
    });
    const svc = makeSvc({
      changeRequestRepo,
      queries: { getOwned: mock(async () => timeRequest) },
    });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED,
          changeRequestId: 'cr1',
          shiftId: 's1',
        }),
      })
    );
  });

  it('fires shift_cancelled exactly once on cancel accept', async () => {
    const svc = makeSvc();

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    const cancelledCalls = notifyHouseholdParents.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as { data?: { type?: string } })?.data?.type ===
        PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED
    );
    expect(cancelledCalls).toHaveLength(1);
  });

  it('does not double-notify a parent requester on paid/cancel accept', async () => {
    // Parent opened cancel → carer accepts: SHIFT_CANCELLED covers parents;
    // CHANGE_REQUEST_ACCEPTED must not also ping the requester.
    const svc = makeSvc();

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(notifyUser).not.toHaveBeenCalled();
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
        }),
      })
    );
  });

  it('still pings a carer requester with ACCEPTED on cancel accept', async () => {
    const carerRequest = {
      ...pendingRequest,
      requested_by: 'carer-1',
    };
    const svc = makeSvc({
      queries: { getOwned: mock(async () => carerRequest) },
      changeRequestRepo: makeChangeRequestRepo({
        acceptAndApply: mock(async () => ({
          changeRequest: { ...carerRequest, status: 'accepted' },
          shift: { ...shift, status: 'cancelled', cancellation_paid: true },
          superseded: [],
        })),
      }),
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

  it('fires change_request_declined exactly once on decline', async () => {
    const svc = makeSvc();

    await svc.respond('carer-1', 'cr1', { status: 'declined' });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED,
        }),
      })
    );
  });

  it('fires change_request_withdrawn exactly once on withdraw', async () => {
    const svc = makeSvc();

    await svc.withdraw('parent-1', 'cr1');

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_WITHDRAWN,
        }),
      })
    );
  });

  it('fires extra_shift_proposed exactly once when an extra shift is created', async () => {
    const svc = makeSvc();

    await svc.createExtraShift('parent-1', 'h1', {
      starts_at: '2026-08-04T08:00:00.000Z',
      ends_at: '2026-08-04T12:00:00.000Z',
      timezone: 'Europe/London',
      carer_id: 'carer-1',
    });

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED,
          shiftId: 's-extra',
        }),
      })
    );
  });

  it('push failure never fails respond HTTP path', async () => {
    notifyUser.mockImplementation(() => {
      throw new Error('push boom');
    });
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('push boom');
    });
    const svc = makeSvc();

    const result = await svc.respond('carer-1', 'cr1', { status: 'declined' });
    expect(result.shift_change_request.status).toBe('declined');
  });
});

describe('paid-cancel recorder', () => {
  it('calls the recorder with the updated shift on paid cancel accept', async () => {
    const recorder = mock(async () => null);
    setCancellationPaidEntryRecorder(recorder);

    const cancelledShift = {
      ...shift,
      status: 'cancelled' as const,
      cancellation_paid: true,
    };
    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...pendingRequest, status: 'accepted' },
        shift: cancelledShift,
        superseded: [],
      })),
    });
    const svc = makeSvc({ changeRequestRepo });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 's1',
        household_id: 'h1',
        cancellation_paid: true,
        status: 'cancelled',
        shift_children: [],
      })
    );
  });

  it('does not call the recorder when cancellation_paid is false', async () => {
    const recorder = mock(async () => null);
    setCancellationPaidEntryRecorder(recorder);

    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...pendingRequest, status: 'accepted' },
        shift: { ...shift, status: 'cancelled', cancellation_paid: false },
        superseded: [],
      })),
    });
    const svc = makeSvc({ changeRequestRepo });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(recorder).not.toHaveBeenCalled();
  });

  it('swallows recorder throw + logs — accept still succeeds', async () => {
    const recorder = mock(async () => {
      throw new Error('payroll boom');
    });
    setCancellationPaidEntryRecorder(recorder);

    // Default acceptAndApply already returns cancellation_paid: true.
    const svc = makeSvc();
    const result = await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(result.shift_change_request.status).toBe('accepted');
    expect(recorder).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      'Failed to record cancellation_paid time entry',
      expect.objectContaining({
        shiftId: 's1',
        error: 'payroll boom',
      })
    );
  });
});
