import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { PTO_LEDGER_NOTE_KEYS } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import {
  PtoAlreadyMarkedPaidError,
  PtoNothingToAdjustError,
  PtoTimeOffNotConfirmedError,
  PtoTimeOffNotFoundError,
} from '../../../../../src/domains/pay/errors/payErrors';
import { PtoCommandService } from '../../../../../src/domains/pay/services/ptoCommandService';

const createdUsageRow = {
  id: 'ptl-new',
  household_id: 'h1',
  carer_id: 'carer-1',
  kind: 'usage',
  minutes: -480,
  effective_date: '2026-08-24',
  time_off_id: 'to-1',
  carer_display_name: 'Nia Rowe',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-08-04T09:00:00.000Z',
};

/**
 * A SINGLE-day time off — the common case, and the default here so the rest
 * of the suite keeps asserting one written row. `ends_at` is EXCLUSIVE (local
 * midnight of the day after the last covered day, the app's all-day
 * convention), so this covers only 2026-08-24.
 */
function timeOff(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'to-1',
    user_id: 'carer-1',
    starts_at: '2026-08-24T00:00:00.000Z',
    ends_at: '2026-08-25T00:00:00.000Z',
    all_day: true,
    message: null,
    status: 'confirmed',
    ical_uid: 'ical-1',
    sequence: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A time off spanning `days` covered days from Mon 2026-08-24 — the shape
 * Phase 3/4 review finding 15b is about. A 14-day span crosses a week
 * boundary (2026-08-24 is a Monday, so days 8-14 fall in the next timesheet
 * week), which is exactly where the money used to be misattributed.
 */
function multiDayTimeOff(
  days: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const endDay = 24 + days; // exclusive
  return timeOff({
    starts_at: '2026-08-24T00:00:00.000Z',
    ends_at: `2026-${endDay > 31 ? '09' : '08'}-${String(endDay > 31 ? endDay - 31 : endDay).padStart(2, '0')}T00:00:00.000Z`,
    ...overrides,
  });
}

function member(
  role: string,
  userId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
    role,
    status: 'active',
    display_name_override: null,
    ...overrides,
  };
}

function makeMemberRepo(byUserId: Record<string, unknown>): any {
  return {
    findActiveMembership: mock(
      async (_householdId: string, userId: string) => byUserId[userId] ?? null
    ),
  };
}

function makeHouseholdRepo(timezone = 'Europe/London'): any {
  return { findById: mock(async () => ({ id: 'h1', timezone })) };
}

function makeUserService(name: string | null = 'Nia Rowe'): any {
  return {
    getProfileById: mock(async () => (name === null ? null : { name })),
  };
}

function makeTimeOffRepo(row: Record<string, unknown> | null = timeOff()): any {
  return { findById: mock(async () => row) };
}

function makePtoRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (row: Record<string, unknown>) => ({
      ...createdUsageRow,
      ...row,
    })),
    /** Every kind of row for this time off, across households (reconcile). */
    listAllForTimeOff: mock(async () => []),
    /** Every kind of row for ONE household's marking of this time off. */
    listForHouseholdTimeOff: mock(async () => []),
    ...overrides,
  };
}

/** A `usage` ledger row as stored — minutes NEGATIVE (043's sign convention). */
function usageRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'ptl-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    kind: 'usage',
    minutes: -480,
    effective_date: '2026-08-24',
    time_off_id: 'to-1',
    carer_display_name: 'Nia Rowe',
    note: null,
    created_by: 'parent-1',
    created_at: '2026-08-04T09:00:00.000Z',
    ...overrides,
  };
}

/** An `adjustment` ledger row — a correction against the same time off. */
function adjustmentRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...usageRow(),
    id: 'ptl-adj',
    kind: 'adjustment',
    minutes: 480,
    created_by: null,
    ...overrides,
  };
}

function makePush(overrides: Record<string, unknown> = {}): any {
  return {
    notifyHouseholdParents: mock(() => {}),
    ...overrides,
  };
}

const PARENT = member('parent', 'parent-1');
const CO_PARENT = member('parent', 'parent-2');
const OWNER = member('owner', 'owner-1');
const NANNY = member('nanny', 'carer-1');
const HELPER = member('helper', 'helper-1');

interface ServiceParts {
  ptoRepo?: any;
  timeOffRepo?: any;
  members?: Record<string, unknown>;
  timezone?: string;
  userService?: any;
  push?: any;
}

