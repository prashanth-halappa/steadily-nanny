import { describe, expect, it, mock } from 'bun:test';
import { PTO_LEDGER_KINDS } from '@steadily-nanny/shared-types/schemas/pto.schema';
import {
  PtoAccrualGrantRaceError,
  PtoNotFoundError,
} from '../../../../../src/domains/pay/errors/payErrors';
import { PtoQueryService } from '../../../../../src/domains/pay/services/ptoQueryService';

const arrangementWithEntitlement = {
  id: 'pa-1',
  household_id: 'h1',
  carer_id: 'carer-1',
  rate_minor: 1500,
  bill_rate_minor: null,
  currency: 'GBP',
  overtime_threshold_minutes: null,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: 16800,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
  valid_from: '2026-01-01',
  carer_display_name: 'Nia Rowe',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-01-01T09:00:00.000Z',
};

const arrangementNoEntitlement = {
  ...arrangementWithEntitlement,
  id: 'pa-2',
  pto_entitlement_minutes_per_year: null,
};

function accrualRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ptl-accrual',
    household_id: 'h1',
    carer_id: 'carer-1',
    kind: PTO_LEDGER_KINDS.ACCRUAL,
    minutes: 16800,
    effective_date: '2026-01-01',
    time_off_id: null,
    carer_display_name: 'Nia Rowe',
    note: '2026 annual grant',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function usageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ptl-usage',
    household_id: 'h1',
    carer_id: 'carer-1',
    kind: PTO_LEDGER_KINDS.USAGE,
    minutes: -480,
    effective_date: '2026-08-01',
    time_off_id: 'to-1',
    carer_display_name: 'Nia Rowe',
    note: null,
    created_by: 'parent-1',
    created_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

function member(role: string, userId: string): Record<string, unknown> {
  return { id: `m-${userId}`, household_id: 'h1', user_id: userId, role };
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

function makePayRepo(
  arrangement: Record<string, unknown> | null = arrangementWithEntitlement
): any {
  return { effectiveOn: mock(async () => arrangement) };
}

function makePtoRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarerYear: mock(async () => []),
    create: mock(async (row: Record<string, unknown>) => ({
      id: 'ptl-new',
      ...row,
    })),
    ...overrides,
  };
}

const PARENT = member('parent', 'parent-1');
const OWNER = member('owner', 'owner-1');
const NANNY = member('nanny', 'carer-1');
const OTHER_NANNY = member('nanny', 'carer-2');
const HELPER = member('helper', 'helper-1');

function service(
  members: Record<string, unknown>,
  ptoRepo = makePtoRepo(),
  payRepo = makePayRepo(),
  timezone = 'Europe/London'
): any {
  return new PtoQueryService(
    ptoRepo,
    payRepo,
    makeMemberRepo(members),
    makeHouseholdRepo(timezone)
  );
}

const NOW = () => new Date('2026-08-04T10:00:00.000Z');

