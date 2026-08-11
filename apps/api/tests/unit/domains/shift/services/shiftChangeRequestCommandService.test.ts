/**
 * ShiftChangeRequestCommandService — create/respond/withdraw/extra-shift flows.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  ChangeRequestNotPendingError,
  ExtraShiftAlreadyExistsError,
  InvalidChangeRequestKindForRoleError,
  NotTheChangeRequestRequesterError,
  NotTheChangeRequestResponderError,
  ShiftImmutableError,
} from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { ValidationError } from '../../../../../src/errors';

let ShiftChangeRequestCommandService: typeof import('../../../../../src/domains/shift/services/shiftChangeRequestCommandService').ShiftChangeRequestCommandService;
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
  ({ ShiftChangeRequestCommandService } = await import(
    '../../../../../src/domains/shift/services/shiftChangeRequestCommandService'
  ));
});

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

function makeChangeRequestRepo(overrides: Record<string, unknown> = {}): any {
  return {
    openWithSupersede: mock(async (args: Record<string, unknown>) => ({
      changeRequest: {
        ...pendingRequest,
        ...args,
        id: 'cr-new',
      },
      superseded: [],
    })),
    acceptAndApply: mock(async () => ({
      changeRequest: { ...pendingRequest, status: 'accepted' },
      shift: { ...shift, status: 'cancelled' },
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
    // Settled-reality guard: completed/cancelled shifts and shifts with time
    // entries are immutable. Open by default in these fakes.
    assertMutable: mock(async () => undefined),
    // Retry guard for `insertExtraShift` — nothing pre-existing by default.
    findExtraShiftInWindow: mock(async () => null),
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
    listActiveByHousehold: mock(async (householdId: string) => [
      {
        ...membershipFor('parent', 'parent-1'),
        household_id: householdId,
        display_name_override: 'Alex',
        profile_name: null,
      },
    ]),
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
    assertApprovalAllows: mock(async () => undefined),
    ...overrides,
  };
}

function makeChildren(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => ({ id: 'child-1' })),
    ...overrides,
  };
}

// Arm 3 by default (no arrangement) — the pre-existing household-fallback
// behaviour every non-cancellation-focused test in this file relies on.
function makePayArrangementRepo(overrides: Record<string, unknown> = {}): any {
  return {
    effectiveOn: mock(async () => null),
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
    payArrangementRepo?: any;
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
    overrides.children ?? makeChildren(),
    overrides.payArrangementRepo ?? makePayArrangementRepo()
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
    expect(changeRequestRepo.openWithSupersede).toHaveBeenCalled();
    // The day-thread events are inserted inside the open RPC's transaction
    // (migration 030). A second round-trip from here is the D23/D24 crash
    // window: a crash between the two writes leaves a change request with no
    // audit trail.
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
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

    expect(changeRequestRepo.openWithSupersede).toHaveBeenCalledWith(
      expect.objectContaining({
        p_kind: 'counter_offer',
        p_requested_by: 'carer-1',
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
    expect(changeRequestRepo.openWithSupersede).not.toHaveBeenCalled();
  });
});

describe('ShiftChangeRequestCommandService.createExtraShift', () => {
  const extraInput = {
    starts_at: '2026-08-04T08:00:00.000Z',
    ends_at: '2026-08-04T12:00:00.000Z',
    timezone: 'Europe/London',
    reason: 'Date night',
    carer_id: 'carer-1',
    child_ids: ['child-1'],
    note: 'pick up from school',
  };

  it('creates a pending extra shift with parent_proposed origin', async () => {
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const gate = makeGate();
    const svc = makeSvc({ shiftRepo, eventRepo, gate });

    const result = await svc.createExtraShift('parent-1', 'h1', extraInput);

    expect(gate.assertApprovalAllows).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h1' }),
      expect.objectContaining({ user_id: 'parent-1', role: 'parent' }),
      'extra_shift',
      {
        starts_at: extraInput.starts_at,
        ends_at: extraInput.ends_at,
        timezone: extraInput.timezone,
        carer_id: 'carer-1',
        child_ids: ['child-1'],
        note: 'pick up from school',
        reason: 'Date night',
      }
    );
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
    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.shift.id).toBe('s-extra');
      // A genuine create — the client may safely say "proposed" and the carer
      // has been pushed.
      expect(result.adopted).toBe(false);
    }
  });

  // The pre-check early-return path: nothing new was written, so the caller
  // must be able to tell this apart from a create without diffing ids.
  it('flags adopted when the pre-check found the shift already there', async () => {
    const existing = {
      ...shift,
      id: 's-existing',
      kind: 'extra' as const,
      status: 'pending' as const,
      shift_children: [],
    };
    const shiftRepo = makeShiftRepo({
      findExtraShiftInWindow: mock(async () => existing),
    });
    const svc = makeSvc({ shiftRepo });

    const result = await svc.createExtraShift('parent-1', 'h1', extraInput);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.shift.id).toBe('s-existing');
      expect(result.adopted).toBe(true);
    }
    expect(shiftRepo.createShift).not.toHaveBeenCalled();
  });

  // Migration 059's unique index is what makes the check-then-act guard above
  // actually hold under a double-tap: both taps read an empty window, both
  // insert, and the DB refuses the loser with a 23505. Without adoption the
  // loser's parent sees a 500 for a shift that DID get created.
  it('adopts the winner when a concurrent create lost the 059 race', async () => {
    const winner = {
      ...shift,
      id: 's-winner',
      kind: 'extra' as const,
      status: 'pending' as const,
      shift_children: [],
    };
    let lookups = 0;
    const shiftRepo = makeShiftRepo({
      findExtraShiftInWindow: mock(async () => {
        lookups += 1;
        // First call is the pre-check, which loses the race and sees nothing.
        return lookups === 1 ? null : winner;
      }),
      createShift: mock(async () => {
        throw new ExtraShiftAlreadyExistsError({
          householdId: 'h1',
          startsAt: extraInput.starts_at,
          endsAt: extraInput.ends_at,
          carerId: 'carer-1',
        });
      }),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ shiftRepo, eventRepo });

    const result = await svc.createExtraShift('parent-1', 'h1', extraInput);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.shift.id).toBe('s-winner');
      expect(result.adopted).toBe(true);
    }
    // The winner's own call wrote the children and the day-thread event.
    // Writing them again would double the child rows and post the shift to the
    // thread twice.
    expect(shiftRepo.insertChildren).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  // Adoption only makes sense if a winner is actually there. If the re-read
  // comes back empty the DB and the lookup disagree — swallowing that would
  // return a shift nobody can see, so the conflict must surface.
  it('rethrows when the 23505 winner cannot be found on re-read', async () => {
    const shiftRepo = makeShiftRepo({
      createShift: mock(async () => {
        throw new ExtraShiftAlreadyExistsError({
          householdId: 'h1',
          startsAt: extraInput.starts_at,
          endsAt: extraInput.ends_at,
          carerId: 'carer-1',
        });
      }),
    });
    const svc = makeSvc({ shiftRepo });

    await expect(
      svc.createExtraShift('parent-1', 'h1', extraInput)
    ).rejects.toBeInstanceOf(ExtraShiftAlreadyExistsError);
  });

  it('rejects a nanny proposing an extra shift before consulting the gate', async () => {
    const gate = makeGate();
    const svc = makeSvc({ gate });
    await expect(
      svc.createExtraShift('carer-1', 'h1', {
        starts_at: '2026-08-04T08:00:00.000Z',
        ends_at: '2026-08-04T12:00:00.000Z',
        timezone: 'Europe/London',
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(gate.assertApprovalAllows).not.toHaveBeenCalled();
  });
});

describe('ShiftChangeRequestCommandService — co-parent FYI pushes', () => {
  async function flushFyi(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
  }

  function shortNoticeShiftQueries() {
    return makeShiftQueries({
      getOwned: mock(async () => ({
        ...shift,
        starts_at: new Date(Date.now() + 3600_000).toISOString(),
      })),
    });
  }

  beforeEach(() => {
    notifyHouseholdParents.mockClear();
  });

  it('notifies other parents after a short-notice cancel clears the gate', async () => {
    const svc = makeSvc({ shiftQueries: shortNoticeShiftQueries() });

    await svc.create('parent-1', 's1', {
      kind: 'cancel',
      message: 'Emergency',
    });
    await flushFyi();

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI,
          shiftId: 's1',
          householdId: 'h1',
          action: 'cancel',
        }),
      }),
      { excludeUserId: 'parent-1' }
    );
  });

  it('notifies other parents after a short-notice time_change clears the gate', async () => {
    const svc = makeSvc({ shiftQueries: shortNoticeShiftQueries() });

    await svc.create('parent-1', 's1', {
      kind: 'time_change',
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    });
    await flushFyi();

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI,
          action: 'short_notice_change',
        }),
      }),
      { excludeUserId: 'parent-1' }
    );
  });

  it('notifies other parents after an extra shift clears the gate', async () => {
    const svc = makeSvc();

    await svc.createExtraShift('parent-1', 'h1', {
      starts_at: '2026-08-04T08:00:00.000Z',
      ends_at: '2026-08-04T12:00:00.000Z',
      timezone: 'Europe/London',
      carer_id: 'carer-1',
    });
    await flushFyi();

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI,
          action: 'extra_shift',
        }),
      }),
      { excludeUserId: 'parent-1' }
    );
  });
});

describe('ShiftChangeRequestCommandService.respond', () => {
  it('lets the assigned carer accept a parent cancel and cancels the shift', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const shiftRepo = makeShiftRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, shiftRepo, eventRepo });

    const result = await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledWith(
      expect.objectContaining({
        p_change_request_id: 'cr1',
        p_responded_by: 'carer-1',
        p_set_cancel: true,
        p_cancellation_message: 'Cannot make it',
        p_events: expect.arrayContaining([
          expect.objectContaining({ event_type: 'change_request_accepted' }),
          expect.objectContaining({ event_type: 'shift_cancelled' }),
        ]),
      })
    );
    expect(shiftRepo.update).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(result.shift?.status).toBe('cancelled');
  });

  it('sends no local_date on accept-path events — the RPC resolves the day thread from the updated shift row', async () => {
    const timeRequest = {
      ...pendingRequest,
      kind: 'time_change' as const,
      proposed_starts_at: '2026-08-04T13:00:00.000Z',
      proposed_ends_at: '2026-08-04T21:00:00.000Z',
    };
    const shiftBefore = {
      ...shift,
      local_date: '2026-08-03',
      starts_at: '2026-08-03T13:00:00.000Z',
      ends_at: '2026-08-03T21:00:00.000Z',
      shift_children: [{ shift_id: 's1', child_id: 'child-1' }],
    };
    const shiftAfter = {
      ...shiftBefore,
      local_date: '2026-08-04',
      starts_at: timeRequest.proposed_starts_at,
      ends_at: timeRequest.proposed_ends_at,
    };
    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...timeRequest, status: 'accepted' },
        shift: shiftAfter,
        superseded: [],
      })),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({
      queries: makeQueries({
        getOwned: mock(async () => timeRequest),
      }),
      shiftQueries: makeShiftQueries({
        getOwned: mock(async () => shiftBefore),
      }),
      changeRequestRepo,
      eventRepo,
    });

    const result = await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    // The day thread an accepted change lands on is the DB's to decide: only
    // the RPC holds the post-update row, whose `local_date` the
    // `sync_shifts_local_date` trigger recomputes from the new `starts_at`.
    // The service must therefore not send a `local_date` it cannot resolve —
    // a required field the RPC ignores is a trap for the next caller.
    const events = changeRequestRepo.acceptAndApply.mock.calls[0][0].p_events;
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'change_request_accepted' }),
        expect.objectContaining({ event_type: 'shift_updated' }),
      ])
    );
    for (const event of events) {
      expect(event).not.toHaveProperty('local_date');
    }

    // Cross-midnight semantics, documented: the shift moved to 08-04, so its
    // audit trail follows it there rather than stranding history on 08-03.
    expect(result.shift?.local_date).toBe('2026-08-04');
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  it('lets a parent accept a nanny counter-offer and updates shift times', async () => {
    const counterRequest = {
      ...pendingRequest,
      requested_by: 'carer-1',
      kind: 'counter_offer' as const,
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    };
    const changeRequestRepo = makeChangeRequestRepo();
    const shiftRepo = makeShiftRepo();
    const svc = makeSvc({
      queries: makeQueries({
        getOwned: mock(async () => counterRequest),
      }),
      changeRequestRepo,
      shiftRepo,
    });

    await svc.respond('parent-2', 'cr1', { status: 'accepted' });

    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledWith(
      expect.objectContaining({
        p_set_times: true,
        p_starts_at: '2026-08-03T09:00:00.000Z',
        p_ends_at: '2026-08-03T18:00:00.000Z',
        p_origin: 'nanny_countered',
      })
    );
    expect(shiftRepo.update).not.toHaveBeenCalled();
  });

  it('on accept, passes accept-path events to RPC (superseded events inserted in RPC)', async () => {
    const sibling = {
      ...pendingRequest,
      id: 'cr-sibling',
      kind: 'time_change' as const,
    };
    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...pendingRequest, status: 'accepted' },
        shift: { ...shift, status: 'cancelled' },
        superseded: [sibling],
      })),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, eventRepo });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledTimes(1);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledWith(
      expect.objectContaining({
        p_events: expect.arrayContaining([
          expect.objectContaining({ event_type: 'change_request_accepted' }),
          expect.objectContaining({ event_type: 'shift_cancelled' }),
        ]),
      })
    );
  });

  it('does NOT call acceptAndApply on decline', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({ changeRequestRepo });

    await svc.respond('carer-1', 'cr1', { status: 'declined' });

    expect(changeRequestRepo.acceptAndApply).not.toHaveBeenCalled();
    expect(changeRequestRepo.respond).toHaveBeenCalled();
  });

  it('rejects respond when the caller is not the designated responder', async () => {
    const svc = makeSvc();
    await expect(
      svc.respond('parent-2', 'cr1', { status: 'accepted' })
    ).rejects.toBeInstanceOf(NotTheChangeRequestResponderError);
  });

  // The state that made the request valid at `create` time can change before
  // anyone responds. The S0 chain: parent opens a cancel at 07:00 on a
  // confirmed 08:00–16:00 shift (`create` runs assertMutable, no entries yet);
  // the carer clocks in at 08:00 and `matchConfirmedShift` attaches the shift;
  // she accepts the cancel at 08:30. Without a re-check the RPC commits and
  // the paid-cancel entry lands ON TOP of her running one — after which every
  // clock-out time overlaps it, and the carer-global running-entry index locks
  // her out of clocking in for every household she works for.
  it('refuses to accept a change request on a shift someone has clocked into', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({
      changeRequestRepo,
      shiftRepo: makeShiftRepo({
        assertMutable: mock(async () => {
          throw new ShiftImmutableError('s1', 'confirmed', 'has_time_entries');
        }),
      }),
    });

    await expect(
      svc.respond('carer-1', 'cr1', { status: 'accepted' })
    ).rejects.toBeInstanceOf(ShiftImmutableError);
    expect(changeRequestRepo.acceptAndApply).not.toHaveBeenCalled();
  });

  // The escape hatch that keeps the refusal above from stranding the request:
  // declining touches the request only, never the shift, so the carer working
  // the shift can always clear the pending row herself.
  it('still lets the carer decline a request on a shift she has clocked into', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({
      changeRequestRepo,
      shiftRepo: makeShiftRepo({
        assertMutable: mock(async () => {
          throw new ShiftImmutableError('s1', 'confirmed', 'has_time_entries');
        }),
      }),
    });

    const result = await svc.respond('carer-1', 'cr1', { status: 'declined' });

    expect(result.shift_change_request.status).toBe('declined');
    expect(changeRequestRepo.respond).toHaveBeenCalled();
  });

  // `if (shift.carer_id && shift.carer_id !== userId)` short-circuits on an
  // UNASSIGNED shift, so the identity check never ran and any active nanny in
  // the household could answer a parent's request on a shift she has nothing
  // to do with — cancelling it, or rewriting its times.
  it('refuses a nanny who is not the assigned carer on an unassigned shift', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const payArrangementRepo = makePayArrangementRepo();
    const svc = makeSvc({
      changeRequestRepo,
      payArrangementRepo,
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async (_h: string, userId: string) => {
          if (userId === 'carer-2') return membershipFor('nanny', 'carer-2');
          if (userId === 'parent-1') return membershipFor('parent', 'parent-1');
          return membershipFor('parent', userId);
        }),
      }),
      shiftQueries: makeShiftQueries({
        getOwned: mock(async () => ({ ...shift, carer_id: null })),
      }),
    });

    await expect(
      svc.respond('carer-2', 'cr1', { status: 'accepted' })
    ).rejects.toBeInstanceOf(NotTheChangeRequestResponderError);
    // Nothing reaches pricing or the shift mutation.
    expect(changeRequestRepo.acceptAndApply).not.toHaveBeenCalled();
    expect(payArrangementRepo.effectiveOn).not.toHaveBeenCalled();
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

describe('ShiftChangeRequestCommandService.respond — cancellation window repoint', () => {
  // Owner decision 5 / review finding 10: the effective arrangement is
  // selected by the SHIFT's household-local start date, never the accept
  // date. A rate/window change landing between the two must not leak into
  // this cancellation.
  it('fetches the arrangement effective on the SHIFT start date, not today/accept date, and that arrangement governs', async () => {
    const shiftDateArrangement = {
      id: 'arr-old',
      household_id: 'h1',
      carer_id: 'carer-1',
      cancellation_paid_within_hours: 240,
    };
    // A later arrangement effective as of "today" (the accept date) with a
    // deliberately different answer (unpaid) — if the service wrongly asked
    // for "today" instead of the shift's local date, this is what it would
    // wrongly get back.
    const acceptDateArrangement = {
      id: 'arr-new',
      household_id: 'h1',
      carer_id: 'carer-1',
      cancellation_paid_within_hours: null,
    };
    // Five days out, under a ten-day window: still paid, and the shift's
    // household-local day is unambiguously NOT today's, whenever this runs.
    // (The fixture used to pin `local_date` to a fixed past date while
    // `starts_at` was an hour away — a combination the 015 trigger could
    // never produce. Now that the service derives the day from `starts_at`
    // and the household's zone, the two have to agree.)
    const startsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const inHousehold = (instant: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: household.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(instant));
    const shiftDate = inHousehold(startsAt);
    expect(shiftDate).not.toBe(inHousehold(new Date().toISOString()));

    const payArrangementRepo = makePayArrangementRepo({
      effectiveOn: mock(async (_h: string, _c: string, date: string) =>
        date === shiftDate ? shiftDateArrangement : acceptDateArrangement
      ),
    });
    const soonShift: ShiftWithChildren = {
      ...shift,
      local_date: shiftDate,
      starts_at: startsAt,
    };
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({
      changeRequestRepo,
      payArrangementRepo,
      shiftQueries: makeShiftQueries({ getOwned: mock(async () => soonShift) }),
    });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(payArrangementRepo.effectiveOn).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      shiftDate
    );
    // Governed by the shift-date arrangement's window (240h, and the shift
    // is five days away) — NOT the accept-date arrangement's null window,
    // which would have produced `false`.
    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledWith(
      expect.objectContaining({ p_cancellation_paid: true })
    );
  });

  // ---------------------------------------------------------------------
  // Phase 2 review, finding 8. "The shift's household-local start date" is
  // NOT `shifts.local_date`: migration 015's `sync_shift_local_date` derives
  // that column from the shift's OWN `timezone` column — the zone the shift
  // was AUTHORED in, deliberately frozen there so the original wall-clock
  // intent survives the household moving (015's header). Two supported
  // product actions make the two disagree:
  //   * `PATCH /households/:id { timezone }` — the household moves, and
  //     every already-materialised shift keeps the old authoring zone.
  //   * `POST .../shifts/extra` takes a client-supplied `timezone`
  //     (`CreateExtraShiftSchema`: `z.string().min(1)`, never checked
  //     against the household's).
  // Whichever date is used has to be the one arrangements are keyed on, and
  // arrangements are household-scoped: `payArrangementCommandService` and
  // `weekEarningsService` both resolve dates with
  // `localDateOf(instant, household.timezone)`.
  // ---------------------------------------------------------------------
  it('resolves the arrangement date in the HOUSEHOLD timezone, not the shift authoring timezone', async () => {
    const payArrangementRepo = makePayArrangementRepo();
    // 20:00 UTC is 21:00 on the 3rd in London (BST) and 08:00 on the 4th in
    // Auckland (NZST) — a shift authored in Auckland for a London household,
    // or a London household that used to be in Auckland.
    const authoredElsewhere: ShiftWithChildren = {
      ...shift,
      starts_at: '2026-08-03T20:00:00.000Z',
      ends_at: '2026-08-04T04:00:00.000Z',
      timezone: 'Pacific/Auckland',
      local_date: '2026-08-04', // what the 015 trigger stamps
    };
    const svc = makeSvc({
      payArrangementRepo,
      shiftQueries: makeShiftQueries({
        getOwned: mock(async () => authoredElsewhere),
      }),
    });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(payArrangementRepo.effectiveOn).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-03'
    );
  });

  it('pays the nanny under the arrangement in force on the household-local day', async () => {
    // The same divergence, now worth money: exactly 24h between the two
    // zones, so the household-local day is always the day before the shift's
    // own `local_date`, whenever this test happens to run.
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const localDateIn = (timeZone: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(startsAt));
    const householdTz = 'Etc/GMT+11'; // UTC-11
    const shiftTz = 'Etc/GMT-13'; // UTC+13
    const householdDate = localDateIn(householdTz);
    const shiftDate = localDateIn(shiftTz);
    expect(shiftDate).not.toBe(householdDate);

    const payArrangementRepo = makePayArrangementRepo({
      effectiveOn: mock(async (_h: string, _c: string, date: string) =>
        date === householdDate
          ? { id: 'arr-household-day', cancellation_paid_within_hours: 24 }
          : { id: 'arr-shift-day', cancellation_paid_within_hours: null }
      ),
    });
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({
      changeRequestRepo,
      payArrangementRepo,
      householdRepo: makeHouseholdRepo({
        findById: mock(async () => ({ ...household, timezone: householdTz })),
      }),
      shiftQueries: makeShiftQueries({
        getOwned: mock(async () => ({
          ...shift,
          starts_at: startsAt,
          timezone: shiftTz,
          local_date: shiftDate,
        })),
      }),
    });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    // Cancelling an hour before the start, under a 24h window: paid. Asking
    // on the shift's own authoring day would have found the null-window
    // arrangement and quietly paid her nothing.
    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledWith(
      expect.objectContaining({ p_cancellation_paid: true })
    );
  });

  it('does not look up an arrangement for a non-cancel accepted kind', async () => {
    const counterRequest = {
      ...pendingRequest,
      requested_by: 'carer-1',
      kind: 'counter_offer' as const,
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    };
    const payArrangementRepo = makePayArrangementRepo();
    const svc = makeSvc({
      queries: makeQueries({ getOwned: mock(async () => counterRequest) }),
      payArrangementRepo,
    });

    await svc.respond('parent-2', 'cr1', { status: 'accepted' });

    expect(payArrangementRepo.effectiveOn).not.toHaveBeenCalled();
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

  it('does NOT call openWithSupersede on withdraw', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({ changeRequestRepo });

    await svc.withdraw('parent-1', 'cr1');

    expect(changeRequestRepo.openWithSupersede).not.toHaveBeenCalled();
  });

  it('rejects withdraw by someone other than the requester', async () => {
    const svc = makeSvc();
    await expect(svc.withdraw('parent-2', 'cr1')).rejects.toBeInstanceOf(
      NotTheChangeRequestRequesterError
    );
  });
});

describe('ShiftChangeRequestCommandService.create — supersede siblings', () => {
  it('leaves both created and superseded events to the RPC — one atomic write, no second round-trip', async () => {
    const sibling = {
      ...pendingRequest,
      id: 'cr-old',
      kind: 'time_change' as const,
    };
    const changeRequestRepo = makeChangeRequestRepo({
      openWithSupersede: mock(async () => ({
        changeRequest: { ...pendingRequest, id: 'cr-new' },
        superseded: [sibling],
      })),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, eventRepo });

    await svc.create('parent-1', 's1', {
      kind: 'cancel',
      message: 'Emergency',
    });

    // `change_request_created` names the id of the row the RPC itself
    // inserts, and `change_request_superseded` names the ids the RPC's CTE
    // closed. Neither is knowable here before the call, so both are derived
    // inside the transaction — see migration 030.
    expect(changeRequestRepo.openWithSupersede).toHaveBeenCalledTimes(1);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });
});