function service(parts: ServiceParts = {}): any {
  return new PtoCommandService(
    parts.ptoRepo ?? makePtoRepo(),
    parts.timeOffRepo ?? makeTimeOffRepo(),
    makeMemberRepo(parts.members ?? { 'parent-1': PARENT, 'carer-1': NANNY }),
    makeHouseholdRepo(parts.timezone ?? 'Europe/London'),
    parts.userService ?? makeUserService(),
    parts.push ?? makePush()
  );
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    time_off_id: 'to-1',
    minutes: 480,
    ...overrides,
  };
}

describe('PtoCommandService.markTimeOffPaid — parent gate', () => {
  it('a parent may mark time off paid', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo });
    const created = await svc.markTimeOffPaid('parent-1', 'h1', request());
    expect(created.id).toBe('ptl-new');
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
  });

  it('a co-parent may mark it too (no co-parent approval gate)', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      members: { 'parent-2': CO_PARENT, 'carer-1': NANNY },
    });
    await svc.markTimeOffPaid('parent-2', 'h1', request());
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
  });

  it('the owner may mark it', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      members: { 'owner-1': OWNER, 'carer-1': NANNY },
    });
    await svc.markTimeOffPaid('owner-1', 'h1', request());
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
  });

  it('the NANNY may not mark her own time off paid', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, members: { 'carer-1': NANNY } });
    await expect(
      svc.markTimeOffPaid('carer-1', 'h1', request())
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('a HELPER may not mark anyone paid', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      members: { 'helper-1': HELPER, 'carer-1': NANNY },
    });
    await expect(
      svc.markTimeOffPaid('helper-1', 'h1', request())
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('a non-member may not', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, members: {} });
    await expect(
      svc.markTimeOffPaid('stranger', 'h1', request())
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });
});

describe('PtoCommandService.markTimeOffPaid — D12-class time-off assertion', () => {
  it('rejects a time_off_id that names nobody', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, timeOffRepo: makeTimeOffRepo(null) });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).rejects.toBeInstanceOf(PtoTimeOffNotFoundError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a time off whose user_id is not a member of THIS household', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      members: { 'parent-1': PARENT }, // no membership row for carer-1
    });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).rejects.toBeInstanceOf(PtoTimeOffNotFoundError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a time off whose user_id is a member but NOT a nanny (e.g. a co-parent)', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(timeOff({ user_id: 'parent-2' })),
      members: { 'parent-1': PARENT, 'parent-2': CO_PARENT },
    });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).rejects.toBeInstanceOf(PtoTimeOffNotFoundError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a nanny whose membership in this household is no longer active', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, members: { 'parent-1': PARENT } });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).rejects.toBeInstanceOf(PtoTimeOffNotFoundError);
  });

  it('uses the SAME error for a missing time off as for one that is not yours', async () => {
    const missing = service({ timeOffRepo: makeTimeOffRepo(null) })
      .markTimeOffPaid('parent-1', 'h1', request())
      .catch((err: unknown) => err);
    const notYours = service({ members: { 'parent-1': PARENT } })
      .markTimeOffPaid('parent-1', 'h1', request())
      .catch((err: unknown) => err);
    const [a, b] = await Promise.all([missing, notYours]);
    expect(a).toBeInstanceOf(PtoTimeOffNotFoundError);
    expect(b).toBeInstanceOf(PtoTimeOffNotFoundError);
    expect((a as Error).message).toBe((b as Error).message);
  });
});

describe('PtoCommandService.markTimeOffPaid — status guard', () => {
  it('rejects requested (not yet confirmed) time off', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(timeOff({ status: 'requested' })),
    });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).rejects.toBeInstanceOf(PtoTimeOffNotConfirmedError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('rejects cancelled time off', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(timeOff({ status: 'cancelled' })),
    });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).rejects.toBeInstanceOf(PtoTimeOffNotConfirmedError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('accepts confirmed time off', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(timeOff({ status: 'confirmed' })),
    });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).resolves.toBeDefined();
  });
});

describe('PtoCommandService.markTimeOffPaid — duplicate marking', () => {
  it('surfaces the typed already-marked error rather than a raw 500', async () => {
    const ptoRepo = makePtoRepo({
      create: mock(async () => {
        throw new PtoAlreadyMarkedPaidError('h1', 'to-1');
      }),
    });
    const svc = service({ ptoRepo });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request())
    ).rejects.toBeInstanceOf(PtoAlreadyMarkedPaidError);
  });
});

