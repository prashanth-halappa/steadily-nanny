/**
 * @module tests/unit/domains/pay/services/reimbursementSettlementService
 *
 * The read-scope matrix and the five write gates of D-14's settlement record
 * (migration 086). Shaped on `expenseQueryService.test.ts` (the read matrix)
 * and `paymentCommandService.test.ts` (the gate ordering).
 *
 * EVERY MONEY FIGURE HERE IS A HAND-COMPUTED INTEGER. The approved-claim
 * fixtures are 1_250 + 990 + 12_360 minor, and the assertion is the literal
 * `14_600` — never a sum re-derived in the test from the same array the
 * service folds, which would pass on a service that summed nothing.
 */
import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import {
  AlreadySettledError,
  NothingToSettleError,
  ReimbursementSettlementNotFoundError,
  SettlementCurrencyMismatchError,
} from '../../../../../src/domains/pay/errors/payErrors';
import { ReimbursementSettlementService } from '../../../../../src/domains/pay/services/reimbursementSettlementService';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_OFFSET = FIXTURE_TS.replace('.000Z', '+00:00');

/**
 * `+00:00` deliberately on one fixture and `.000Z` on the other — the two
 * legal serialisations of a `timestamptz` (GOLDEN-FIXES #25), so anything
 * that string-compares timestamps here fails in the test as it would in
 * production.
 */
function settlementRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'set-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    week_start: '2026-08-03',
    amount_minor: 14_600,
    currency: 'GBP',
    settled_at: '2026-08-10',
    note: 'Cash on Friday',
    recorded_by: 'parent-1',
    created_at: FIXTURE_TS_OFFSET,
    ...overrides,
  };
}

/** Three approved claims for carer-1: 1_250 + 990 + 12_360 = 14_600 minor. */
function approvedClaims(): Record<string, unknown>[] {
  return [
    approvedClaim({ id: 'e1', amount_minor: 1_250 }),
    approvedClaim({ id: 'e2', amount_minor: 990 }),
    approvedClaim({ id: 'e3', amount_minor: 12_360 }),
    // carer-2's claim: present in the household week, MUST NOT be summed.
    approvedClaim({ id: 'e4', carer_id: 'carer-2', amount_minor: 50_000 }),
  ];
}

function approvedClaim(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'e1',
    household_id: 'h1',
    carer_id: 'carer-1',
    local_date: '2026-08-04',
    kind: 'expense',
    description: 'Craft supplies',
    amount_minor: 1_250,
    miles: null,
    currency: 'GBP',
    status: 'approved',
    reviewed_by: 'parent-1',
    reviewed_at: '2026-08-05T09:00:00.000Z',
    review_note: null,
    created_at: '2026-08-04T09:00:00.000Z',
    updated_at: '2026-08-05T09:00:00.000Z',
    ...overrides,
  };
}

function makeSettlementRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForWeek: mock(async () => [
      settlementRow({ id: 'mine', carer_id: 'carer-1' }),
      settlementRow({
        id: 'theirs',
        carer_id: 'carer-2',
        created_at: FIXTURE_TS,
      }),
    ]),
    create: mock(async (data: Record<string, unknown>) =>
      settlementRow({ id: 'set-new', ...data })
    ),
    ...overrides,
  };
}

function makeExpenseRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listApprovedForWeek: mock(async () => approvedClaims()),
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
 * Both lookups behave like the real repository: the active-only one hides a
 * `removed` row, the any-status one returns it — so a gate calling the wrong
 * one fails here for the same reason it would in production.
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

function makeHouseholdRepo(currency = 'GBP'): any {
  return {
    findById: mock(async () => ({
      id: 'h1',
      timezone: 'Europe/London',
      week_starts_on: 1,
      currency,
    })),
  };
}

const PARENT = member('parent', 'parent-1');
const OWNER = member('owner', 'owner-1');
const NANNY = member('nanny', 'carer-1');
const OTHER_NANNY = member('nanny', 'carer-2');
const HELPER = member('helper', 'helper-1');
const REMOVED_NANNY = member('nanny', 'carer-1', 'removed');
const REMOVED_PARENT = member('parent', 'parent-1', 'removed');

interface Parts {
  members?: Record<string, any>;
  settlementRepo?: any;
  expenseRepo?: any;
  currency?: string;
}

