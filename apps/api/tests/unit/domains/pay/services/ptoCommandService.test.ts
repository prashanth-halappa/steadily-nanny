import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import {
  PtoAlreadyMarkedPaidError,
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

function timeOff(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'to-1',
    user_id: 'carer-1',
    starts_at: '2026-08-24T00:00:00.000Z',
    ends_at: '2026-08-27T00:00:00.000Z',
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
    findAllUsageForTimeOff: mock(async () => []),
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

describe('PtoCommandService.reconcileCancelledTimeOff', () => {
  it('is a no-op when nobody ever marked this time off paid', async () => {
    const ptoRepo = makePtoRepo({
      findAllUsageForTimeOff: mock(async () => []),
    });
    const push = makePush();
    const svc = service({ ptoRepo, push });
    await svc.reconcileCancelledTimeOff('to-1');
    expect(ptoRepo.create).not.toHaveBeenCalled();
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('inserts a REVERSING adjustment row for the household that marked it paid', async () => {
    const usage = {
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
    };
    const ptoRepo = makePtoRepo({
      findAllUsageForTimeOff: mock(async () => [usage]),
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
    const usage = {
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
    };
    const ptoRepo = makePtoRepo({
      findAllUsageForTimeOff: mock(async () => [usage]),
    });
    const svc = service({ ptoRepo });
    await svc.reconcileCancelledTimeOff('to-1');
    expect(ptoRepo.update).toBeUndefined();
    expect(ptoRepo.delete).toBeUndefined();
  });

  it('reverses EVERY household that marked the same shared time off paid', async () => {
    const usageH1 = {
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
    };
    const usageH2 = {
      ...usageH1,
      id: 'ptl-2',
      household_id: 'h2',
      minutes: -240,
    };
    const ptoRepo = makePtoRepo({
      findAllUsageForTimeOff: mock(async () => [usageH1, usageH2]),
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
    const usage = {
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
    };
    const ptoRepo = makePtoRepo({
      findAllUsageForTimeOff: mock(async () => [usage]),
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
    const usage = {
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
    };
    const ptoRepo = makePtoRepo({
      findAllUsageForTimeOff: mock(async () => [usage]),
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
    const usage = {
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
    };
    const ptoRepo = makePtoRepo({
      findAllUsageForTimeOff: mock(async () => [usage]),
      create: mock(async () => {
        throw new Error('db is down');
      }),
    });
    const svc = service({ ptoRepo });
    await expect(svc.reconcileCancelledTimeOff('to-1')).rejects.toThrow(
      'db is down'
    );
  });
});