describe('PtoCommandService.markTimeOffPaid — over-balance is ALLOWED (pinned)', () => {
  it('writes the usage row with no balance check at all — no dependency on a balance/query service exists', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo });
    // A huge request, far beyond any plausible entitlement — must still write.
    const created = await svc.markTimeOffPaid(
      'parent-1',
      'h1',
      request({ minutes: 100_000 })
    );
    expect(created.id).toBe('ptl-new');
    expect(ptoRepo.create.mock.calls[0][0].minutes).toBe(-100_000);
  });
});

describe('PtoCommandService.markTimeOffPaid — the written row', () => {
  it('writes a NEGATIVE usage row with the household-local effective_date and time_off_id set', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, timezone: 'Europe/London' });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));
    expect(ptoRepo.create.mock.calls[0][0]).toEqual({
      household_id: 'h1',
      carer_id: 'carer-1',
      kind: 'usage',
      minutes: -480,
      effective_date: '2026-08-24',
      time_off_id: 'to-1',
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: 'parent-1',
    });
  });

  it('carries a client-supplied note through', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid(
      'parent-1',
      'h1',
      request({ note: 'agreed by phone' })
    );
    expect(ptoRepo.create.mock.calls[0][0].note).toBe('agreed by phone');
  });

  it("prefers the household member's display_name_override for the snapshot", async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      members: {
        'parent-1': PARENT,
        'carer-1': member('nanny', 'carer-1', {
          display_name_override: 'Nia',
        }),
      },
      userService: makeUserService('Antonia Rowe'),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request());
    expect(ptoRepo.create.mock.calls[0][0].carer_display_name).toBe('Nia');
  });

  it("falls back to the carer's profile name when there is no override", async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, userService: makeUserService('Nia Rowe') });
    await svc.markTimeOffPaid('parent-1', 'h1', request());
    expect(ptoRepo.create.mock.calls[0][0].carer_display_name).toBe('Nia Rowe');
  });

  it('falls back to the unnamed-carer label when neither exists', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, userService: makeUserService(null) });
    await svc.markTimeOffPaid('parent-1', 'h1', request());
    expect(ptoRepo.create.mock.calls[0][0].carer_display_name).toBe('Carer');
  });
});

// =============================================================================
// markTimeOffPaid — the ADJUST flow (Phase 3/4 review, BLOCKER 3).
//
// The mark-paid sheet advertises that re-submitting a different number of
// hours appends a correction. It never could: the method always inserted a
// second `kind='usage'` row and the partial unique index 409'd it, so a
// parent who marked 8h and then realised it should be 6h had NO way to
// correct it anywhere in the app. A second mark is now a DELTA `adjustment`
// row against the netted total, keeping the ledger append-only.
// =============================================================================

describe('PtoCommandService.markTimeOffPaid — adjusting an existing marking', () => {
  it('the FIRST mark still writes a usage row (nothing to adjust yet)', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => []),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.create.mock.calls[0][0]).toMatchObject({
      kind: 'usage',
      minutes: -480,
    });
  });

  it('adjusting DOWN (8h marked, 6h meant) appends a POSITIVE adjustment for the delta — never a second usage row', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [usageRow({ minutes: -480 })]),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 360 }));

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    const written = ptoRepo.create.mock.calls[0][0];
    expect(written.kind).toBe('adjustment');
    expect(written.minutes).toBe(120); // 480 paid -> 360 paid = +120 back
    expect(written.time_off_id).toBe('to-1');
    // Dated with the usage row it corrects, so it nets in the same week.
    expect(written.effective_date).toBe('2026-08-24');
  });

  it('adjusting UP (6h marked, 8h meant) appends a NEGATIVE adjustment for the delta', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [usageRow({ minutes: -360 })]),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.create.mock.calls[0][0]).toMatchObject({
      kind: 'adjustment',
      minutes: -120,
    });
  });

  it('re-submitting the SAME total is an idempotent no-op — no row written, success returned', async () => {
    const existing = usageRow({ minutes: -480 });
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [existing]),
    });
    const svc = service({ ptoRepo });
    const result = await svc.markTimeOffPaid(
      'parent-1',
      'h1',
      request({ minutes: 480 })
    );

    expect(ptoRepo.create).not.toHaveBeenCalled();
    expect(result.id).toBe(existing.id);
  });

  it('adjusting to ZERO is a FULL reversal — one adjustment cancelling the netted total', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [usageRow({ minutes: -480 })]),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 0 }));

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.create.mock.calls[0][0]).toMatchObject({
      kind: 'adjustment',
      minutes: 480,
    });
  });

  it('adjusts against the NETTED total, not the original usage row', async () => {
    // 8h marked, then corrected down to 6h. Asking for 8h again must append
    // −120 (6h → 8h), not 0 and not −480.
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [
        usageRow({ minutes: -480 }),
        adjustmentRow({ minutes: 120 }),
      ]),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));

    expect(ptoRepo.create.mock.calls[0][0]).toMatchObject({
      kind: 'adjustment',
      minutes: -120,
    });
  });

  it('the ledger rows always sum to MINUS the requested total — what balance and the engine both read', async () => {
    const rows: Record<string, unknown>[] = [usageRow({ minutes: -480 })];
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => rows),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({ ptoRepo });

    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 300 }));
    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(-300);

    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 615 }));
    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(-615);

    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 0 }));
    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(0);
  });

  it('never updates or deletes a ledger row — the repository exposes neither', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [usageRow()]),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 60 }));
    expect(ptoRepo.update).toBeUndefined();
    expect(ptoRepo.delete).toBeUndefined();
  });

  it('asking for zero on a time off nobody ever marked paid is refused, not a phantom row', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => []),
    });
    const svc = service({ ptoRepo });
    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 0 }))
    ).rejects.toBeInstanceOf(PtoNothingToAdjustError);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// markTimeOffPaid vs cancel — the race (Phase 3/4 review, SERIOUS 8).
