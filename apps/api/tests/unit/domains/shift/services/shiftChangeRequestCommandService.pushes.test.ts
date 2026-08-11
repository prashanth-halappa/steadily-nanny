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
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
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
    // Retry guard for `insertExtraShift` — nothing pre-existing by default.
    findExtraShiftInWindow: mock(async () => null),
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
      listActiveByHousehold: mock(async (householdId: string) => [
        {
          ...membershipFor('parent', 'parent-1'),
          household_id: householdId,
          display_name_override: 'Alex',
          profile_name: null,
        },
      ]),
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
      assertApprovalAllows: mock(async () => undefined),
    }) as any,
    (overrides.children ?? {
      getOwned: mock(async () => ({ id: 'child-1' })),
    }) as any,
    // Arm 3 (no arrangement) — this file's pushes/recorder focus never
    // exercises the cancellation-window resolution itself.
    (overrides.payArrangementRepo ?? {
      effectiveOn: mock(async () => null),
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

    expect(notifyUser).not.toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED,
        }),
      })
    );
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
        }),
      })
    );
  });

  it('still pings a carer requester with cancellation pay outcome on cancel accept', async () => {
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
        body: expect.stringMatching(/You'll still be paid for it/i),
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
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
      child_ids: ['child-1'],
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

  it('extra_shift_proposed body triages from the lock screen with asker, day, times, and child', async () => {
    const svc = makeSvc({
      shiftRepo: makeShiftRepo({
        findByIdWithChildren: mock(async () => ({
          ...shift,
          id: 's-extra',
          kind: 'extra',
          status: 'pending',
          created_by: 'parent-1',
          starts_at: '2026-08-09T08:00:00.000Z',
          ends_at: '2026-08-09T10:20:00.000Z',
          timezone: 'Europe/London',
          shift_children: [{ shift_id: 's-extra', child_id: 'child-1' }],
        })),
      }),
      children: {
        getOwned: mock(async () => ({ id: 'child-1', name: 'Child1' })),
      },
    });

    await svc.createExtraShift('parent-1', 'h1', {
      starts_at: '2026-08-09T08:00:00.000Z',
      ends_at: '2026-08-09T10:20:00.000Z',
      timezone: 'Europe/London',
      carer_id: 'carer-1',
      child_ids: ['child-1'],
    });
    await new Promise<void>(resolve => setImmediate(resolve));

    const body =
      (notifyUser.mock.calls[0]?.[1] as { body?: string })?.body ?? '';
    expect(body).toContain('Alex');
    expect(body).toMatch(/asked if you can cover/i);
    expect(body).toMatch(/Aug 9/i);
    expect(body).toMatch(/09:00/);
    expect(body).toMatch(/11:20/);
    expect(body).toContain('Child1');
    expect(body).not.toContain('undefined');
  });

  // Adoption returns the shift somebody ELSE's call already created — and
  // that call already pushed for it. Pushing again is a second "Extra shift
  // proposed" for one shift, which is what a parent's double-tap produced.
  it('does not re-fire extra_shift_proposed when the pre-check adopted an existing shift', async () => {
    const existing = {
      ...shift,
      id: 's-existing',
      kind: 'extra' as const,
      status: 'pending' as const,
    };
    const svc = makeSvc({
      shiftRepo: makeShiftRepo({
        findExtraShiftInWindow: mock(async () => existing),
      }),
    });

    await svc.createExtraShift('parent-1', 'h1', {
      starts_at: '2026-08-04T08:00:00.000Z',
      ends_at: '2026-08-04T12:00:00.000Z',
      timezone: 'Europe/London',
      carer_id: 'carer-1',
    });

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('does not re-fire extra_shift_proposed when the 059 race adopted the winner', async () => {
    const winner = {
      ...shift,
      id: 's-winner',
      kind: 'extra' as const,
      status: 'pending' as const,
    };
    let lookups = 0;
    const { ExtraShiftAlreadyExistsError } = await import(
      '../../../../../src/domains/shift/errors/shiftErrors'
    );
    const svc = makeSvc({
      shiftRepo: makeShiftRepo({
        findExtraShiftInWindow: mock(async () => {
          lookups += 1;
          return lookups === 1 ? null : winner;
        }),
        createShift: mock(async () => {
          throw new ExtraShiftAlreadyExistsError({
            householdId: 'h1',
            startsAt: '2026-08-04T08:00:00.000Z',
            endsAt: '2026-08-04T12:00:00.000Z',
            carerId: 'carer-1',
          });
        }),
      }),
    });

    await svc.createExtraShift('parent-1', 'h1', {
      starts_at: '2026-08-04T08:00:00.000Z',
      ends_at: '2026-08-04T12:00:00.000Z',
      timezone: 'Europe/London',
      carer_id: 'carer-1',
    });

    expect(notifyUser).not.toHaveBeenCalled();
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

describe('co-parent FYI pushes after gate success', () => {
  async function flushFyi(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
  }

  function shortNoticeShiftQueries() {
    return {
      getOwned: mock(async () => ({
        ...shift,
        starts_at: new Date(Date.now() + 3600_000).toISOString(),
      })),
    };
  }

  it('fires CO_PARENT_ACTION_FYI after a short-notice cancel opens the request', async () => {
    const svc = makeSvc({ shiftQueries: shortNoticeShiftQueries() });

    await svc.create('parent-1', 's1', {
      kind: 'cancel',
      message: 'Cannot make it',
    });
    await flushFyi();

    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI,
          shiftId: 's1',
          action: 'cancel',
        }),
      }),
      { excludeUserId: 'parent-1' }
    );
  });

  it('fires CO_PARENT_ACTION_FYI after a short-notice time_change opens the request', async () => {
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

  it('fires CO_PARENT_ACTION_FYI when an extra shift is created', async () => {
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

  it('does not fire CO_PARENT_ACTION_FYI when an extra shift was adopted', async () => {
    const existing = {
      ...shift,
      id: 's-existing',
      kind: 'extra' as const,
      status: 'pending' as const,
    };
    const svc = makeSvc({
      shiftRepo: makeShiftRepo({
        findExtraShiftInWindow: mock(async () => existing),
      }),
    });

    await svc.createExtraShift('parent-1', 'h1', {
      starts_at: '2026-08-04T08:00:00.000Z',
      ends_at: '2026-08-04T12:00:00.000Z',
      timezone: 'Europe/London',
      carer_id: 'carer-1',
    });
    await flushFyi();

    const fyiCalls = notifyHouseholdParents.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as { data?: { type?: string } })?.data?.type ===
        PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI
    );
    expect(fyiCalls).toHaveLength(0);
  });
});

describe('carer cancellation pay pushes', () => {
  const londonNineToFiveShift = {
    ...shift,
    starts_at: '2026-08-03T08:00:00.000Z',
    ends_at: '2026-08-03T16:00:00.000Z',
  };

  it('tells the carer she is still paid when cancellation_paid is true', async () => {
    const svc = makeSvc({
      shiftQueries: { getOwned: mock(async () => londonNineToFiveShift) },
      changeRequestRepo: makeChangeRequestRepo({
        acceptAndApply: mock(async () => ({
          changeRequest: { ...pendingRequest, status: 'accepted' },
          shift: {
            ...londonNineToFiveShift,
            status: 'cancelled',
            cancellation_paid: true,
          },
          superseded: [],
        })),
      }),
    });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: expect.stringMatching(
          /9:00 AM – 5:00 PM.*You'll still be paid for it/i
        ),
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
        }),
      })
    );
  });

  it('tells the carer unpaid hours when cancellation_paid is false', async () => {
    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...pendingRequest, status: 'accepted' },
        shift: {
          ...londonNineToFiveShift,
          status: 'cancelled',
          cancellation_paid: false,
        },
        superseded: [],
      })),
    });
    const svc = makeSvc({
      changeRequestRepo,
      shiftQueries: { getOwned: mock(async () => londonNineToFiveShift) },
    });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: expect.stringMatching(/8h off this week's hours/i),
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
        }),
      })
    );
  });

  it('states a part-hour loss exactly, never rounded to whole hours', async () => {
    // This sentence is about her PAY. Rounding turned 7h30m into "8h off this
    // week's hours" — overstating what she lost — and would turn a short shift
    // into "0h". Be exact on a money message or say nothing.
    const sevenThirty = {
      ...londonNineToFiveShift,
      ends_at: '2026-08-03T15:30:00.000Z', // 08:00–15:30Z = 7h 30m
    };
    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...pendingRequest, status: 'accepted' },
        shift: {
          ...sevenThirty,
          status: 'cancelled',
          cancellation_paid: false,
        },
        superseded: [],
      })),
    });
    const svc = makeSvc({
      changeRequestRepo,
      shiftQueries: { getOwned: mock(async () => sevenThirty) },
    });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(notifyUser).toHaveBeenCalledWith(
      'carer-1',
      expect.objectContaining({
        body: expect.stringMatching(/7h 30m off this week's hours/i),
      })
    );
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

  // F-B2-5 / F-B5-1 / F-B9-1. The cancel RPC has already committed
  // `cancellation_paid = true`; if the payable row then fails to write, a 200
  // tells the carer her hours were banked when no `time_entries` row exists.
  // There is no retry path and nothing user-visible — silent underpay. The
  // accept must fail loudly instead.
  it('fails the accept when the paid-cancel entry cannot be written', async () => {
    const recorder = mock(async () => {
      throw new Error('payroll boom');
    });
    setCancellationPaidEntryRecorder(recorder);

    // Default acceptAndApply already returns cancellation_paid: true.
    const svc = makeSvc();

    await expect(
      svc.respond('carer-1', 'cr1', { status: 'accepted' })
    ).rejects.toThrow('payroll boom');
    expect(recorder).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      'Failed to record cancellation_paid time entry',
      expect.objectContaining({
        shiftId: 's1',
        error: 'payroll boom',
      })
    );
  });

  // The cancellation itself is committed and irreversible by the time the
  // recorder runs, so the household still has to hear about it — the throw
  // reports the missing pay entry, it does not retract the cancellation.
  it('still pushes the cancellation before failing on a recorder throw', async () => {
    setCancellationPaidEntryRecorder(async () => {
      throw new Error('payroll boom');
    });
    const svc = makeSvc();

    await expect(
      svc.respond('carer-1', 'cr1', { status: 'accepted' })
    ).rejects.toThrow('payroll boom');
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
        }),
      })
    );
  });
});