describe('PtoQueryService.balance — read gating (mirrors payArrangementQueryService)', () => {
  it('a parent reads the balance', async () => {
    const svc = service({ 'parent-1': PARENT, 'carer-1': NANNY });
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.carer_id).toBe('carer-1');
  });

  it('an owner reads it too', async () => {
    const svc = service({ 'owner-1': OWNER, 'carer-1': NANNY });
    await expect(
      svc.balance('owner-1', 'h1', 'carer-1', 2026, NOW)
    ).resolves.toBeDefined();
  });

  it('the carer reads her OWN balance', async () => {
    const svc = service({ 'carer-1': NANNY });
    await expect(
      svc.balance('carer-1', 'h1', 'carer-1', 2026, NOW)
    ).resolves.toBeDefined();
  });

  it('a HELPER is denied', async () => {
    const svc = service({ 'helper-1': HELPER, 'carer-1': NANNY });
    await expect(
      svc.balance('helper-1', 'h1', 'carer-1', 2026, NOW)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });

  it("another nanny is denied this carer's balance", async () => {
    const svc = service({ 'carer-2': OTHER_NANNY, 'carer-1': NANNY });
    await expect(
      svc.balance('carer-2', 'h1', 'carer-1', 2026, NOW)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });

  it('a non-member is denied with the SAME error (no existence leak)', async () => {
    const svc = service({});
    await expect(
      svc.balance('stranger', 'h1', 'carer-1', 2026, NOW)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });
});

describe('PtoQueryService.balance — no ledger rows yet', () => {
  it('with no entitlement configured: entitlement is null, NOT a zero grant, and nothing is written', async () => {
    const ptoRepo = makePtoRepo();
    const payRepo = makePayRepo(arrangementNoEntitlement);
    const svc = service({ 'parent-1': PARENT }, ptoRepo, payRepo);
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.entitlement_minutes).toBeNull();
    expect(balance.accrued_minutes).toBe(0);
    expect(balance.used_minutes).toBe(0);
    expect(balance.balance_minutes).toBe(0);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('with no arrangement at all: entitlement is null, no grant written', async () => {
    const ptoRepo = makePtoRepo();
    const payRepo = makePayRepo(null);
    const svc = service({ 'parent-1': PARENT }, ptoRepo, payRepo);
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.entitlement_minutes).toBeNull();
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });
});

describe('PtoQueryService.balance — the lazy annual grant', () => {
  it('grants the entitlement dated 1 Jan when no accrual row exists yet for the year', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    const written = ptoRepo.create.mock.calls[0][0];
    expect(written).toEqual({
      household_id: 'h1',
      carer_id: 'carer-1',
      kind: PTO_LEDGER_KINDS.ACCRUAL,
      minutes: 16800,
      effective_date: '2026-01-01',
      time_off_id: null,
      carer_display_name: 'Nia Rowe',
      note: expect.any(String),
      created_by: null,
    });
  });

  it('is idempotent: an existing accrual row for the year is never re-granted', async () => {
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [accrualRow()]),
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('the grant amount comes from the arrangement effective AT GRANT TIME (household-local today), not the requested year', async () => {
    const ptoRepo = makePtoRepo();
    const payRepo = makePayRepo({
      ...arrangementWithEntitlement,
      pto_entitlement_minutes_per_year: 9600,
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo, payRepo);
    // Requesting a PAST year (2024) still grants using TODAY's arrangement.
    await svc.balance('parent-1', 'h1', 'carer-1', 2024, NOW);
    expect(payRepo.effectiveOn).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-04'
    );
    expect(ptoRepo.create.mock.calls[0][0].minutes).toBe(9600);
    expect(ptoRepo.create.mock.calls[0][0].effective_date).toBe('2024-01-01');
  });

  it('RACE: a duplicate-key error on the grant insert is swallowed, not thrown, and the winner is re-read', async () => {
    let listCalls = 0;
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => {
        listCalls += 1;
        // First read (before the grant attempt): nothing yet.
        // Second read (after losing the race): the winner's row is there.
        return listCalls === 1 ? [] : [accrualRow()];
      }),
      create: mock(async () => {
        throw new PtoAccrualGrantRaceError('h1', 'carer-1', '2026-01-01');
      }),
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.accrued_minutes).toBe(16800);
    expect(listCalls).toBe(2);
  });

  it('a non-race error from the grant insert still propagates', async () => {
    const ptoRepo = makePtoRepo({
      create: mock(async () => {
        throw new Error('db is down');
      }),
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    await expect(
      svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW)
    ).rejects.toThrow('db is down');
  });
});

describe('PtoQueryService.balance — aggregation', () => {
  it('sums accrual, usage and adjustment rows into accrued/used/balance', async () => {
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [
        accrualRow({ minutes: 16800 }),
        usageRow({ minutes: -480 }),
        usageRow({ id: 'u2', minutes: -960, time_off_id: 'to-2' }),
        { ...usageRow({ minutes: 240 }), kind: PTO_LEDGER_KINDS.ADJUSTMENT },
      ]),
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.accrued_minutes).toBe(16800 + 240);
    expect(balance.used_minutes).toBe(480 + 960);
    expect(balance.balance_minutes).toBe(16800 - 480 - 960 + 240);
  });

  it('a negative adjustment counts toward used_minutes, not accrued', async () => {
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [
        accrualRow({ minutes: 16800 }),
        {
          ...accrualRow({ id: 'adj' }),
          kind: PTO_LEDGER_KINDS.ADJUSTMENT,
          minutes: -120,
        },
      ]),
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.accrued_minutes).toBe(16800);
    expect(balance.used_minutes).toBe(120);
    expect(balance.balance_minutes).toBe(16680);
  });

  it('allows a NEGATIVE balance — over-balance is never clamped', async () => {
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [
        accrualRow({ minutes: 480 }),
        usageRow({ minutes: -960 }),
      ]),
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.balance_minutes).toBe(-480);
  });
});

describe('PtoQueryService.ledger', () => {
  it('read-gates the same way as balance', async () => {
    const svc = service({ 'helper-1': HELPER });
    await expect(
      svc.ledger('helper-1', 'h1', 'carer-1', 2026, NOW)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });

  it('returns the rows for the requested year, granting lazily first', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    await svc.ledger('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.listForCarerYear).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      2026
    );
  });
});