//
// The status guard reads `carer_time_off`, then inserts. A cancel committing
// in between leaves a `usage` row on a cancelled time off that
// `reconcileCancelledTimeOff` has ALREADY run past, so nothing ever reverses
// it. The insert is re-checked afterwards and loses gracefully.
// =============================================================================

describe('PtoCommandService.markTimeOffPaid — cancel racing the insert', () => {
  function racingTimeOffRepo(): any {
    let calls = 0;
    return {
      findById: mock(async () => {
        calls += 1;
        // First read (the status gate): still confirmed. Second read (after
        // the insert): the carer's cancel committed in between.
        return timeOff({ status: calls === 1 ? 'confirmed' : 'cancelled' });
      }),
    };
  }

  it('reverses its own usage row and refuses when the time off was cancelled mid-write', async () => {
    const rows: Record<string, unknown>[] = [];
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [...rows]),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({ ptoRepo, timeOffRepo: racingTimeOffRepo() });

    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }))
    ).rejects.toBeInstanceOf(PtoTimeOffNotConfirmedError);

    // The usage row was written, then reversed — append-only, and the
    // household's netted total for this time off is back to zero.
    expect(ptoRepo.create).toHaveBeenCalledTimes(2);
    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(0);
    expect(rows[1]).toMatchObject({ kind: 'adjustment', minutes: 480 });
  });

  it('does not re-check for nothing: an uncontested mark writes exactly one row', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
  });
});

