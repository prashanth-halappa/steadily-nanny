/**
 * ShiftChangeRequestCommandService — create/respond/withdraw/extra-shift flows.
 */
import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  ChangeRequestNotPendingError,
  InvalidChangeRequestKindForRoleError,
  NotTheChangeRequestRequesterError,
  NotTheChangeRequestResponderError,
} from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { ShiftChangeRequestCommandService } from '../../../../../src/domains/shift/services/shiftChangeRequestCommandService';
import { ValidationError } from '../../../../../src/errors';

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
  status: 'pending' as const,
  responded_by: null,
  responded_at: null,
  created_at: 't',
  updated_at: 't',
};

function membershipFor(role: string, userId = 'u1') {
  return { id: 'm1', household_id: 'h1', user_id: userId, role };
}

function makeChangeRequestRepo(overrides: Record<string, unknown> = {}): any {
  return {
    createRequest: mock(async (data: Record<string, unknown>) => ({
      ...pendingRequest,
      ...data,
      id: 'cr-new',
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
    // Settled-reality guard: completed/cancelled shifts and shifts with time
    // entries are immutable. Open by default in these fakes.
    assertMutable: mock(async () => undefined),
    ...overrides,
  };
}

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    insertMany: mock(async () => undefined),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async (_h: string, userId: string) => {
      if (userId === 'carer-1') return membershipFor('nanny', 'carer-1');
      if (userId === 'parent-1') return membershipFor('parent', 'parent-1');
      if (userId === 'parent-2') return membershipFor('parent', 'parent-2');
      return membershipFor('parent', userId);
    }),
    ...overrides,
  };
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => pendingRequest),
    ...overrides,
  };
}

function makeShiftQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => shift),
    ...overrides,
  };
}

function makeGate(overrides: Record<string, unknown> = {}): any {
  return {
    assertApprovalAllows: mock(async () => ({ needsApproval: false })),
    ...overrides,
  };
}

function makeChildren(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => ({ id: 'child-1' })),
    ...overrides,
  };
}

function makeSvc(
  overrides: {
    changeRequestRepo?: any;
    shiftRepo?: any;
    eventRepo?: any;
    memberRepo?: any;
    householdRepo?: any;
    queries?: any;
    shiftQueries?: any;
    gate?: any;
    children?: any;
  } = {}
) {
  return new ShiftChangeRequestCommandService(
    overrides.changeRequestRepo ?? makeChangeRequestRepo(),
    overrides.shiftRepo ?? makeShiftRepo(),
    overrides.eventRepo ?? makeEventRepo(),
    overrides.memberRepo ?? makeMemberRepo(),
    overrides.householdRepo ?? makeHouseholdRepo(),
    overrides.queries ?? makeQueries(),
    overrides.shiftQueries ?? makeShiftQueries(),
    overrides.gate ?? makeGate(),
    overrides.children ?? makeChildren()
  );
}

