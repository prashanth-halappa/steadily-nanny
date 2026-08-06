import { describe, expect, it, mock } from 'bun:test';
import {
  PTO_LEDGER_KINDS,
  PTO_LEDGER_NOTE_KEYS,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
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
 * Both lookups, with the real repository's semantics: the active-only one
 * hides a `removed` row, the any-status one returns it.
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
const REMOVED_NANNY = member('nanny', 'carer-1', 'removed');
const REMOVED_OTHER_NANNY = member('nanny', 'carer-2', 'removed');
const REMOVED_PARENT = member('parent', 'parent-1', 'removed');
const REMOVED_OWNER = member('owner', 'owner-1', 'removed');
const REMOVED_HELPER = member('helper', 'helper-1', 'removed');

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
      note: PTO_LEDGER_NOTE_KEYS.ANNUAL_GRANT,
      created_by: null,
    });
  });

  // Phase 3/4 review, finding 16a. The grant note used to be the English
  // prose "2026 annual PTO grant". `pto_ledger` is append-only and
  // permanent, so prose written today can never be re-keyed later —
  // localising the ledger history would orphan every row already written.
  // Wave 5's handoff chips paid for exactly this (PROJECT-STATUS.md): the
  // fix there was stable snake_case keys, and it is the fix here.
  it('writes a stable machine KEY as the note, never English prose', () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    return svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW).then(() => {
      const note = ptoRepo.create.mock.calls[0][0].note as string;
      expect(note).toBe('annual_grant');
      expect(note).not.toMatch(/\s/); // no prose, no spaces
      expect(note).not.toContain('2026'); // the year is already effective_date
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

  it("the grant amount comes from the arrangement effective on the household's LOCAL today", async () => {
    const ptoRepo = makePtoRepo();
    const payRepo = makePayRepo({
      ...arrangementWithEntitlement,
      pto_entitlement_minutes_per_year: 9600,
    });
    const svc = service({ 'parent-1': PARENT }, ptoRepo, payRepo);
    await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);
    expect(payRepo.effectiveOn).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-04'
    );
    expect(ptoRepo.create.mock.calls[0][0].minutes).toBe(9600);
    expect(ptoRepo.create.mock.calls[0][0].effective_date).toBe('2026-01-01');
  });

  // -------------------------------------------------------------------------
  // Phase 3/4 review, SERIOUS 4. `PtoYearQuerySchema` accepts any year
  // 2000–2100 and the lazy grant minted THAT year at TODAY's arrangement,
  // frozen. A nanny booking January time off (the client reads next year's
  // balance) wrote next year's grant NOW, at this year's entitlement, and it
  // can never be re-granted — only corrected by hand. Only the
  // household-LOCAL current year is grantable; every other year stays
  // readable and mints nothing.
  // -------------------------------------------------------------------------
  it('NEVER grants a FUTURE year — it stays readable, with no accrual row minted', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2027, NOW);
    expect(ptoRepo.create).not.toHaveBeenCalled();
    expect(balance.accrued_minutes).toBe(0);
    // The entitlement still reports, so the client can render "not granted yet".
    expect(balance.entitlement_minutes).toBe(16800);
  });

  it('NEVER grants a PAST year either — a year that was never granted stays ungranted', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    await svc.balance('parent-1', 'h1', 'carer-1', 2024, NOW);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('the grantable year is the HOUSEHOLD-LOCAL one, not UTC — 31 Dec 23:00 UTC is already the new year in Auckland', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service(
      { 'parent-1': PARENT },
      ptoRepo,
      makePayRepo(),
      'Pacific/Auckland'
    );
    const newYearsEveUtc = () => new Date('2026-12-31T23:00:00.000Z');

    // Local date is 2027-01-01 in Auckland, so 2027 is the grantable year...
    await svc.balance('parent-1', 'h1', 'carer-1', 2027, newYearsEveUtc);
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.create.mock.calls[0][0].effective_date).toBe('2027-01-01');

    // ...and 2026, the UTC year, is not.
    ptoRepo.create.mockClear();
    await svc.balance('parent-1', 'h1', 'carer-1', 2026, newYearsEveUtc);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('the ledger read applies the same rule as balance', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ 'parent-1': PARENT }, ptoRepo);
    await svc.ledger('parent-1', 'h1', 'carer-1', 2030, NOW);
    expect(ptoRepo.create).not.toHaveBeenCalled();
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

// =============================================================================
// PAYROLL AUDIT TRAIL — a `removed` member keeps READ access to the PTO she
// accrued and used, with the SAME role scoping as an active one. The lazy
// annual grant, which is a WRITE riding on a read, stays active-only.
// =============================================================================