describe('PtoCommandService.reconcileCancelledTimeOff', () => {
  it('is a no-op when nobody ever marked this time off paid', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => []),
    });
    const push = makePush();
    const svc = service({ ptoRepo, push });
    await svc.reconcileCancelledTimeOff('to-1');
    expect(ptoRepo.create).not.toHaveBeenCalled();
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('inserts a REVERSING adjustment row for the household that marked it paid', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [usageRow()]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    const written = ptoRepo.create.mock.calls[0][0];
    expect(written).toEqual({
      household_id: 'h1',
      carer_id: 'carer-1',
      kind: 'adjustment',
      minutes: 480, // the positive mirror of the usage row's -480
      effective_date: '2026-08-24',
      time_off_id: 'to-1',
      carer_display_name: 'Nia Rowe',
      note: expect.any(String),
      created_by: null,
    });
  });

  it('never deletes or mutates the original usage row (append-only)', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [usageRow()]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');
    expect(ptoRepo.update).toBeUndefined();
    expect(ptoRepo.delete).toBeUndefined();
  });

  it('reverses EVERY household that marked the same shared time off paid', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow(),
        usageRow({ id: 'ptl-2', household_id: 'h2', minutes: -240 }),
      ]),
    });
    const push = makePush();
    const svc = service({ ptoRepo, push });
    await svc.reconcileCancelledTimeOff('to-1');

    expect(ptoRepo.create).toHaveBeenCalledTimes(2);
    const householdsWritten = ptoRepo.create.mock.calls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>).household_id
    );
    expect(householdsWritten.sort()).toEqual(['h1', 'h2']);

    const notifiedHouseholds = push.notifyHouseholdParents.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(notifiedHouseholds.sort()).toEqual(['h1', 'h2']);
  });

  it('notifies the household parents via the PTO_USAGE_REVERSED push type, fire-and-forget', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [usageRow()]),
    });
    const push = makePush();
    const svc = service({ ptoRepo, push });
    await svc.reconcileCancelledTimeOff('to-1');

    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = push.notifyHouseholdParents.mock.calls[0];
    expect(householdId).toBe('h1');
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.PTO_USAGE_REVERSED,
      householdId: 'h1',
    });
  });

  it('a push failure never fails the reconciliation write', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [usageRow()]),
    });
    const push = makePush({
      notifyHouseholdParents: mock(() => {
        throw new Error('expo is down');
      }),
    });
    const svc = service({ ptoRepo, push });
    await expect(
      svc.reconcileCancelledTimeOff('to-1')
    ).resolves.toBeUndefined();
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
  });

  it('a DB failure on the reversing insert propagates (this write is the correction, not decorative)', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [usageRow()]),
      create: mock(async () => {
        throw new Error('db is down');
      }),
    });
    const svc = service({ ptoRepo });
    await expect(svc.reconcileCancelledTimeOff('to-1')).rejects.toThrow(
      'db is down'
    );
  });

  // ---------------------------------------------------------------------
  // Phase 3/4 review, BLOCKER 1(b): reconcile inserted a +minutes
  // adjustment for EVERY usage row it found, with no check for an existing
  // reversal. It is called fire-and-forget, so retries are guaranteed —
  // two +480 rows leave the balance permanently 8h high in an append-only
  // ledger that cannot be edited back.
  // ---------------------------------------------------------------------
  it('IDEMPOTENT: writes nothing when this household is already fully reversed', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow({ minutes: -480 }),
        adjustmentRow({ minutes: 480 }),
      ]),
    });
    const push = makePush();
    const svc = service({ ptoRepo, push });
    await svc.reconcileCancelledTimeOff('to-1');

    expect(ptoRepo.create).not.toHaveBeenCalled();
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('IDEMPOTENT across two runs against the same growing ledger', async () => {
    const rows: Record<string, unknown>[] = [usageRow({ minutes: -480 })];
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [...rows]),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({ ptoRepo });

    await svc.reconcileCancelledTimeOff('to-1');
    await svc.reconcileCancelledTimeOff('to-1');

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(0);
  });

  it('reverses only the REMAINDER when the marking was already adjusted down', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow({ minutes: -480 }),
        adjustmentRow({ minutes: 120 }), // corrected 8h -> 6h before the cancel
      ]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.create.mock.calls[0][0].minutes).toBe(360);
  });

  it('reverses the full netted total when the marking was adjusted UP', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow({ minutes: -480 }),
        adjustmentRow({ minutes: -120 }), // corrected 8h -> 10h
      ]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');

    expect(ptoRepo.create.mock.calls[0][0].minutes).toBe(600);
  });

  // ---------------------------------------------------------------------
  // Phase 3/4 review, mid-loop failure: the loop reversed household A and
  // then threw, leaving B un-reversed forever (there is no retry — the
  // caller is fire-and-forget).
  // ---------------------------------------------------------------------
  it('one household failing never strands the others — every household is still attempted', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow({ household_id: 'h1' }),
        usageRow({ id: 'ptl-2', household_id: 'h2', minutes: -240 }),
        usageRow({ id: 'ptl-3', household_id: 'h3', minutes: -60 }),
      ]),
      create: mock(async (row: Record<string, unknown>) => {
        if (row.household_id === 'h1') throw new Error('db is down');
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({ ptoRepo });

    await expect(svc.reconcileCancelledTimeOff('to-1')).rejects.toThrow();

    const attempted = ptoRepo.create.mock.calls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>).household_id
    );
    expect(attempted.sort()).toEqual(['h1', 'h2', 'h3']);
  });
});

// =============================================================================
// Multi-day time off spreads across the days it covers (Phase 3/4 review,
// finding 15b).
//
// One usage row on the START date put a fortnight's 80h into week one: week
// one showed an 80h PTO line and an inflated gross, week two showed nothing,
// and approving week one froze the wrong split. The marking is now one row
// per covered day.
// =============================================================================