describe('ShiftChangeRequestCommandService.create', () => {
  it('creates a pending cancel request for a parent and appends a day-thread event', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, eventRepo });

    const result = await svc.create('parent-1', 's1', {
      kind: 'cancel',
      message: 'Emergency',
    });

    expect(result.status).toBe('pending');
    if (result.status === 'pending') {
      expect(result.shift_change_request.kind).toBe('cancel');
    }
    expect(changeRequestRepo.createRequest).toHaveBeenCalled();
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: 'change_request_created' }),
    ]);
  });

  it('returns pending_approval without creating a request when the gate requires co-parent sign-off', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const gate = makeGate({
      assertApprovalAllows: mock(async () => ({
        needsApproval: true,
        approval: { id: 'ap1', action: 'cancel' },
      })),
    });
    const householdRepo = makeHouseholdRepo({
      findById: mock(async () => ({
        ...household,
        short_notice_hours: 9999,
      })),
    });
    const shiftQueries = makeShiftQueries({
      getOwned: mock(async () => ({
        ...shift,
        starts_at: new Date(Date.now() + 3600_000).toISOString(),
      })),
    });
    const svc = makeSvc({
      changeRequestRepo,
      gate,
      householdRepo,
      shiftQueries,
    });

    const result = await svc.create('parent-1', 's1', { kind: 'cancel' });

    expect(result.status).toBe('pending_approval');
    if (result.status === 'pending_approval') {
      expect(result.approval.id).toBe('ap1');
      expect(result.approval.action).toBe('cancel');
    }
    expect(changeRequestRepo.createRequest).not.toHaveBeenCalled();
  });

  it('rejects a nanny opening a parent-only kind', async () => {
    const svc = makeSvc();
    await expect(
      svc.create('carer-1', 's1', { kind: 'cancel' })
    ).rejects.toBeInstanceOf(InvalidChangeRequestKindForRoleError);
  });

  it('allows a nanny counter-offer with proposed times', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({ changeRequestRepo });

    await svc.create('carer-1', 's1', {
      kind: 'counter_offer',
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    });

    expect(changeRequestRepo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'counter_offer',
        requested_by: 'carer-1',
      })
    );
  });

  it('requires proposed times for time_change', async () => {
    const svc = makeSvc();
    await expect(
      svc.create('parent-1', 's1', { kind: 'time_change' })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ShiftChangeRequestCommandService.create — settled-shift guard', () => {
  it('refuses to open a request against a settled shift, rather than 409ing later on accept', async () => {
    // A completed/cancelled shift, or one with time entries behind it, is
    // paid-for reality. Rejecting at open time keeps a misleading pending row
    // out of the day thread entirely.
    const shiftRepo = makeShiftRepo({
      assertMutable: mock(async () => {
        throw new Error('shift is immutable');
      }),
    });
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({ shiftRepo, changeRequestRepo });

    await expect(
      svc.create('u1', 's1', { kind: 'cancel' } as any)
    ).rejects.toThrow('shift is immutable');
    expect(changeRequestRepo.createRequest).not.toHaveBeenCalled();
  });
});

describe('ShiftChangeRequestCommandService.createExtraShift', () => {
  it('creates a pending extra shift with parent_proposed origin', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ shiftRepo, eventRepo });

    const result = await svc.createExtraShift('parent-1', 'h1', {
      starts_at: '2026-08-04T08:00:00.000Z',
      ends_at: '2026-08-04T12:00:00.000Z',
      timezone: 'Europe/London',
      reason: 'Date night',
      carer_id: 'carer-1',
      child_ids: ['child-1'],
    });

    expect(shiftRepo.createShift).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'extra',
        status: 'pending',
        origin: 'parent_proposed',
        reason: 'Date night',
        carer_id: 'carer-1',
      })
    );
    expect(shiftRepo.insertChildren).toHaveBeenCalledWith('s-extra', [
      'child-1',
    ]);
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: 'extra_shift_proposed' }),
    ]);
    expect(result.id).toBe('s-extra');
  });

  it('rejects a nanny proposing an extra shift', async () => {
    const svc = makeSvc();
    await expect(
      svc.createExtraShift('carer-1', 'h1', {
        starts_at: '2026-08-04T08:00:00.000Z',
        ends_at: '2026-08-04T12:00:00.000Z',
        timezone: 'Europe/London',
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('ShiftChangeRequestCommandService.respond', () => {
  it('lets the assigned carer accept a parent cancel and cancels the shift', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ shiftRepo, eventRepo });

    const result = await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(shiftRepo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'cancelled',
        cancelled_by: 'carer-1',
        origin: 'parent_proposed',
      })
    );
    expect(eventRepo.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'change_request_accepted' }),
        expect.objectContaining({ event_type: 'shift_cancelled' }),
      ])
    );
    expect(result.shift?.status).toBe('cancelled');
  });

  it('lets a parent accept a nanny counter-offer and updates shift times', async () => {
    const counterRequest = {
      ...pendingRequest,
      requested_by: 'carer-1',
      kind: 'counter_offer' as const,
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    };
    const shiftRepo = makeShiftRepo();
    const svc = makeSvc({
      queries: makeQueries({
        getOwned: mock(async () => counterRequest),
      }),
      shiftRepo,
    });

    await svc.respond('parent-2', 'cr1', { status: 'accepted' });

    expect(shiftRepo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        starts_at: '2026-08-03T09:00:00.000Z',
        ends_at: '2026-08-03T18:00:00.000Z',
        origin: 'nanny_countered',
        sequence: 1,
      })
    );
  });

  it('rejects respond when the caller is not the designated responder', async () => {
    const svc = makeSvc();
    await expect(
      svc.respond('parent-2', 'cr1', { status: 'accepted' })
    ).rejects.toBeInstanceOf(NotTheChangeRequestResponderError);
  });

  it('rejects respond on a non-pending request', async () => {
    const svc = makeSvc({
      queries: makeQueries({
        getOwned: mock(async () => ({
          ...pendingRequest,
          status: 'accepted',
        })),
      }),
    });
    await expect(
      svc.respond('carer-1', 'cr1', { status: 'declined' })
    ).rejects.toBeInstanceOf(ChangeRequestNotPendingError);
  });
});