describe('PtoQueryService — removed members keep READ access', () => {
  it('a removed nanny still reads her OWN balance and ledger', async () => {
    const ptoRepo = makePtoRepo({
      listForCarerYear: mock(async () => [accrualRow(), usageRow()]),
    });
    const svc = service({ 'carer-1': REMOVED_NANNY }, ptoRepo);
    const balance = await svc.balance('carer-1', 'h1', 'carer-1', 2026, NOW);
    expect(balance.balance_minutes).toBe(16320);
    expect(
      await svc.ledger('carer-1', 'h1', 'carer-1', 2026, NOW)
    ).toHaveLength(2);
  });

  it("a removed nanny is STILL denied another carer's PTO", async () => {
    const svc = service({ 'carer-2': REMOVED_OTHER_NANNY, 'carer-1': NANNY });
    await expect(
      svc.balance('carer-2', 'h1', 'carer-1', 2026, NOW)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });

  it('a removed parent still reads any carer’s balance', async () => {
    const svc = service({ 'parent-1': REMOVED_PARENT });
    await expect(
      svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW)
    ).resolves.toBeDefined();
  });

  it('a removed owner still reads the ledger', async () => {
    const svc = service({ 'owner-1': REMOVED_OWNER });
    await expect(
      svc.ledger('owner-1', 'h1', 'carer-1', 2026, NOW)
    ).resolves.toBeDefined();
  });

  it('a removed HELPER stays denied — no pay surface, active or not', async () => {
    const svc = service({ 'helper-1': REMOVED_HELPER });
    await expect(
      svc.balance('helper-1', 'h1', 'carer-1', 2026, NOW)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });

  it('a removed member’s read NEVER mints the lazy annual grant — reads stay reads', async () => {
    // The grant is a write. Opening the read to removed members must not open
    // a write with it: a nanny who left in March would otherwise hand herself
    // a full year's entitlement just by opening the screen.
    const ptoRepo = makePtoRepo();
    const svc = service({ 'carer-1': REMOVED_NANNY }, ptoRepo);
    await svc.balance('carer-1', 'h1', 'carer-1', 2026, NOW);
    await svc.ledger('carer-1', 'h1', 'carer-1', 2026, NOW);
    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('an ACTIVE member’s read still grants — the skip is status-scoped, not a removal of the feature', async () => {
    const ptoRepo = makePtoRepo();
    const svc = service({ 'carer-1': NANNY }, ptoRepo);
    await svc.balance('carer-1', 'h1', 'carer-1', 2026, NOW);
    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
  });

  it('the gate uses the any-status lookup, never the active-only one', async () => {
    const memberRepo = makeMemberRepo({ 'carer-1': REMOVED_NANNY });
    const svc = new PtoQueryService(
      makePtoRepo(),
      makePayRepo(),
      memberRepo,
      makeHouseholdRepo()
    );
    await svc.balance('carer-1', 'h1', 'carer-1', 2026, NOW);
    expect(memberRepo.findMembershipAnyStatus).toHaveBeenCalledWith(
      'h1',
      'carer-1'
    );
    expect(memberRepo.findActiveMembership).not.toHaveBeenCalled();
  });
});

describe('PtoQueryService — what a rejoin does to the balance (rejoin review, decision 2)', () => {
  // The review asked for a fix to "a rejoin in a new calendar year grants a
  // fresh full year ON TOP of the old leftover". These two tests pin what the
  // code actually does, because that stacking cannot happen here: the ledger
  // read is YEAR-WINDOWED (`effective_date` between Jan 1 and Dec 31), so a
  // previous year's leftover is not in the new year's balance to be stacked
  // on. Nothing was changed; if either behaviour ever moves, this goes red.
  it('a rejoin in the SAME year does not re-grant — the existing balance is kept', async () => {
    const rows = [
      {
        id: 'ptl-grant',
        kind: 'accrual',
        minutes: 1200,
        effective_date: '2026-01-01',
      },
      {
        id: 'ptl-used',
        kind: 'usage',
        minutes: -300,
        effective_date: '2026-04-02',
      },
    ];
    const ptoRepo = makePtoRepo({ listForCarerYear: mock(async () => rows) });
    const svc = service({ 'parent-1': PARENT, 'carer-1': NANNY }, ptoRepo);

    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);

    // Short-circuited on the existing accrual row: no second grant.
    expect(ptoRepo.create).not.toHaveBeenCalled();
    expect(balance.accrued_minutes).toBe(1200);
    expect(balance.balance_minutes).toBe(900);
  });

  it('a NEW calendar year grants once and carries nothing forward — nothing to stack on', async () => {
    // Exactly what a continuously-employed carer gets each January. The
    // previous year's leftover is outside this year's window, so the fresh
    // grant is the whole balance rather than an addition to it.
    const ptoRepo = makePtoRepo();
    const svc = service({ 'parent-1': PARENT, 'carer-1': NANNY }, ptoRepo);

    const balance = await svc.balance('parent-1', 'h1', 'carer-1', 2026, NOW);

    expect(ptoRepo.create).toHaveBeenCalledTimes(1);
    expect(ptoRepo.listForCarerYear).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      2026
    );
    expect(balance.accrued_minutes).toBe(0); // the re-read mock returns []
  });
});
