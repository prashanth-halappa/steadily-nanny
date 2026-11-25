/**
 * Instant no-fee cancel: a parent's cancel that the server prices as NOT
 * paid (arrangement effective on the shift's household-local date) is applied
 * straight away through the same accept/apply path a nanny's accept uses, and
 * the nanny is told. A paid cancel keeps the request flow. Old clients that
 * don't send `cancel_now_if_unpaid` keep the request flow too.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

const HOUR_MS = 3_600_000;

const household = {
  id: 'h1',
  name: 'Smiths',
  // Far east of UTC so the shift's household-local date differs from its UTC
  // date — proves the lookup is keyed on the household's zone.
  timezone: 'Pacific/Auckland',
  approval_mode: 'either' as const,
  approval_scope: 'short_notice_and_cancellations' as const,
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
};

let startsAt = '';

function shiftAt(hoursFromNow: number): ShiftWithChildren {
  // Pin to 20:00Z so Auckland's local date is the NEXT calendar day.
  const day = new Date(Date.now() + hoursFromNow * HOUR_MS);
  day.setUTCHours(20, 0, 0, 0);
  startsAt = day.toISOString();
  return {
    id: 's1',
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: startsAt,
    ends_at: new Date(day.getTime() + 5 * HOUR_MS).toISOString(),
    timezone: 'UTC',
    local_date: startsAt.slice(0, 10),
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
}

const openedRequest = {
  id: 'cr1',
  shift_id: 's1',
  requested_by: 'parent-1',
  kind: 'cancel' as const,
  proposed_starts_at: null,
  proposed_ends_at: null,
  message: null,
  response_message: null,
  status: 'pending' as const,
  responded_by: null,
  responded_at: null,
  created_at: 't',
  updated_at: 't',
};

function arrangement(window: number | null) {
  return {
    id: 'arr-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    rate_minor: 2000,
    currency: 'USD',
    cancellation_paid_within_hours: window,
  };
}

let ShiftChangeRequestCommandService: typeof import('../../../../../src/domains/shift/services/shiftChangeRequestCommandService').ShiftChangeRequestCommandService;
let setCancellationPaidEntryRecorder: typeof import('../../../../../src/domains/shift/services/shiftChangeRequestCommandService').setCancellationPaidEntryRecorder;
let detectUncoveredCareForDate: ReturnType<typeof mock>;
let notifyUser: ReturnType<typeof mock>;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  detectUncoveredCareForDate = mock(async () => ({ inserted: [], pushed: [] }));
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
});

beforeEach(() => {
  detectUncoveredCareForDate.mockClear();
  notifyUser.mockClear();
  notifyHouseholdParents.mockClear();
  setCancellationPaidEntryRecorder(async () => null);
});

function build(shift: ShiftWithChildren, arr: unknown) {
  const changeRequestRepo = {
    openWithSupersede: mock(async () => ({
      changeRequest: openedRequest,
      superseded: [],
    })),
    acceptAndApply: mock(async () => ({
      changeRequest: {
        ...openedRequest,
        status: 'accepted',
        responded_by: 'parent-1',
      },
      shift: { ...shift, status: 'cancelled', cancelled_by: 'parent-1' },
      superseded: [],
    })),
  };
  const effectiveOn = mock(async () => arr);
  const svc = new ShiftChangeRequestCommandService(
    changeRequestRepo as any,
    { assertMutable: mock(async () => undefined) } as any,
    { insertMany: mock(async () => []) } as any,
    {
      findActiveMembership: mock(async (_h: string, userId: string) => ({
        id: `m-${userId}`,
        household_id: 'h1',
        user_id: userId,
        role: userId === 'carer-1' ? 'nanny' : 'owner',
      })),
      listActiveByHousehold: mock(async () => [
        {
          user_id: 'parent-1',
          display_name_override: 'Sam',
          profile_name: null,
        },
      ]),
    } as any,
    { findById: mock(async () => household) } as any,
    {} as any,
    { getOwned: mock(async () => shift) } as any,
    { assertApprovalAllows: mock(async () => undefined) } as any,
    {} as any,
    { effectiveOn } as any
  );
  return { svc, changeRequestRepo, effectiveOn };
}

function pushTypes(m: ReturnType<typeof mock>): string[] {
  return m.mock.calls.map(
    (c: unknown[]) => (c[1] as { data: { type: string } }).data.type
  );
}

describe('create(cancel) — instant when the server prices it unpaid', () => {
  it('applies a no-cancellation-pay cancel straight away and tells the nanny', async () => {
    const shift = shiftAt(72);
    const { svc, changeRequestRepo, effectiveOn } = build(
      shift,
      arrangement(null)
    );

    const result = await svc.create('parent-1', 's1', {
      kind: 'cancel',
      cancel_now_if_unpaid: true,
    });

    expect(result.status).toBe('applied');
    // Priced against the household-LOCAL date of the shift, like accept.
    const aucklandDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Auckland',
    }).format(new Date(startsAt));
    expect(effectiveOn).toHaveBeenCalledWith('h1', 'carer-1', aucklandDate);
    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledTimes(1);
    const args = (
      changeRequestRepo.acceptAndApply.mock.calls[0] as unknown[]
    )[0] as Record<string, unknown>;
    expect(args.p_set_cancel).toBe(true);
    expect(args.p_cancellation_paid).toBe(false);
    expect(args.p_cancelled_by).toBe('parent-1');
    expect(args.p_responded_by).toBe('parent-1');
    expect(
      (args.p_events as { event_type: string }[]).map(e => e.event_type)
    ).toEqual(['change_request_accepted', 'shift_cancelled']);

    expect(detectUncoveredCareForDate).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'cancelled', actorId: 'parent-1' })
    );

    expect(notifyUser).toHaveBeenCalledTimes(1);
    const [to, payload] = notifyUser.mock.calls[0] as [
      string,
      { title: string; body: string; data: { type: string } },
    ];
    expect(to).toBe('carer-1');
    expect(payload.data.type).toBe(PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED);
    expect(payload.body).toMatch(
      /^Sam cancelled your shift on \w{3} \w{3} \d{1,2}, 8:00 PM – 1:00 AM\.$/
    );
    // The nanny is not asked to respond to anything.
    expect(pushTypes(notifyUser)).not.toContain(
      PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED
    );
    // Co-parents hear who did it; the acting parent is not pushed.
    for (const call of notifyHouseholdParents.mock.calls as unknown[][]) {
      expect(call[2]).toEqual({ excludeUserId: 'parent-1' });
    }
    expect(pushTypes(notifyHouseholdParents)).toEqual([
      PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI,
    ]);
  });

  it('applies straight away when there is NO arrangement (server: not paid)', async () => {
    const { svc, changeRequestRepo } = build(shiftAt(72), null);
    const result = await svc.create('parent-1', 's1', {
      kind: 'cancel',
      cancel_now_if_unpaid: true,
    });
    expect(result.status).toBe('applied');
    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledTimes(1);
  });

  it('applies straight away when outside the arrangement window', async () => {
    const { svc, changeRequestRepo } = build(shiftAt(72), arrangement(24));
    const result = await svc.create('parent-1', 's1', {
      kind: 'cancel',
      cancel_now_if_unpaid: true,
    });
    expect(result.status).toBe('applied');
    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledTimes(1);
  });

  it('keeps the request flow when the cancellation IS paid', async () => {
    const { svc, changeRequestRepo } = build(shiftAt(72), arrangement(500));
    const result = await svc.create('parent-1', 's1', {
      kind: 'cancel',
      cancel_now_if_unpaid: true,
    });
    expect(result.status).toBe('pending');
    expect(changeRequestRepo.acceptAndApply).not.toHaveBeenCalled();
    expect(pushTypes(notifyUser)).toEqual([
      PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED,
    ]);
  });

  it('keeps the request flow for an old client that does not opt in', async () => {
    const { svc, changeRequestRepo, effectiveOn } = build(
      shiftAt(72),
      arrangement(null)
    );
    const result = await svc.create('parent-1', 's1', { kind: 'cancel' });
    expect(result.status).toBe('pending');
    expect(changeRequestRepo.acceptAndApply).not.toHaveBeenCalled();
    expect(effectiveOn).not.toHaveBeenCalled();
  });
});