describe('ShiftChangeRequestCommandService.withdraw', () => {
  it('lets the requester withdraw a pending request', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, eventRepo });

    const result = await svc.withdraw('parent-1', 'cr1');

    expect(result.status).toBe('withdrawn');
    expect(changeRequestRepo.withdraw).toHaveBeenCalledWith('cr1');
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: 'change_request_withdrawn' }),
    ]);
  });

  it('rejects withdraw by someone other than the requester', async () => {
    const svc = makeSvc();
    await expect(svc.withdraw('parent-2', 'cr1')).rejects.toBeInstanceOf(
      NotTheChangeRequestRequesterError
    );
  });
});

describe('ShiftChangeRequestCommandService.applyApprovedChangeRequest', () => {
  // Regression for flow 1f: the gate parks the request on the approval and
  // returns `needsApproval`, so `create` never opens it. Approving used to
  // flip the row's status and nothing more — the change silently never
  // happened. This is the path that resumes it.
  function approvalFor(overrides: Record<string, unknown> = {}): any {
    return {
      id: 'a1',
      household_id: 'h1',
      requested_by: 'u1',
      action: 'cancel',
      payload: {
        shift_id: 's1',
        kind: 'cancel',
        proposed_starts_at: null,
        proposed_ends_at: null,
        message: 'nursery closed',
      },
      status: 'approved',
      timeout_at: '2999-01-01T00:00:00Z',
      responded_by: 'u2',
      responded_at: 't',
      created_at: 't',
      updated_at: 't',
      ...overrides,
    };
  }

  it('opens the parked request against the shift, attributed to the ORIGINAL requester', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, eventRepo });

    await svc.applyApprovedChangeRequest(approvalFor());

    expect(changeRequestRepo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        shift_id: 's1',
        // the requester, NOT the parent who approved
        requested_by: 'u1',
        kind: 'cancel',
        message: 'nursery closed',
      })
    );
    expect(eventRepo.insertMany).toHaveBeenCalled();
  });

  it('does NOT apply the change to the shift itself — the nanny still gets to respond', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = makeSvc({ shiftRepo });

    await svc.applyApprovedChangeRequest(approvalFor());

    expect(shiftRepo.update).not.toHaveBeenCalled();
  });

  it('re-checks access as the original requester, so an approval outlives their membership safely', async () => {
    const shiftQueries = makeShiftQueries();
    const svc = makeSvc({ shiftQueries });

    await svc.applyApprovedChangeRequest(approvalFor());

    expect(shiftQueries.getOwned).toHaveBeenCalledWith('u1', 's1');
  });

  it('refuses a payload that lost the shift it was gating', async () => {
    const svc = makeSvc();
    await expect(
      svc.applyApprovedChangeRequest(approvalFor({ payload: {} }))
    ).rejects.toThrow();
  });

  it('refuses to act when the requesting parent has been deleted', async () => {
    const svc = makeSvc();
    await expect(
      svc.applyApprovedChangeRequest(approvalFor({ requested_by: null }))
    ).rejects.toThrow();
  });
});
