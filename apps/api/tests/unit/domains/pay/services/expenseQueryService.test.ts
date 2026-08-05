import { describe, expect, it, mock } from 'bun:test';
import { ExpenseNotFoundError } from '../../../../../src/domains/pay/errors/payErrors';
import { ExpenseQueryService } from '../../../../../src/domains/pay/services/expenseQueryService';

function expenseRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'exp-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    local_date: '2026-08-04',
    kind: 'expense',
    description: 'Nappies',
    amount_minor: 1200,
    miles: null,
    currency: 'GBP',
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    carer_display_name: 'Nia Rowe',
    created_at: '2026-08-04T09:00:00.000Z',
    updated_at: '2026-08-04T09:00:00.000Z',
    ...overrides,
  };
}

function makeExpenseRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForWeek: mock(async () => [
      expenseRow({ id: 'mine', carer_id: 'carer-1' }),
      expenseRow({ id: 'theirs', carer_id: 'carer-2' }),
    ]),
    listPending: mock(async () => [
      expenseRow({ id: 'p-mine', carer_id: 'carer-1', status: 'pending' }),
      expenseRow({ id: 'p-theirs', carer_id: 'carer-2', status: 'pending' }),
    ]),
    listApprovedForWeek: mock(async () => [
      expenseRow({ id: 'a-mine', carer_id: 'carer-1', status: 'approved' }),
      expenseRow({ id: 'a-theirs', carer_id: 'carer-2', status: 'approved' }),
    ]),
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

const PARENT = member('parent', 'parent-1');
const OWNER = member('owner', 'owner-1');
const NANNY = member('nanny', 'carer-1');
const OTHER_NANNY = member('nanny', 'carer-2');
const HELPER = member('helper', 'helper-1');

interface ServiceParts {
  members?: Record<string, unknown>;
  expenseRepo?: any;
  timezone?: string;
}

function service(parts: ServiceParts = {}): any {
  return new ExpenseQueryService(
    parts.expenseRepo ?? makeExpenseRepo(),
    makeMemberRepo(parts.members ?? { 'parent-1': PARENT, 'carer-1': NANNY }),
    makeHouseholdRepo(parts.timezone ?? 'Europe/London')
  );
}

/** Monday 2026-08-03, mid-morning UTC — a plain week in London. */
const NOW = () => new Date('2026-08-04T10:00:00.000Z');

describe('ExpenseQueryService.listForWeek — read gating', () => {
  it('a parent sees every carer’s expenses for the week', async () => {
    const svc = service({ members: { 'parent-1': PARENT } });
    const rows = await svc.listForWeek('parent-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('an owner sees every carer’s expenses too', async () => {
    const svc = service({ members: { 'owner-1': OWNER } });
    const rows = await svc.listForWeek('owner-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('a nanny sees ONLY her own rows — another carer’s claims are invisible', async () => {
    const svc = service({
      members: { 'carer-1': NANNY, 'carer-2': OTHER_NANNY },
    });
    const rows = await svc.listForWeek('carer-1', 'h1', '2026-08-03', NOW);
    expect(rows.map((r: any) => r.id)).toEqual(['mine']);
  });

  it('a HELPER is denied entirely — no pay surface at all', async () => {
    const svc = service({ members: { 'helper-1': HELPER } });
    await expect(
      svc.listForWeek('helper-1', 'h1', '2026-08-03', NOW)
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });

  it('a non-member is denied with the same error (no existence leak)', async () => {
    const svc = service({ members: {} });
    await expect(
      svc.listForWeek('stranger', 'h1', '2026-08-03', NOW)
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });
});

describe('ExpenseQueryService.listForWeek — household-local week boundaries', () => {
  it('defaults to the current household-local week when weekStart is omitted', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    // 2026-08-04 is a Tuesday; Monday of that week is 2026-08-03.
    await svc.listForWeek('parent-1', 'h1', undefined, NOW);
    expect(expenseRepo.listForWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
  });

  it('resolves "today" against the HOUSEHOLD timezone, not UTC', async () => {
    // 2026-08-04T23:30Z is already Wednesday 2026-08-05 in Auckland, whose
    // Monday is 2026-08-03 — same week, but a UTC-anchored bug would compute
    // the week from 08-04 instead and still land on 08-03, so pin a case
    // that actually diverges: Sunday-to-Monday rollover.
    const expenseRepo = makeExpenseRepo();
    const svc = service({
      expenseRepo,
      members: { 'parent-1': PARENT },
      timezone: 'Pacific/Auckland',
    });
    await svc.listForWeek(
      'parent-1',
      'h1',
      undefined,
      () => new Date('2026-08-02T23:30:00.000Z') // Sun 23:30 UTC = Mon 11:30 Auckland
    );
    expect(expenseRepo.listForWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
  });

  it('passes an explicit weekStart straight through', async () => {
    const expenseRepo = makeExpenseRepo();
    const svc = service({ expenseRepo, members: { 'parent-1': PARENT } });
    await svc.listForWeek('parent-1', 'h1', '2025-12-29', NOW);
    expect(expenseRepo.listForWeek).toHaveBeenCalledWith(
      'h1',
      '2025-12-29',
      '2026-01-05'
    );
  });
});

describe('ExpenseQueryService.listPending — read gating', () => {
  it('a parent sees the whole household’s pending queue', async () => {
    const svc = service({ members: { 'parent-1': PARENT } });
    const rows = await svc.listPending('parent-1', 'h1');
    expect(rows.map((r: any) => r.id).sort()).toEqual(['p-mine', 'p-theirs']);
  });

  it('a nanny sees only her own pending claims', async () => {
    const svc = service({
      members: { 'carer-1': NANNY, 'carer-2': OTHER_NANNY },
    });
    const rows = await svc.listPending('carer-1', 'h1');
    expect(rows.map((r: any) => r.id)).toEqual(['p-mine']);
  });

  it('a helper is denied', async () => {
    const svc = service({ members: { 'helper-1': HELPER } });
    await expect(svc.listPending('helper-1', 'h1')).rejects.toBeInstanceOf(
      ExpenseNotFoundError
    );
  });
});

describe('ExpenseQueryService.listApprovedForWeek — read gating', () => {
  it('a parent sees every carer’s approved claims', async () => {
    const svc = service({ members: { 'parent-1': PARENT } });
    const rows = await svc.listApprovedForWeek(
      'parent-1',
      'h1',
      '2026-08-03',
      NOW
    );
    expect(rows.map((r: any) => r.id).sort()).toEqual(['a-mine', 'a-theirs']);
  });

  it('a nanny sees only her own approved claims', async () => {
    const svc = service({
      members: { 'carer-1': NANNY, 'carer-2': OTHER_NANNY },
    });
    const rows = await svc.listApprovedForWeek(
      'carer-1',
      'h1',
      '2026-08-03',
      NOW
    );
    expect(rows.map((r: any) => r.id)).toEqual(['a-mine']);
  });

  it('a helper is denied', async () => {
    const svc = service({ members: { 'helper-1': HELPER } });
    await expect(
      svc.listApprovedForWeek('helper-1', 'h1', '2026-08-03', NOW)
    ).rejects.toBeInstanceOf(ExpenseNotFoundError);
  });
});
