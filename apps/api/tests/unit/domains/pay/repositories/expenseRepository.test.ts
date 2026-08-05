import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * `ExpenseRepository` runs against a fake PostgREST chain that actually
 * applies eq/gte/lt/order/update/delete to an in-memory row set, exactly like
 * `payArrangementRepository.test.ts` — a recording-only chain would pass with
 * a missing `household_id` filter or a guard that doesn't actually gate the
 * write, which is precisely what these tests exist to catch (every write on
 * this table MUST filter household_id explicitly; RLS is select-only,
 * docs/11-MONEY.md §8/§9).
 */

interface FakeRow {
  [key: string]: unknown;
}

let ExpenseRepository: any;
let mockSupabaseService: any;
let lastCalls: { method: string; args: unknown[] }[] = [];

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  const gteFilters: [string, unknown][] = [];
  const ltFilters: [string, unknown][] = [];
  const orderKeys: [string, boolean][] = [];
  let updatePatch: Record<string, unknown> | null = null;
  let isDelete = false;

  const record = (method: string, ...args: unknown[]) => {
    lastCalls.push({ method, args });
  };

  const matches = (row: FakeRow): boolean =>
    eqFilters.every(([key, value]) => row[key] === value) &&
    gteFilters.every(([key, value]) => String(row[key]) >= String(value)) &&
    ltFilters.every(([key, value]) => String(row[key]) < String(value));

  const resolveRows = (): FakeRow[] => {
    let out = rows.filter(matches);
    for (const [key, ascending] of [...orderKeys].reverse()) {
      out = [...out].sort((a, b) => {
        const left = String(a[key]);
        const right = String(b[key]);
        if (left === right) return 0;
        return (left < right ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    return out;
  };

  const chain: any = {
    select: mock((...args: unknown[]) => {
      record('select', ...args);
      return chain;
    }),
    eq: mock((key: string, value: unknown) => {
      record('eq', key, value);
      eqFilters.push([key, value]);
      return chain;
    }),
    gte: mock((key: string, value: unknown) => {
      record('gte', key, value);
      gteFilters.push([key, value]);
      return chain;
    }),
    lt: mock((key: string, value: unknown) => {
      record('lt', key, value);
      ltFilters.push([key, value]);
      return chain;
    }),
    order: mock((key: string, opts?: { ascending?: boolean }) => {
      record('order', key, opts);
      orderKeys.push([key, opts?.ascending !== false]);
      return chain;
    }),
    update: mock((patch: Record<string, unknown>) => {
      record('update', patch);
      updatePatch = patch;
      return chain;
    }),
    delete: mock(() => {
      record('delete');
      isDelete = true;
      return chain;
    }),
    maybeSingle: mock(async () => {
      if (error) return { data: null, error };
      const matched = resolveRows();
      const row = matched[0];
      if (!row) return { data: null, error: null };
      return {
        data: updatePatch ? { ...row, ...updatePatch } : row,
        error: null,
      };
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        error
          ? { data: null, error }
          : { data: isDelete ? resolveRows() : resolveRows(), error: null }
      ).then(resolve),
  };
  return chain;
}

function expense(overrides: FakeRow = {}): FakeRow {
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

function withRows(rows: FakeRow[], error: unknown = null): void {
  mockSupabaseService.from.mockImplementation(() =>
    createFakeQuery(rows, error)
  );
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
    return { supabase: obj, supabaseService: obj };
  });

  ExpenseRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/expenseRepository'
    )
  ).ExpenseRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  lastCalls = [];
  mockSupabaseService.from.mockClear?.();
});

describe('ExpenseRepository.listForWeek', () => {
  it('filters by household_id and the [weekStart, weekEndExclusive) local_date range', async () => {
    withRows([
      expense({ id: 'in-range', local_date: '2026-08-04' }),
      expense({ id: 'before', local_date: '2026-08-02' }),
      expense({ id: 'after', local_date: '2026-08-11' }),
      expense({
        id: 'other-household',
        household_id: 'h2',
        local_date: '2026-08-05',
      }),
    ]);
    const repo = new ExpenseRepository();
    const rows = await repo.listForWeek('h1', '2026-08-03', '2026-08-10');
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['in-range']);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('expenses');
  });

  it('includes every status — the caller filters visibility, not this query', async () => {
    withRows([
      expense({ id: 'pending', status: 'pending' }),
      expense({ id: 'approved', status: 'approved' }),
      expense({ id: 'rejected', status: 'rejected' }),
    ]);
    const repo = new ExpenseRepository();
    const rows = await repo.listForWeek('h1', '2026-08-03', '2026-08-10');
    expect(rows).toHaveLength(3);
  });

  it('returns [] for an empty week', async () => {
    withRows([]);
    const repo = new ExpenseRepository();
    expect(await repo.listForWeek('h1', '2026-08-03', '2026-08-10')).toEqual(
      []
    );
  });

  it('throws a DatabaseError on query failure', async () => {
    withRows([], { message: 'boom' });
    const repo = new ExpenseRepository();
    await expect(
      repo.listForWeek('h1', '2026-08-03', '2026-08-10')
    ).rejects.toThrow();
  });
});

describe('ExpenseRepository.listPending', () => {
  it('scopes to household_id and status = pending only', async () => {
    withRows([
      expense({ id: 'p1', status: 'pending' }),
      expense({ id: 'p2', status: 'pending', household_id: 'h2' }),
      expense({ id: 'a1', status: 'approved' }),
    ]);
    const repo = new ExpenseRepository();
    const rows = await repo.listPending('h1');
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['p1']);
  });

  it('returns [] when nothing is pending', async () => {
    withRows([expense({ status: 'approved' })]);
    const repo = new ExpenseRepository();
    expect(await repo.listPending('h1')).toEqual([]);
  });
});

