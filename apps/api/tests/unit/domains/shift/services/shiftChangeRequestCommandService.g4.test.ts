/**
 * G4 — serialised accept/open via RPC. Strict TDD companion to the main service tests.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import {
  SHIFT_CHANGE_REQUEST_KINDS,
  SHIFT_ORIGINS,
  SHIFT_STATUSES,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import {
  planAcceptedChange,
  ShiftChangeRequestCommandService,
} from '../../../../../src/domains/shift/services/shiftChangeRequestCommandService';
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
      changeRequest: { ...pendingRequest, id: 'cr-new', ...args },
      superseded: [],
    })),
    acceptAndApply: mock(async () => ({
      changeRequest: { ...pendingRequest, status: 'accepted' },
      shift: { ...shift, status: SHIFT_STATUSES.CANCELLED },
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

function makeEventRepo(): any {
  return { insertMany: mock(async () => undefined) };
}

function makeMemberRepo(): any {
  return {
    findActiveMembership: mock(async (_h: string, userId: string) => {
      if (userId === 'carer-1') return membershipFor('nanny', 'carer-1');
      if (userId === 'parent-1') return membershipFor('parent', 'parent-1');
      return membershipFor('parent', userId);
    }),
  };
}

function makeHouseholdRepo(): any {
  return { findById: mock(async () => household) };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return { getOwned: mock(async () => pendingRequest), ...overrides };
}

function makeShiftQueries(overrides: Record<string, unknown> = {}): any {
  return { getOwned: mock(async () => shift), ...overrides };
}

// Arm 3 by default (no arrangement) — matches this file's pre-existing
// behaviour, which never sets up a pay arrangement.
function makePayArrangementRepo(overrides: Record<string, unknown> = {}): any {
  return { effectiveOn: mock(async () => null), ...overrides };
}

function arrangementFor(
  overrides: Partial<PayArrangement> = {}
): PayArrangement {
  return {
    id: 'arr1',
    household_id: 'h1',
    carer_id: 'carer-1',
    rate_minor: 1500,
    bill_rate_minor: null,
    currency: 'GBP',
    overtime_threshold_minutes: null,
    overtime_multiplier: 1.5,
    guaranteed_minutes_per_week: null,
    pto_entitlement_minutes_per_year: null,
    mileage_rate_per_mile_minor: null,
    cancellation_paid_within_hours: 24,
    valid_from: '2026-01-01',
    // 065: null = these terms are still live (set only on member removal).
    valid_to: null,
    carer_display_name: 'Nanny',
    note: null,
    created_by: null,
    created_at: 't',
    ...overrides,
  };
}

function makeSvc(overrides: Record<string, unknown> = {}) {
  return new ShiftChangeRequestCommandService(
    (overrides.changeRequestRepo ?? makeChangeRequestRepo()) as any,
    (overrides.shiftRepo ?? makeShiftRepo()) as any,
    (overrides.eventRepo ?? makeEventRepo()) as any,
    (overrides.memberRepo ?? makeMemberRepo()) as any,
    (overrides.householdRepo ?? makeHouseholdRepo()) as any,
    (overrides.queries ?? makeQueries()) as any,
    (overrides.shiftQueries ?? makeShiftQueries()) as any,
    (overrides.gate ?? {
      assertApprovalAllows: mock(async () => ({ needsApproval: false })),
    }) as any,
    (overrides.children ?? {
      getOwned: mock(async () => ({ id: 'child-1' })),
    }) as any,
    (overrides.payArrangementRepo ?? makePayArrangementRepo()) as any
  );
}

describe('planAcceptedChange', () => {
  it('plans cancel RPC args and shift_cancelled event', () => {
    const plan = planAcceptedChange(
      'carer-1',
      pendingRequest,
      shift,
      household as any,
      null,
      null
    );

    expect(plan.rpcArgs.p_set_cancel).toBe(true);
    expect(plan.rpcArgs.p_cancelled_by).toBe('carer-1');
    expect(plan.rpcArgs.p_cancellation_message).toBe('Cannot make it');
    expect(plan.rpcArgs.p_set_times).toBe(false);
    expect(plan.rpcArgs.p_origin).toBe(SHIFT_ORIGINS.PARENT_PROPOSED);
    expect(plan.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'shift_cancelled' }),
      ])
    );
  });

  it('plans time_change RPC args with parent_proposed origin', () => {
    const timeRequest = {
      ...pendingRequest,
      kind: SHIFT_CHANGE_REQUEST_KINDS.TIME_CHANGE,
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    };
    const plan = planAcceptedChange(
      'carer-1',
      timeRequest,
      shift,
      household as any,
      null,
      'ok'
    );

    expect(plan.rpcArgs.p_set_times).toBe(true);
    expect(plan.rpcArgs.p_starts_at).toBe(timeRequest.proposed_starts_at);
    expect(plan.rpcArgs.p_origin).toBe(SHIFT_ORIGINS.PARENT_PROPOSED);
    expect(plan.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'shift_updated' }),
      ])
    );
  });

  it('plans counter_offer with nanny_countered origin', () => {
    const counter = {
      ...pendingRequest,
      kind: SHIFT_CHANGE_REQUEST_KINDS.COUNTER_OFFER,
      proposed_starts_at: '2026-08-03T09:00:00.000Z',
      proposed_ends_at: '2026-08-03T18:00:00.000Z',
    };
    const plan = planAcceptedChange(
      'parent-2',
      counter,
      shift,
      household as any,
      null,
      null
    );
    expect(plan.rpcArgs.p_origin).toBe(SHIFT_ORIGINS.NANNY_COUNTERED);
  });

  it('split/handover are rejected (no silent no-op accept)', () => {
    const split = {
      ...pendingRequest,
      kind: SHIFT_CHANGE_REQUEST_KINDS.SPLIT,
    };
    expect(() =>
      planAcceptedChange('carer-1', split, shift, household as any, null, null)
    ).toThrow(ValidationError);
  });

  it('throws when time kind lacks proposed times', () => {
    const bad = {
      ...pendingRequest,
      kind: SHIFT_CHANGE_REQUEST_KINDS.TIME_CHANGE,
    };
    expect(() =>
      planAcceptedChange('carer-1', bad, shift, household as any, null, null)
    ).toThrow(ValidationError);
  });
});

describe('planAcceptedChange — cancellation-pay three-arm rule (owner decision 5)', () => {
  // household.cancellation_paid_within_hours is deliberately different from
  // every arrangement window used below, so a test passing only proves the
  // arrangement governed if the household's answer would have differed.
  const soonShift: ShiftWithChildren = {
    ...shift,
    starts_at: new Date(Date.now() + 3_600_000).toISOString(), // 1h away
  };
  const farShift: ShiftWithChildren = {
    ...shift,
    starts_at: new Date(Date.now() + 48 * 3_600_000).toISOString(), // 48h away
  };

  it('arm 1 — arrangement window (24h) governs and pays when the cancellation is inside it', () => {
    const arrangement = arrangementFor({ cancellation_paid_within_hours: 24 });
    const householdNeverPays = {
      ...household,
      cancellation_paid_within_hours: 0,
    };
    const plan = planAcceptedChange(
      'carer-1',
      pendingRequest,
      soonShift,
      householdNeverPays as any,
      arrangement,
      null
    );
    expect(plan.rpcArgs.p_cancellation_paid).toBe(true);
  });

  it('arm 1 — arrangement window (24h) governs and does NOT pay when outside it, even though household would', () => {
    const arrangement = arrangementFor({ cancellation_paid_within_hours: 24 });
    const householdAlwaysPays = {
      ...household,
      cancellation_paid_within_hours: 999,
    };
    const plan = planAcceptedChange(
      'carer-1',
      pendingRequest,
      farShift,
      householdAlwaysPays as any,
      arrangement,
      null
    );
    expect(plan.rpcArgs.p_cancellation_paid).toBe(false);
  });

  it('arm 2 — arrangement window explicitly null is NOT paid, even inside the household 24h window', () => {
    const arrangement = arrangementFor({
      cancellation_paid_within_hours: null,
    });
    const householdWouldPay = {
      ...household,
      cancellation_paid_within_hours: 24,
    };
    const plan = planAcceptedChange(
      'carer-1',
      pendingRequest,
      soonShift,
      householdWouldPay as any,
      arrangement,
      null
    );
    expect(plan.rpcArgs.p_cancellation_paid).toBe(false);
  });

  it('arm 3 — no arrangement: household window (24h) governs and pays inside it', () => {
    const householdWindow24 = {
      ...household,
      cancellation_paid_within_hours: 24,
    };
    const plan = planAcceptedChange(
      'carer-1',
      pendingRequest,
      soonShift,
      householdWindow24 as any,
      null,
      null
    );
    expect(plan.rpcArgs.p_cancellation_paid).toBe(true);
  });

  it('arm 3 — no arrangement: household window 0 means no cancellation pay (legacy semantics preserved)', () => {
    const householdWindow0 = {
      ...household,
      cancellation_paid_within_hours: 0,
    };
    const plan = planAcceptedChange(
      'carer-1',
      pendingRequest,
      soonShift,
      householdWindow0 as any,
      null,
      null
    );
    expect(plan.rpcArgs.p_cancellation_paid).toBe(false);
  });

  it('date-basis pin: the arrangement effective on the shift date governs even when a later one exists as of accept time', () => {
    // Simulates a rate/window change effective between the shift's date and
    // "today" (the accept date): the caller is responsible for resolving
    // `effectiveOn` against the SHIFT's local date, and this pure function
    // must honour whatever arrangement it is handed — proving the shift-date
    // arrangement (paid) wins over what a same-day-as-accept arrangement
    // (unpaid) would have produced.
    const shiftDateArrangement = arrangementFor({
      id: 'arr-old',
      cancellation_paid_within_hours: 24,
    });
    const plan = planAcceptedChange(
      'carer-1',
      pendingRequest,
      soonShift,
      household as any,
      shiftDateArrangement,
      null
    );
    expect(plan.rpcArgs.p_cancellation_paid).toBe(true);
  });
});

// `supersededEvents` is gone: both the open and accept paths now derive
// change_request_superseded inside their RPC (migrations 029/030), because the
// superseded ids come from the RPC's own CTE. The payload shape is asserted
// against the SQL in tests/unit/domains/shift/migrations/.

describe('ShiftChangeRequestCommandService.respond — G4 RPC', () => {
  it('accept calls acceptAndApply once and never shiftRepo.update', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const shiftRepo = makeShiftRepo();
    const svc = makeSvc({ changeRequestRepo, shiftRepo });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

    expect(changeRequestRepo.acceptAndApply).toHaveBeenCalledTimes(1);
    expect(changeRequestRepo.respond).not.toHaveBeenCalled();
    expect(shiftRepo.update).not.toHaveBeenCalled();
  });

  it('decline still uses respond, not acceptAndApply', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = makeSvc({ changeRequestRepo });

    await svc.respond('carer-1', 'cr1', { status: 'declined' });

    expect(changeRequestRepo.respond).toHaveBeenCalledTimes(1);
    expect(changeRequestRepo.acceptAndApply).not.toHaveBeenCalled();
  });

  it('RPC-returned superseded rows are inserted inside accept RPC, not via insertMany', async () => {
    const sibling = {
      ...pendingRequest,
      id: 'cr-sibling',
      kind: 'time_change' as const,
    };
    const changeRequestRepo = makeChangeRequestRepo({
      acceptAndApply: mock(async () => ({
        changeRequest: { ...pendingRequest, status: 'accepted' },
        shift: { ...shift, status: SHIFT_STATUSES.CANCELLED },
        superseded: [sibling],
      })),
    });
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, eventRepo });

    await svc.respond('carer-1', 'cr1', { status: 'accepted' });

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
});

describe('ShiftChangeRequestCommandService.create — G4 openWithSupersede', () => {
  it('opens via openWithSupersede RPC instead of createRequest', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const eventRepo = makeEventRepo();
    const svc = makeSvc({ changeRequestRepo, eventRepo });

    await svc.create('parent-1', 's1', {
      kind: 'cancel',
      message: 'Emergency',
    });

    expect(changeRequestRepo.openWithSupersede).toHaveBeenCalledTimes(1);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });
});