describe('PtoCommandService.markTimeOffPaid — spreading a multi-day marking', () => {
  it('a SINGLE-day time off still writes exactly one row (no change to the common case)', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo, timeOffRepo: makeTimeOffRepo(timeOff()) });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.create.mock.calls[0][0]).toMatchObject({
      kind: 'usage',
      minutes: -480,
      effective_date: '2026-08-24',
    });
  });

  it('a three-day time off writes one usage row PER DAY', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 1440 }));

    expect(ptoRepo.create).toHaveBeenCalledTimes(3);
    const written = ptoRepo.create.mock.calls.map(
      (call: unknown[]) => call[0] as Record<string, unknown>
    );
    expect(
      written.map((row: Record<string, unknown>) => row.effective_date)
    ).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
    expect(written.map((row: Record<string, unknown>) => row.minutes)).toEqual([
      -480, -480, -480,
    ]);
    expect(
      written.every((row: Record<string, unknown>) => row.kind === 'usage')
    ).toBe(true);
    expect(
      written.every(
        (row: Record<string, unknown>) => row.time_off_id === 'to-1'
      )
    ).toBe(true);
  });

  it('a fortnight lands its minutes in BOTH weeks, not all in week one', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(14)),
    });
    // 80 hours across 14 days.
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 4800 }));

    const written = ptoRepo.create.mock.calls.map(
      (call: unknown[]) => call[0] as Record<string, unknown>
    );
    expect(written).toHaveLength(14);
    const weekOne = written
      .filter(
        (row: Record<string, unknown>) =>
          (row.effective_date as string) < '2026-08-31'
      )
      .reduce(
        (total: number, row: Record<string, unknown>) =>
          total + (row.minutes as number),
        0
      );
    const weekTwo = written
      .filter(
        (row: Record<string, unknown>) =>
          (row.effective_date as string) >= '2026-08-31'
      )
      .reduce(
        (total: number, row: Record<string, unknown>) =>
          total + (row.minutes as number),
        0
      );
    // Mon 24 Aug .. Sun 30 Aug is week one; Mon 31 Aug .. Sun 6 Sep is week two.
    // 4800 over 14 days is 342.857/day, so the two weeks cannot be exactly
    // equal — they must be within a minute of each other and sum to the
    // whole. Rounding a week's share is fine; losing a minute is not.
    expect(weekOne + weekTwo).toBe(-4800);
    expect(Math.abs(weekOne + 2400)).toBeLessThanOrEqual(1);
    expect(Math.abs(weekTwo + 2400)).toBeLessThanOrEqual(1);
  });

  it('NEVER loses or invents a minute when the total does not divide evenly', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 100 }));

    const minutes = ptoRepo.create.mock.calls.map(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).minutes as number
    );
    expect(minutes.reduce((total: number, m: number) => total + m, 0)).toBe(
      -100
    );
    expect(minutes).toEqual([-34, -33, -33]);
  });

  it('writes no zero-minute row when the total is smaller than the day count', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(5)),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 2 }));

    // `check (minutes <> 0)`: a day allocated nothing gets no row at all.
    expect(ptoRepo.create).toHaveBeenCalledTimes(2);
    const minutes = ptoRepo.create.mock.calls.map(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).minutes as number
    );
    expect(minutes).toEqual([-1, -1]);
  });

  it('returns the EARLIEST row written, so the response names a real anchor', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    const created = await svc.markTimeOffPaid(
      'parent-1',
      'h1',
      request({ minutes: 1440 })
    );
    expect(created.effective_date).toBe('2026-08-24');
  });
});