function service(parts: Parts = {}): any {
  return new ReimbursementSettlementService(
    parts.settlementRepo ?? makeSettlementRepo(),
    parts.expenseRepo ?? makeExpenseRepo(),
    makeMemberRepo(parts.members ?? { 'parent-1': PARENT, 'carer-1': NANNY }),
    makeHouseholdRepo(parts.currency ?? 'GBP'),
    { notifyUser: mock(() => undefined) }
  );
}

/** Tuesday 2026-08-04 mid-morning UTC — inside the London week of 2026-08-03. */
const NOW = () => new Date('2026-08-04T10:00:00.000Z');

const VALID_INPUT = {
  carer_id: 'carer-1',
  week_start: '2026-08-03',
  settled_at: '2026-08-10',
  note: 'Cash on Friday',
};

// ===========================================================================
// Read scope
// ===========================================================================

describe('ReimbursementSettlementService.listForWeek — read scope', () => {
  it('a parent sees every carer’s settlements', async () => {
    const svc = service({ members: { 'parent-1': PARENT } });
    const rows = await svc.listForWeek('parent-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('an owner sees every carer’s settlements too', async () => {
    const svc = service({ members: { 'owner-1': OWNER } });
    const rows = await svc.listForWeek('owner-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('a nanny sees ONLY her own rows', async () => {
    const svc = service({
      members: { 'carer-1': NANNY, 'carer-2': OTHER_NANNY },
    });
    const rows = await svc.listForWeek('carer-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id)).toEqual(['mine']);
  });

  it('a REMOVED nanny keeps her own-rows read (payroll is an audit trail)', async () => {
    const svc = service({ members: { 'carer-1': REMOVED_NANNY } });
    const rows = await svc.listForWeek('carer-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id)).toEqual(['mine']);
  });

  it('a REMOVED parent keeps the household-wide read', async () => {
    const svc = service({ members: { 'parent-1': REMOVED_PARENT } });
    const rows = await svc.listForWeek('parent-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('a helper is denied with the opaque 404', async () => {
    const svc = service({ members: { 'helper-1': HELPER } });
    await expect(
      svc.listForWeek('helper-1', 'h1', '2026-08-03', NOW)
    ).rejects.toBeInstanceOf(ReimbursementSettlementNotFoundError);
  });

  it('a non-member is denied with the SAME opaque 404', async () => {
    const svc = service({ members: {} });
    await expect(
      svc.listForWeek('stranger-1', 'h1', '2026-08-03', NOW)
    ).rejects.toBeInstanceOf(ReimbursementSettlementNotFoundError);
  });

  it('omitting weekStart resolves the household-local week, never a hardcoded Monday', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({
      members: { 'parent-1': PARENT },
      settlementRepo,
    });
    await svc.listForWeek('parent-1', 'h1', undefined, NOW);
    expect(settlementRepo.listForWeek).toHaveBeenCalledWith('h1', '2026-08-03');
  });
});

// ===========================================================================
// Write gates
// ===========================================================================

describe('ReimbursementSettlementService.create — gates', () => {
  it('sums ONLY that carer’s approved claims, as exact integers: 1_250 + 990 + 12_360', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({ members: { 'parent-1': PARENT }, settlementRepo });

    const settlement = await svc.create('parent-1', 'h1', VALID_INPUT);

    const [written] = settlementRepo.create.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(written.amount_minor).toBe(14_600);
    expect(Number.isInteger(written.amount_minor)).toBe(true);
    expect(settlement.amount_minor).toBe(14_600);
  });

  it('skips an approved row with a NULL amount, so the figure matches the earnings fold', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({
      members: { 'parent-1': PARENT },
      settlementRepo,
      expenseRepo: makeExpenseRepo({
        listApprovedForWeek: mock(async () => [
          approvedClaim({ id: 'e1', amount_minor: 1_250 }),
          // An unpriced approved mileage row: 044's approval write should have
          // frozen an amount. `buildWeekEarningsInput` skips it, so this must
          // too — a settlement larger than `ReimbursementsCard` shows is a
          // repayment neither side can reconcile.
          approvedClaim({ id: 'e2', kind: 'mileage', amount_minor: null }),
        ]),
      }),
    });

    await svc.create('parent-1', 'h1', VALID_INPUT);

    const [written] = settlementRepo.create.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(written.amount_minor).toBe(1_250);
  });

  it('stamps the HOUSEHOLD’s currency and the caller as recorded_by', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({
      members: { 'parent-1': PARENT },
      settlementRepo,
      currency: 'USD',
      expenseRepo: makeExpenseRepo({
        listApprovedForWeek: mock(async () => [
          approvedClaim({ amount_minor: 1_250, currency: 'USD' }),
        ]),
      }),
    });

    await svc.create('parent-1', 'h1', VALID_INPUT);

    const [written] = settlementRepo.create.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(written).toMatchObject({
      household_id: 'h1',
      carer_id: 'carer-1',
      week_start: '2026-08-03',
      currency: 'USD',
      settled_at: '2026-08-10',
      note: 'Cash on Friday',
      recorded_by: 'parent-1',
      amount_minor: 1_250,
    });
  });

  it('queries the week as [weekStart, weekStart+7)', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ members: { 'parent-1': PARENT }, expenseRepo });

    await svc.create('parent-1', 'h1', VALID_INPUT);

    expect(expenseRepo.listApprovedForWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
  });

  it('writes an explicit null note when the body omits one', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({ members: { 'parent-1': PARENT }, settlementRepo });

    await svc.create('parent-1', 'h1', {
      carer_id: 'carer-1',
      week_start: '2026-08-03',
      settled_at: '2026-08-10',
    });

    const [written] = settlementRepo.create.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(written.note).toBeNull();
  });

  it('REFUSES a zero-sum week — never a fabricated £0.00 row', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({
      members: { 'parent-1': PARENT },
      settlementRepo,
      expenseRepo: makeExpenseRepo({
        listApprovedForWeek: mock(async () => []),
      }),
    });

    await expect(
      svc.create('parent-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(NothingToSettleError);
    expect(settlementRepo.create).not.toHaveBeenCalled();
  });

  it('REFUSES when the household week has claims but none are this carer’s', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({
      members: { 'parent-1': PARENT },
      settlementRepo,
      expenseRepo: makeExpenseRepo({
        listApprovedForWeek: mock(async () => [
          approvedClaim({ carer_id: 'carer-2', amount_minor: 50_000 }),
        ]),
      }),
    });

    await expect(
      svc.create('parent-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(NothingToSettleError);
    expect(settlementRepo.create).not.toHaveBeenCalled();
  });

  it('REFUSES a currency mismatch rather than summing across currencies', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({
      members: { 'parent-1': PARENT },
      settlementRepo,
      currency: 'GBP',
      expenseRepo: makeExpenseRepo({
        listApprovedForWeek: mock(async () => [
          approvedClaim({ id: 'e1', amount_minor: 1_250, currency: 'GBP' }),
          approvedClaim({ id: 'e2', amount_minor: 990, currency: 'EUR' }),
        ]),
      }),
    });

    await expect(
      svc.create('parent-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(SettlementCurrencyMismatchError);
    expect(settlementRepo.create).not.toHaveBeenCalled();
  });

  it('propagates the repository’s AlreadySettledError (23505) untouched', async () => {
    const svc = service({
      members: { 'parent-1': PARENT },
      settlementRepo: makeSettlementRepo({
        create: mock(async () => {
          throw new AlreadySettledError('h1', 'carer-1', '2026-08-03');
        }),
      }),
    });

    await expect(
      svc.create('parent-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(AlreadySettledError);
  });

  it('a nanny cannot settle her OWN reimbursement — 403, not a 404', async () => {
    const settlementRepo = makeSettlementRepo();
    const svc = service({
      members: { 'carer-1': NANNY },
      settlementRepo,
    });

    await expect(
      svc.create('carer-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(settlementRepo.create).not.toHaveBeenCalled();
  });

  it('a helper cannot settle — 403', async () => {
    const svc = service({ members: { 'helper-1': HELPER } });
    await expect(
      svc.create('helper-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('a non-member gets the opaque 404, never the 403', async () => {
    const svc = service({ members: {} });
    await expect(
      svc.create('stranger-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(ReimbursementSettlementNotFoundError);
  });

  it('a REMOVED parent cannot settle — writes need an ACTIVE membership', async () => {
    const svc = service({ members: { 'parent-1': REMOVED_PARENT } });
    await expect(
      svc.create('parent-1', 'h1', VALID_INPUT)
    ).rejects.toBeInstanceOf(ReimbursementSettlementNotFoundError);
  });

  it('there is no update or delete path anywhere on the service (append-only)', () => {
    const svc = service();
    expect(svc.update).toBeUndefined();
    expect(svc.delete).toBeUndefined();
    expect(svc.correct).toBeUndefined();
  });
});
