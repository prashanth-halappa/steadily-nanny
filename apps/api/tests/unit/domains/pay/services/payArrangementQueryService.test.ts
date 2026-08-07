import { describe, expect, it, mock } from 'bun:test';
import { PayArrangementNotFoundError } from '../../../../../src/domains/pay/errors/payErrors';
import { PayArrangementQueryService } from '../../../../../src/domains/pay/services/payArrangementQueryService';
import type { PayArrangement } from '../../../../../src/domains/pay/types';

const arrangement: PayArrangement = {
  id: 'pa-1',
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
  cancellation_paid_within_hours: null,
  valid_from: '2026-01-01',
  // 065: null = these terms are still live (set only on member removal).
  valid_to: null,
  carer_display_name: 'Nia Rowe',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-01-01T09:00:00.000Z',
};

const olderArrangement: PayArrangement = {
  ...arrangement,
  id: 'pa-0',
  rate_minor: 1400,
  valid_from: '2025-06-01',
  // 065: null = these terms are still live (set only on member removal).
  valid_to: null,
  created_at: '2025-05-20T09:00:00.000Z',
};

function makePayRepo(overrides: Record<string, unknown> = {}): any {
  return {
    effectiveOn: mock(async () => arrangement),
    listForCarer: mock(async () => [arrangement, olderArrangement]),
    ...overrides,
  };
}

function member(
  role: string,
  userId: string,
  status = 'active'
): Record<string, unknown> {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
    role,
    status,
  };
}

/**
 * Membership lookup keyed by user id, so caller and carer resolve separately.
 * Both repository methods are stubbed with the real ones' semantics: the
 * active-only lookup hides a `removed` row, the any-status one returns it.
 */
function makeMemberRepo(byUserId: Record<string, any>): any {
  return {
    findActiveMembership: mock(async (_householdId: string, userId: string) => {
      const row = byUserId[userId];
      return row && row.status !== 'removed' ? row : null;
    }),
    findMembershipAnyStatus: mock(
      async (_householdId: string, userId: string) => byUserId[userId] ?? null
    ),
  };
}

function makeHouseholdRepo(timezone = 'Europe/London'): any {
  return { findById: mock(async () => ({ id: 'h1', timezone })) };
}

const PARENT = member('parent', 'parent-1');
const OWNER = member('owner', 'owner-1');
const NANNY = member('nanny', 'carer-1');
const OTHER_NANNY = member('nanny', 'carer-2');
const HELPER = member('helper', 'helper-1');
const REMOVED_NANNY = member('nanny', 'carer-1', 'removed');
const REMOVED_OTHER_NANNY = member('nanny', 'carer-2', 'removed');
const REMOVED_PARENT = member('parent', 'parent-1', 'removed');
const REMOVED_OWNER = member('owner', 'owner-1', 'removed');
const REMOVED_HELPER = member('helper', 'helper-1', 'removed');

function service(
  members: Record<string, unknown>,
  payRepo = makePayRepo(),
  timezone = 'Europe/London'
): any {
  return new PayArrangementQueryService(
    payRepo,
    makeMemberRepo(members),
    makeHouseholdRepo(timezone)
  );
}