describe('PtoCommandService.markTimeOffPaid — correcting a multi-day marking', () => {
  /** Three days already marked at 480 each. */
  function threeDayRows(): Record<string, unknown>[] {
    return [
      usageRow({ id: 'u1', effective_date: '2026-08-24', minutes: -480 }),
      usageRow({ id: 'u2', effective_date: '2026-08-25', minutes: -480 }),
      usageRow({ id: 'u3', effective_date: '2026-08-26', minutes: -480 }),
    ];
  }

  it('spreads a DOWNWARD correction across the same days, keeping each week honest', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => threeDayRows()),
    });
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    // 24h marked, corrected to 18h.
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 1080 }));

    const written = ptoRepo.create.mock.calls.map(
      (call: unknown[]) => call[0] as Record<string, unknown>
    );
    expect(written).toHaveLength(3);
    expect(
      written.every((row: Record<string, unknown>) => row.kind === 'adjustment')
    ).toBe(true);
    expect(
      written.map((row: Record<string, unknown>) => row.effective_date)
    ).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
    expect(written.map((row: Record<string, unknown>) => row.minutes)).toEqual([
      120, 120, 120,
    ]);
  });

  it('an UPWARD correction is exact even when it does not divide evenly', async () => {
    const rows = threeDayRows();
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => rows),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 1450 }));

    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(-1450);
  });

  it('reversing a multi-day marking to zero clears EVERY day', async () => {
    const rows = threeDayRows();
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => rows),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 0 }));

    const written = ptoRepo.create.mock.calls.map(
      (call: unknown[]) => call[0] as Record<string, unknown>
    );
    expect(written.map((row: Record<string, unknown>) => row.minutes)).toEqual([
      480, 480, 480,
    ]);
    // Every DAY nets to zero, not merely the total.
    for (const date of ['2026-08-24', '2026-08-25', '2026-08-26']) {
      const perDay = rows
        .filter((row: Record<string, unknown>) => row.effective_date === date)
        .reduce(
          (total: number, row: Record<string, unknown>) =>
            total + (row.minutes as number),
          0
        );
      expect(perDay).toBe(0);
    }
  });

  it('re-submitting the same multi-day total writes nothing', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => threeDayRows()),
    });
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    const result = await svc.markTimeOffPaid(
      'parent-1',
      'h1',
      request({ minutes: 1440 })
    );
    expect(ptoRepo.create).not.toHaveBeenCalled();
    expect(result.id).toBe('u1');
  });

  it('a retry after a PARTIAL write fills in the MISSING DAYS, not just the total', async () => {
    // The first attempt wrote day one and then the connection dropped. A
    // retry must reach 1440 by covering days two and three — topping day one
    // up to 1440 would put the whole marking back on one date, which is the
    // very defect 15b fixes.
    const rows = [
      usageRow({ id: 'u1', effective_date: '2026-08-24', minutes: -480 }),
    ];
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [...rows]),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({
      ptoRepo,
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(3)),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 1440 }));

    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(-1440);
    for (const date of ['2026-08-24', '2026-08-25', '2026-08-26']) {
      const perDay = rows
        .filter((row: Record<string, unknown>) => row.effective_date === date)
        .reduce(
          (total: number, row: Record<string, unknown>) =>
            total + (row.minutes as number),
          0
        );
      expect(perDay).toBe(-480);
    }
  });

  it('a day the time off NO LONGER covers is taken back to zero', async () => {
    // The carer shortened her time off after it was marked paid: the ledger
    // still holds a day that is not part of the leave any more, and leaving
    // it standing would pay for a day she is working.
    const rows = [
      usageRow({ id: 'u1', effective_date: '2026-08-24', minutes: -480 }),
      usageRow({ id: 'u2', effective_date: '2026-08-25', minutes: -480 }),
    ];
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [...rows]),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({
      ptoRepo,
      // Now a one-day time off, covering 2026-08-24 only.
      timeOffRepo: makeTimeOffRepo(multiDayTimeOff(1)),
    });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));

    const dayTwo = rows
      .filter(
        (row: Record<string, unknown>) => row.effective_date === '2026-08-25'
      )
      .reduce(
        (total: number, row: Record<string, unknown>) =>
          total + (row.minutes as number),
        0
      );
    expect(dayTwo).toBe(0);
    expect(rows.reduce((t, r) => t + (r.minutes as number), 0)).toBe(-480);
  });
});

describe('PtoCommandService.reconcileCancelledTimeOff — multi-day markings', () => {
  it('reverses EVERY day of a multi-day marking, day by day', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow({ id: 'u1', effective_date: '2026-08-24', minutes: -480 }),
        usageRow({ id: 'u2', effective_date: '2026-09-01', minutes: -480 }),
      ]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');

    const written = ptoRepo.create.mock.calls.map(
      (call: unknown[]) => call[0] as Record<string, unknown>
    );
    expect(written).toHaveLength(2);
    expect(
      written.map((row: Record<string, unknown>) => row.effective_date)
    ).toEqual(['2026-08-24', '2026-09-01']);
    expect(written.map((row: Record<string, unknown>) => row.minutes)).toEqual([
      480, 480,
    ]);
  });

  it('still notifies the household only ONCE for a multi-day reversal', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow({ id: 'u1', effective_date: '2026-08-24', minutes: -480 }),
        usageRow({ id: 'u2', effective_date: '2026-08-25', minutes: -480 }),
      ]),
    });
    const push = makePush();
    const svc = service({ ptoRepo, push });
    await svc.reconcileCancelledTimeOff('to-1');
    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  it('is still idempotent per DAY — a day already reversed is left alone', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [
        usageRow({ id: 'u1', effective_date: '2026-08-24', minutes: -480 }),
        adjustmentRow({
          id: 'a1',
          effective_date: '2026-08-24',
          minutes: 480,
        }),
        usageRow({ id: 'u2', effective_date: '2026-08-25', minutes: -480 }),
      ]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.create.mock.calls[0][0]).toMatchObject({
      effective_date: '2026-08-25',
      minutes: 480,
    });
  });
});

