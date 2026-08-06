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
let ExpenseValidationError: any;
let mockSupabaseService: any;
let lastCalls: { method: string; args: unknown[] }[] = [];
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  const gteFilters: [string, unknown][] = [];
  const ltFilters: [string, unknown][] = [];
  const orderKeys: [string, boolean][] = [];
  let updatePatch: Record<string, unknown> | null = null;
  let insertRow: Record<string, unknown> | null = null;
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
    insert: mock((row: Record<string, unknown>) => {
      record('insert', row);
      insertRow = row;
      return chain;
    }),
    single: mock(async () => {
      if (error) return { data: null, error };
      return { data: insertRow ?? resolveRows()[0] ?? null, error: null };
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

/**
 * A STATEFUL stand-in for `public.review_pending_expense` (migration 051) —
 * it really evaluates the timesheet lock and the `status = 'pending'` CAS
 * against in-memory rows, for the same reason the PostgREST chain above does:
 * a recording-only fake would pass even if the repository forgot to pass the
 * week lock at all, which is exactly the F-B4-1 defect.
 */
function withRpc(expenses: FakeRow[], timesheets: FakeRow[] = []): void {
  mockSupabaseService.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name !== 'review_pending_expense') {
        return { data: null, error: { message: `no such function: ${name}` } };
      }

      let timesheet: FakeRow | undefined;
      if (args.p_week_start != null && args.p_carer_id != null) {
        timesheet = timesheets.find(
          row =>
            row.household_id === args.p_household_id &&
            row.carer_id === args.p_carer_id &&
            row.week_start === args.p_week_start
        );
        if (timesheet?.status === 'approved') {
          return {
            data: {
              outcome: 'week_locked',
              week_start: args.p_week_start,
              timesheet_status: timesheet.status,
            },
            error: null,
          };
        }
      }

      const row = expenses.find(
        candidate =>
          candidate.id === args.p_expense_id &&
          candidate.household_id === args.p_household_id &&
          candidate.status === 'pending'
      );
      if (!row) {
        return { data: { outcome: 'not_pending' }, error: null };
      }
      Object.assign(row, {
        status: args.p_status,
        reviewed_by: args.p_reviewed_by,
        reviewed_at: args.p_reviewed_at,
        review_note: args.p_review_note,
        amount_minor: args.p_amount_minor ?? row.amount_minor,
      });
      if (timesheet) {
        timesheet.updated_at = 'touched-by-review';
      }
      return {
        data: { outcome: 'reviewed', expense: { ...row } },
        error: null,
      };
    }
  );
}

function timesheet(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'ts-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    week_start: '2026-08-03',
    status: 'submitted',
    updated_at: '2026-08-04T09:00:00.000Z',
    ...overrides,
  };
}