describe('ExpenseRepository.listApprovedForWeek', () => {
  it('scopes to household_id, status = approved, and the date range', async () => {
    withRows([
      expense({
        id: 'approved-in-range',
        status: 'approved',
        local_date: '2026-08-05',
      }),
      expense({
        id: 'pending-in-range',
        status: 'pending',
        local_date: '2026-08-05',
      }),
      expense({
        id: 'approved-out-of-range',
        status: 'approved',
        local_date: '2026-09-01',
      }),
    ]);
    const repo = new ExpenseRepository();
    const rows = await repo.listApprovedForWeek(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['approved-in-range']);
  });
});

describe('ExpenseRepository.updateOwnedPending', () => {
  it('updates the row when it is the caller’s own AND still pending', async () => {
    withRows([
      expense({ id: 'exp-1', carer_id: 'carer-1', status: 'pending' }),
    ]);
    const repo = new ExpenseRepository();
    const updated = await repo.updateOwnedPending('exp-1', 'h1', 'carer-1', {
      description: 'Nappies (corrected)',
    });
    expect(updated?.description).toBe('Nappies (corrected)');
  });

  it('returns null when the row belongs to a different carer', async () => {
    withRows([
      expense({ id: 'exp-1', carer_id: 'carer-OTHER', status: 'pending' }),
    ]);
    const repo = new ExpenseRepository();
    const updated = await repo.updateOwnedPending('exp-1', 'h1', 'carer-1', {
      description: 'x',
    });
    expect(updated).toBeNull();
  });

  it('returns null when the row is no longer pending (already reviewed)', async () => {
    withRows([
      expense({ id: 'exp-1', carer_id: 'carer-1', status: 'approved' }),
    ]);
    const repo = new ExpenseRepository();
    const updated = await repo.updateOwnedPending('exp-1', 'h1', 'carer-1', {
      description: 'x',
    });
    expect(updated).toBeNull();
  });

  it('returns null for a different household even with matching id/carer', async () => {
    withRows([
      expense({
        id: 'exp-1',
        household_id: 'h2',
        carer_id: 'carer-1',
        status: 'pending',
      }),
    ]);
    const repo = new ExpenseRepository();
    const updated = await repo.updateOwnedPending('exp-1', 'h1', 'carer-1', {
      description: 'x',
    });
    expect(updated).toBeNull();
  });
});

describe('ExpenseRepository.deleteOwnedPending', () => {
  it('deletes and returns true for the owning carer’s own pending row', async () => {
    withRows([
      expense({ id: 'exp-1', carer_id: 'carer-1', status: 'pending' }),
    ]);
    const repo = new ExpenseRepository();
    expect(await repo.deleteOwnedPending('exp-1', 'h1', 'carer-1')).toBe(true);
  });

  it('returns false (no-op) for another carer’s row', async () => {
    withRows([
      expense({ id: 'exp-1', carer_id: 'carer-OTHER', status: 'pending' }),
    ]);
    const repo = new ExpenseRepository();
    expect(await repo.deleteOwnedPending('exp-1', 'h1', 'carer-1')).toBe(false);
  });

  it('returns false for a reviewed row — nothing is deleted', async () => {
    withRows([
      expense({ id: 'exp-1', carer_id: 'carer-1', status: 'rejected' }),
    ]);
    const repo = new ExpenseRepository();
    expect(await repo.deleteOwnedPending('exp-1', 'h1', 'carer-1')).toBe(false);
  });
});

describe('ExpenseRepository.reviewPending', () => {
  it('applies the review patch when the row is pending in this household', async () => {
    withRows([expense({ id: 'exp-1', household_id: 'h1', status: 'pending' })]);
    const repo = new ExpenseRepository();
    const reviewed = await repo.reviewPending('exp-1', 'h1', {
      status: 'approved',
      reviewed_by: 'parent-1',
      reviewed_at: '2026-08-04T10:00:00.000Z',
      review_note: null,
    });
    expect(reviewed?.status).toBe('approved');
    expect(reviewed?.reviewed_by).toBe('parent-1');
  });

  it('freezes amount_minor on a mileage approval in the SAME update', async () => {
    withRows([
      expense({
        id: 'exp-mileage',
        household_id: 'h1',
        kind: 'mileage',
        miles: 12.3,
        amount_minor: null,
        status: 'pending',
      }),
    ]);
    const repo = new ExpenseRepository();
    const reviewed = await repo.reviewPending('exp-mileage', 'h1', {
      status: 'approved',
      reviewed_by: 'parent-1',
      reviewed_at: '2026-08-04T10:00:00.000Z',
      review_note: null,
      amount_minor: 554,
    });
    expect(reviewed?.amount_minor).toBe(554);
    expect(reviewed?.status).toBe('approved');
  });

  it('returns null when the row is already reviewed (lost race / re-review)', async () => {
    withRows([
      expense({ id: 'exp-1', household_id: 'h1', status: 'approved' }),
    ]);
    const repo = new ExpenseRepository();
    const reviewed = await repo.reviewPending('exp-1', 'h1', {
      status: 'rejected',
      reviewed_by: 'parent-1',
      reviewed_at: '2026-08-04T10:00:00.000Z',
      review_note: null,
    });
    expect(reviewed).toBeNull();
  });

  it('returns null for a different household', async () => {
    withRows([expense({ id: 'exp-1', household_id: 'h2', status: 'pending' })]);
    const repo = new ExpenseRepository();
    const reviewed = await repo.reviewPending('exp-1', 'h1', {
      status: 'approved',
      reviewed_by: 'parent-1',
      reviewed_at: '2026-08-04T10:00:00.000Z',
      review_note: null,
    });
    expect(reviewed).toBeNull();
  });
});