describe('PayArrangementQueryService.getCurrent — read gating', () => {
  it('a parent reads the carer’s current terms', async () => {
    const svc = service({ 'parent-1': PARENT, 'carer-1': NANNY });
    expect(await svc.getCurrent('parent-1', 'h1', 'carer-1')).toEqual(
      arrangement
    );
  });

  it('an owner reads them too', async () => {
    const svc = service({ 'owner-1': OWNER, 'carer-1': NANNY });
    expect(await svc.getCurrent('owner-1', 'h1', 'carer-1')).toEqual(
      arrangement
    );
  });

  it('the carer reads her OWN terms (opaque pay is the disease)', async () => {
    const svc = service({ 'carer-1': NANNY });
    expect(await svc.getCurrent('carer-1', 'h1', 'carer-1')).toEqual(
      arrangement
    );
  });

  it('a HELPER is denied — helpers have no access to pay (CX spec)', async () => {
    const svc = service({ 'helper-1': HELPER, 'carer-1': NANNY });
    await expect(
      svc.getCurrent('helper-1', 'h1', 'carer-1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it("a nanny is denied another carer's terms in the same household", async () => {
    const svc = service({ 'carer-2': OTHER_NANNY, 'carer-1': NANNY });
    await expect(
      svc.getCurrent('carer-2', 'h1', 'carer-1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('a non-member is denied with the SAME error (no existence leak)', async () => {
    const svc = service({});
    await expect(
      svc.getCurrent('stranger', 'h1', 'carer-1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('returns null — never a zero-rate stand-in — when no arrangement is in effect', async () => {
    const svc = service(
      { 'parent-1': PARENT },
      makePayRepo({ effectiveOn: mock(async () => null) })
    );
    expect(await svc.getCurrent('parent-1', 'h1', 'carer-1')).toBeNull();
  });
});

describe('PayArrangementQueryService.getCurrent — household-local today', () => {
  it("resolves against the HOUSEHOLD's local date, not the server's UTC date", async () => {
    // 2026-08-04T23:30Z is already 2026-08-05 in Auckland.
    const payRepo = makePayRepo();
    const svc = service({ 'parent-1': PARENT }, payRepo, 'Pacific/Auckland');
    await svc.getCurrent(
      'parent-1',
      'h1',
      'carer-1',
      () => new Date('2026-08-04T23:30:00.000Z')
    );
    expect(payRepo.effectiveOn).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-05'
    );
  });

  it('and west of UTC the local date can still be yesterday', async () => {
    const payRepo = makePayRepo();
    const svc = service({ 'parent-1': PARENT }, payRepo, 'America/Los_Angeles');
    await svc.getCurrent(
      'parent-1',
      'h1',
      'carer-1',
      () => new Date('2026-08-05T04:30:00.000Z')
    );
    expect(payRepo.effectiveOn).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-04'
    );
  });
});

describe('PayArrangementQueryService.getHistory', () => {
  it('returns the append-only history newest-first for a parent', async () => {
    const svc = service({ 'parent-1': PARENT });
    expect(await svc.getHistory('parent-1', 'h1', 'carer-1')).toEqual([
      arrangement,
      olderArrangement,
    ]);
  });

  it('the carer sees her own history', async () => {
    const svc = service({ 'carer-1': NANNY });
    const history = await svc.getHistory('carer-1', 'h1', 'carer-1');
    expect(history.map((row: PayArrangement) => row.id)).toEqual([
      'pa-1',
      'pa-0',
    ]);
  });

  it('a helper is denied the history as well', async () => {
    const svc = service({ 'helper-1': HELPER });
    await expect(
      svc.getHistory('helper-1', 'h1', 'carer-1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('returns [] for a carer with no arrangements yet', async () => {
    const svc = service(
      { 'parent-1': PARENT },
      makePayRepo({ listForCarer: mock(async () => []) })
    );
    expect(await svc.getHistory('parent-1', 'h1', 'carer-1')).toEqual([]);
  });
});

// =============================================================================
// PAYROLL AUDIT TRAIL — a `removed` member keeps READ access to the terms she
// worked under, with the SAME role scoping as an active one. Writes
// (payArrangementCommandService) stay active-only.
// =============================================================================

describe('PayArrangementQueryService — removed members keep READ access', () => {
  it('a removed nanny still reads her OWN terms and history', async () => {
    const svc = service({ 'carer-1': REMOVED_NANNY });
    expect(await svc.getCurrent('carer-1', 'h1', 'carer-1')).toEqual(
      arrangement
    );
    expect(
      (await svc.getHistory('carer-1', 'h1', 'carer-1')).map(
        (row: PayArrangement) => row.id
      )
    ).toEqual(['pa-1', 'pa-0']);
  });

  it("a removed nanny is STILL denied another carer's terms", async () => {
    const svc = service({ 'carer-2': REMOVED_OTHER_NANNY, 'carer-1': NANNY });
    await expect(
      svc.getCurrent('carer-2', 'h1', 'carer-1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('a removed parent still reads any carer’s terms — they paid the money', async () => {
    const svc = service({ 'parent-1': REMOVED_PARENT });
    expect(await svc.getCurrent('parent-1', 'h1', 'carer-1')).toEqual(
      arrangement
    );
  });

  it('a removed owner keeps the history read too', async () => {
    const svc = service({ 'owner-1': REMOVED_OWNER });
    expect(await svc.getHistory('owner-1', 'h1', 'carer-1')).toEqual([
      arrangement,
      olderArrangement,
    ]);
  });

  it('a removed HELPER stays denied — no pay surface, active or not', async () => {
    const svc = service({ 'helper-1': REMOVED_HELPER });
    await expect(
      svc.getCurrent('helper-1', 'h1', 'carer-1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('the gate uses the any-status lookup, never the active-only one', async () => {
    const memberRepo = makeMemberRepo({ 'carer-1': REMOVED_NANNY });
    const svc = new PayArrangementQueryService(
      makePayRepo(),
      memberRepo,
      makeHouseholdRepo()
    );
    await svc.getCurrent('carer-1', 'h1', 'carer-1');
    expect(memberRepo.findMembershipAnyStatus).toHaveBeenCalledWith(
      'h1',
      'carer-1'
    );
    expect(memberRepo.findActiveMembership).not.toHaveBeenCalled();
  });
});