const REVIEW_PATCH = {
  status: 'approved' as const,
  reviewed_by: 'parent-1',
  reviewed_at: '2026-08-04T10:00:00.000Z',
  review_note: null,
};

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = {
      from: mock(() => createFakeQuery([])),
      rpc: mock(async () => ({ data: null, error: null })),
    };
    return { supabase: obj, supabaseService: obj };
  });

  ExpenseRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/expenseRepository'
    )
  ).ExpenseRepository;
  ExpenseValidationError = (
    await import('../../../../../src/domains/pay/errors/payErrors')
  ).ExpenseValidationError;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  lastCalls = [];
  rpcCalls = [];
  mockSupabaseService.from.mockClear?.();
  mockSupabaseService.rpc.mockClear?.();
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

  // C1 (058) — see the twins in timeEntryRepository/timesheetRepository tests.
  // `household_member_id` is named nowhere in apps/api/src; it survives to the
  // wire purely because this read selects every column. The parent's statement
  // buckets approved expenses by the same carer key as the hours, so a
  // narrowed select here would quietly drop a departed carer's claims off her
  // own statement.
  it('C1: keeps household_member_id on the rows it returns', async () => {
    withRows([expense({ household_member_id: 'member-1' })]);
    const repo = new ExpenseRepository();
    const rows = await repo.listForWeek('h1', '2026-08-03', '2026-08-10');
    expect(rows[0].household_member_id).toBe('member-1');
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
    withRpc([expense({ id: 'exp-1', household_id: 'h1', status: 'pending' })]);
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, null);
    expect(result.outcome).toBe('reviewed');
    expect(result.expense.status).toBe('approved');
    expect(result.expense.reviewed_by).toBe('parent-1');
  });

  it('freezes amount_minor on a mileage approval in the SAME update', async () => {
    withRpc([
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
    const result = await repo.reviewPending(
      'exp-mileage',
      'h1',
      { ...REVIEW_PATCH, amount_minor: 554 },
      null
    );
    expect(result.expense.amount_minor).toBe(554);
    expect(result.expense.status).toBe('approved');
  });

  it('leaves amount_minor alone when the patch carries none', async () => {
    withRpc([expense({ id: 'exp-1', household_id: 'h1', amount_minor: 1200 })]);
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending(
      'exp-1',
      'h1',
      { ...REVIEW_PATCH, status: 'rejected' },
      null
    );
    expect(result.expense.amount_minor).toBe(1200);
  });

  it('reports not_pending when the row is already reviewed (lost race)', async () => {
    withRpc([expense({ id: 'exp-1', household_id: 'h1', status: 'approved' })]);
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending(
      'exp-1',
      'h1',
      { ...REVIEW_PATCH, status: 'rejected' },
      null
    );
    expect(result.outcome).toBe('not_pending');
  });

  it('reports not_pending for a different household', async () => {
    withRpc([expense({ id: 'exp-1', household_id: 'h2', status: 'pending' })]);
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, null);
    expect(result.outcome).toBe('not_pending');
  });

  it('throws a DatabaseError when the RPC itself fails', async () => {
    mockSupabaseService.rpc.mockImplementation(async () => ({
      data: null,
      error: { message: 'boom' },
    }));
    const repo = new ExpenseRepository();
    await expect(
      repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, null)
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F-B4-1 — the freeze guard lives in the WRITE, not a pre-check.
//
// The service's `assertWeekNotFrozen` is a plain read; the write it guards
// used to be a CAS on `status = 'pending'` alone, so a timesheet approve that
// landed between the two froze a week's earnings without this reimbursement
// and the expense still committed `approved`. `reviewPending` now routes
// through `review_pending_expense` (051), which locks the week's timesheet row
// FOR UPDATE before it touches the expense.
// ---------------------------------------------------------------------------

describe('ExpenseRepository.reviewPending — the week freeze is IN the write', () => {
  it('refuses the approval when the locked week is already approved', async () => {
    const rows = [expense({ id: 'exp-1', household_id: 'h1' })];
    withRpc(rows, [timesheet({ status: 'approved' })]);
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, {
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
    expect(result.outcome).toBe('week_locked');
    expect(result.timesheetStatus).toBe('approved');
    expect(result.weekStart).toBe('2026-08-03');
    // The row is untouched — nothing was approved into the frozen week.
    expect(rows[0]?.status).toBe('pending');
  });

  it('passes the household, carer and week to the lock so the RIGHT row is locked', async () => {
    withRpc([expense({ id: 'exp-1', household_id: 'h1' })], [timesheet()]);
    const repo = new ExpenseRepository();
    await repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, {
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
    expect(rpcCalls[0]?.name).toBe('review_pending_expense');
    expect(rpcCalls[0]?.args).toMatchObject({
      p_expense_id: 'exp-1',
      p_household_id: 'h1',
      p_carer_id: 'carer-1',
      p_week_start: '2026-08-03',
      p_status: 'approved',
    });
  });

  it('BUMPS the week’s timesheet so an in-flight approve’s updated_at CAS loses', async () => {
    const weeks = [timesheet({ status: 'submitted' })];
    withRpc([expense({ id: 'exp-1', household_id: 'h1' })], weeks);
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, {
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
    expect(result.outcome).toBe('reviewed');
    expect(weeks[0]?.updated_at).not.toBe('2026-08-04T09:00:00.000Z');
  });

  it('an unfrozen week approves normally — the lock costs the happy path nothing', async () => {
    withRpc(
      [expense({ id: 'exp-1', household_id: 'h1' })],
      [timesheet({ status: 'submitted' })]
    );
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, {
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
    expect(result.outcome).toBe('reviewed');
    expect(result.expense.status).toBe('approved');
  });

  it('no timesheet for that week at all approves normally', async () => {
    withRpc([expense({ id: 'exp-1', household_id: 'h1' })], []);
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending('exp-1', 'h1', REVIEW_PATCH, {
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
    expect(result.outcome).toBe('reviewed');
  });

  it('a null week lock (rejection / carer-less row) skips the lock entirely', async () => {
    withRpc(
      [expense({ id: 'exp-1', household_id: 'h1' })],
      [timesheet({ status: 'approved' })]
    );
    const repo = new ExpenseRepository();
    const result = await repo.reviewPending(
      'exp-1',
      'h1',
      { ...REVIEW_PATCH, status: 'rejected' },
      null
    );
    expect(result.outcome).toBe('reviewed');
    expect(rpcCalls[0]?.args.p_week_start).toBeNull();
    expect(rpcCalls[0]?.args.p_carer_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-B4-6 — a double-tapped POST used to create two payable rows.
// ---------------------------------------------------------------------------

describe('ExpenseRepository.create — pending-claim dedupe', () => {
  it('inserts the claim normally', async () => {
    withRows([]);
    const repo = new ExpenseRepository();
    const created = await repo.create(expense({ id: undefined }));
    expect(created.description).toBe('Nappies');
  });

  it('translates the 23505 from expenses_one_pending_claim_idx into a typed error', async () => {
    withRows([], {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "expenses_one_pending_claim_idx"',
    });
    const repo = new ExpenseRepository();
    const err = await repo.create(expense()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExpenseValidationError);
    expect((err as { metadata?: { reason?: string } }).metadata?.reason).toBe(
      'DUPLICATE_PENDING_CLAIM'
    );
  });

  it('leaves any OTHER database error as a DatabaseError', async () => {
    withRows([], { code: '23503', message: 'fk violation' });
    const repo = new ExpenseRepository();
    const err = await repo.create(expense()).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ExpenseValidationError);
  });
});