// =============================================================================
// Ledger notes are stable machine KEYS, not English prose (Phase 3/4 review,
// finding 16a).
//
// `pto_ledger` is append-only and permanent. Prose written today can never be
// re-keyed later, so localising the ledger history would orphan every row
// already written — the precise mistake Wave 5's handoff chips made
// (PROJECT-STATUS.md: English display labels stored as row values, fixed to
// stable snake_case keys). A note a HUMAN typed is different: that is user
// content, not system copy, and it is stored verbatim.
// =============================================================================

describe('PtoCommandService — ledger notes are machine keys', () => {
  it('a correction with no parent note stores a KEY, not a sentence', async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [usageRow({ minutes: -480 })]),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 360 }));

    const note = ptoRepo.create.mock.calls[0][0].note as string;
    expect(note).toBe(PTO_LEDGER_NOTE_KEYS.MARKED_PAID_ADJUSTED);
    expect(note).not.toMatch(/\s/);
  });

  it('the cancel reversal stores a KEY', async () => {
    const ptoRepo = makePtoRepo({
      listAllForTimeOff: mock(async () => [usageRow()]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');

    const note = ptoRepo.create.mock.calls[0][0].note as string;
    expect(note).toBe(PTO_LEDGER_NOTE_KEYS.CANCELLED_TIME_OFF_REVERSED);
    expect(note).not.toMatch(/\s/);
  });

  it('the lost-race reversal stores its OWN key, distinguishable from a cancel', async () => {
    const rows: Record<string, unknown>[] = [];
    let findCalls = 0;
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [...rows]),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        return { ...createdUsageRow, ...row };
      }),
    });
    const timeOffRepo = {
      findById: mock(async () => {
        findCalls += 1;
        return timeOff({ status: findCalls === 1 ? 'confirmed' : 'cancelled' });
      }),
    };
    const svc = service({ ptoRepo, timeOffRepo });

    await expect(
      svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }))
    ).rejects.toBeInstanceOf(PtoTimeOffNotConfirmedError);

    expect(rows[1]?.note).toBe(
      PTO_LEDGER_NOTE_KEYS.CANCELLED_DURING_MARKING_REVERSED
    );
    expect(PTO_LEDGER_NOTE_KEYS.CANCELLED_DURING_MARKING_REVERSED).not.toBe(
      PTO_LEDGER_NOTE_KEYS.CANCELLED_TIME_OFF_REVERSED
    );
  });

  it("a PARENT'S OWN typed note is stored verbatim — user content is never keyed", async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid(
      'parent-1',
      'h1',
      request({ note: 'agreed with Nia over text on Tuesday' })
    );
    expect(ptoRepo.create.mock.calls[0][0].note).toBe(
      'agreed with Nia over text on Tuesday'
    );
  });

  it("a parent's note wins over the correction key on an adjustment too", async () => {
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [usageRow({ minutes: -480 })]),
    });
    const svc = service({ ptoRepo });
    await svc.markTimeOffPaid(
      'parent-1',
      'h1',
      request({ minutes: 360, note: 'she left early on the Friday' })
    );
    expect(ptoRepo.create.mock.calls[0][0].note).toBe(
      'she left early on the Friday'
    );
  });

  it('EVERY system-written note is one of the declared keys — no ad-hoc prose anywhere', async () => {
    const declared = new Set<string>(Object.values(PTO_LEDGER_NOTE_KEYS));
    const written: (string | null)[] = [];
    const rows: Record<string, unknown>[] = [];
    const ptoRepo = makePtoRepo({
      listForHouseholdTimeOff: mock(async () => [...rows]),
      listAllForTimeOff: mock(async () => [...rows]),
      create: mock(async (row: Record<string, unknown>) => {
        rows.push(row);
        written.push(row.note as string | null);
        return { ...createdUsageRow, ...row };
      }),
    });
    const svc = service({ ptoRepo });

    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 480 }));
    await svc.markTimeOffPaid('parent-1', 'h1', request({ minutes: 300 }));
    await svc.reconcileCancelledTimeOff('to-1');

    for (const note of written) {
      if (note === null) continue; // the usage row's own note is user text
      expect(declared.has(note)).toBe(true);
    }
  });
});
