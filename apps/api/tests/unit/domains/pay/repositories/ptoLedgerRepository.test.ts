import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * Repository tests run against a fake PostgREST chain that ACTUALLY applies
 * eq/gte/lte/order to an in-memory row set — the same discipline as
 * `payArrangementRepository.test.ts` — so these tests prove the real filter
 * shape (household_id AND carer_id, the calendar-year window, the `kind`
 * discriminator) rather than a canned response.
 */

interface FakeRow {
  [key: string]: unknown;
}

let PtoLedgerRepository: any;
let PtoAlreadyMarkedPaidError: any;
let PtoAccrualGrantRaceError: any;
let mockSupabaseService: any;
let lastCalls: { method: string; args: unknown[] }[] = [];

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  const gteFilters: [string, string][] = [];
  const lteFilters: [string, string][] = [];
  const orderKeys: [string, boolean][] = [];

  const resolveRows = (): FakeRow[] => {
    let out = rows.filter(
      row =>
        eqFilters.every(([key, value]) => row[key] === value) &&
        gteFilters.every(([key, value]) => String(row[key]) >= value) &&
        lteFilters.every(([key, value]) => String(row[key]) <= value)
    );
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

  const record = (method: string, ...args: unknown[]) => {
    lastCalls.push({ method, args });
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
    gte: mock((key: string, value: string) => {
      record('gte', key, value);
      gteFilters.push([key, value]);
      return chain;
    }),
    lte: mock((key: string, value: string) => {
      record('lte', key, value);
      lteFilters.push([key, value]);
      return chain;
    }),
    order: mock((key: string, opts?: { ascending?: boolean }) => {
      record('order', key, opts);
      orderKeys.push([key, opts?.ascending !== false]);
      return chain;
    }),
    maybeSingle: mock(async () => {
      const found = resolveRows();
      return { data: error ? null : (found[0] ?? null), error };
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: error ? null : resolveRows(),
        error,
      }).then(resolve),
  };
  return chain;
}

/** A separate, minimal chain for insert().select().single(), with its own error injection. */
function createFakeInsertChain(
  created: FakeRow | null,
  error: { code?: string; message?: string } | null = null
): any {
  const chain: any = {
    insert: mock((row: FakeRow) => {
      lastCalls.push({ method: 'insert', args: [row] });
      return chain;
    }),
    select: mock(() => chain),
    single: mock(async () => ({ data: error ? null : created, error })),
  };
  return chain;
}

function usageRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'ptl-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    kind: 'usage',
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

function accrualRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'ptl-accrual',
    household_id: 'h1',
    carer_id: 'carer-1',
    kind: 'accrual',
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

function withRows(rows: FakeRow[], error: unknown = null): void {
  mockSupabaseService.from.mockImplementation(() =>
    createFakeQuery(rows, error)
  );
}

function withInsertResult(
  created: FakeRow | null,
  error: { code?: string; message?: string } | null = null
): void {
  mockSupabaseService.from.mockImplementation(() =>
    createFakeInsertChain(created, error)
  );
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
    return { supabase: obj, supabaseService: obj };
  });

  const repoModule = await import(
    '../../../../../src/domains/pay/repositories/ptoLedgerRepository'
  );
  PtoLedgerRepository = repoModule.PtoLedgerRepository;

  const errorsModule = await import(
    '../../../../../src/domains/pay/errors/payErrors'
  );
  PtoAlreadyMarkedPaidError = errorsModule.PtoAlreadyMarkedPaidError;
  PtoAccrualGrantRaceError = errorsModule.PtoAccrualGrantRaceError;

  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  lastCalls = [];
  mockSupabaseService.from.mockClear?.();
});

describe('PtoLedgerRepository.listForCarerYear', () => {
  it('returns every row for the carer within the calendar year window', async () => {
    withRows([
      accrualRow({ id: 'a', effective_date: '2026-01-01' }),
      usageRow({ id: 'u', effective_date: '2026-08-01' }),
    ]);
    const repo = new PtoLedgerRepository();
    const rows = await repo.listForCarerYear('h1', 'carer-1', 2026);
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['a', 'u']);
  });

  it('excludes a row dated in an ADJACENT year', async () => {
    withRows([
      accrualRow({ id: 'prev-dec', effective_date: '2025-12-31' }),
      accrualRow({ id: 'next-jan', effective_date: '2027-01-01' }),
    ]);
    const repo = new PtoLedgerRepository();
    const rows = await repo.listForCarerYear('h1', 'carer-1', 2026);
    expect(rows).toEqual([]);
  });

  it('filters BOTH household_id AND carer_id explicitly (no RLS backstop here)', async () => {
    withRows([
      accrualRow({ id: 'mine' }),
      accrualRow({ id: 'other-household', household_id: 'h2' }),
      accrualRow({ id: 'other-carer', carer_id: 'carer-2' }),
    ]);
    const repo = new PtoLedgerRepository();
    const rows = await repo.listForCarerYear('h1', 'carer-1', 2026);
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['mine']);
    expect(lastCalls).toContainEqual({
      method: 'eq',
      args: ['household_id', 'h1'],
    });
    expect(lastCalls).toContainEqual({
      method: 'eq',
      args: ['carer_id', 'carer-1'],
    });
  });

  it('uses the boundary dates of the calendar year, inclusive', async () => {
    withRows([]);
    const repo = new PtoLedgerRepository();
    await repo.listForCarerYear('h1', 'carer-1', 2026);
    expect(lastCalls).toContainEqual({
      method: 'gte',
      args: ['effective_date', '2026-01-01'],
    });
    expect(lastCalls).toContainEqual({
      method: 'lte',
      args: ['effective_date', '2026-12-31'],
    });
  });

  it('returns [] when the carer has no ledger rows that year', async () => {
    withRows([]);
    const repo = new PtoLedgerRepository();
    expect(await repo.listForCarerYear('h1', 'carer-1', 2026)).toEqual([]);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([], { message: 'boom' });
    const repo = new PtoLedgerRepository();
    await expect(
      repo.listForCarerYear('h1', 'carer-1', 2026)
    ).rejects.toThrow();
  });
});

describe('PtoLedgerRepository.listForHouseholdTimeOff', () => {
  it('returns EVERY kind of row this household holds for the time off — usage AND its corrections', async () => {
    withRows([
      usageRow(),
      usageRow({ id: 'ptl-adj', kind: 'adjustment', minutes: 120 }),
    ]);
    const repo = new PtoLedgerRepository();
    const rows = await repo.listForHouseholdTimeOff('h1', 'to-1');
    expect(rows.map((r: FakeRow) => r.id).sort()).toEqual(['ptl-1', 'ptl-adj']);
  });

  it('returns [] when this household never marked it paid', async () => {
    withRows([]);
    const repo = new PtoLedgerRepository();
    expect(await repo.listForHouseholdTimeOff('h1', 'to-1')).toEqual([]);
  });

  it("never crosses into another household's rows for the SAME time off", async () => {
    withRows([usageRow({ id: 'theirs', household_id: 'h2' })]);
    const repo = new PtoLedgerRepository();
    expect(await repo.listForHouseholdTimeOff('h1', 'to-1')).toEqual([]);
  });

  it('filters household_id AND time_off_id explicitly (no RLS backstop here)', async () => {
    withRows([usageRow()]);
    const repo = new PtoLedgerRepository();
    await repo.listForHouseholdTimeOff('h1', 'to-1');
    const eqPairs = lastCalls
      .filter(call => call.method === 'eq')
      .map(call => [call.args[0], call.args[1]]);
    expect(eqPairs).toContainEqual(['household_id', 'h1']);
    expect(eqPairs).toContainEqual(['time_off_id', 'to-1']);
  });

  it('does NOT filter by kind — the netted total needs the corrections too', async () => {
    withRows([usageRow()]);
    const repo = new PtoLedgerRepository();
    await repo.listForHouseholdTimeOff('h1', 'to-1');
    expect(
      lastCalls.some(call => call.method === 'eq' && call.args[0] === 'kind')
    ).toBe(false);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([], { message: 'boom' });
    const repo = new PtoLedgerRepository();
    await expect(repo.listForHouseholdTimeOff('h1', 'to-1')).rejects.toThrow();
  });
});

describe('PtoLedgerRepository.listAllForTimeOff — cross-household, for reconcile', () => {
  it('returns EVERY household’s rows for one shared time off', async () => {
    withRows([
      usageRow({ id: 'u1', household_id: 'h1' }),
      usageRow({ id: 'u2', household_id: 'h2' }),
    ]);
    const repo = new PtoLedgerRepository();
    const rows = await repo.listAllForTimeOff('to-1');
    expect(rows.map((r: FakeRow) => r.id).sort()).toEqual(['u1', 'u2']);
  });

  it('returns [] when nobody marked it paid', async () => {
    withRows([]);
    const repo = new PtoLedgerRepository();
    expect(await repo.listAllForTimeOff('to-1')).toEqual([]);
  });

  it('does NOT filter by household_id (the one deliberate exception)', async () => {
    withRows([usageRow()]);
    const repo = new PtoLedgerRepository();
    await repo.listAllForTimeOff('to-1');
    expect(
      lastCalls.some(
        call => call.method === 'eq' && call.args[0] === 'household_id'
      )
    ).toBe(false);
  });

  // Phase 3/4 review, BLOCKER 1(b): reconcile has to see the ADJUSTMENT rows
  // too, or it cannot tell an already-reversed marking from an un-reversed
  // one and double-reverses on every retry.
  it('does NOT filter by kind — adjustment rows are what make reconcile idempotent', async () => {
    withRows([
      usageRow({ id: 'u1' }),
      usageRow({ id: 'adj1', kind: 'adjustment', minutes: 480 }),
    ]);
    const repo = new PtoLedgerRepository();
    const rows = await repo.listAllForTimeOff('to-1');
    expect(rows.map((r: FakeRow) => r.id).sort()).toEqual(['adj1', 'u1']);
    expect(
      lastCalls.some(call => call.method === 'eq' && call.args[0] === 'kind')
    ).toBe(false);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([], { message: 'boom' });
    const repo = new PtoLedgerRepository();
    await expect(repo.listAllForTimeOff('to-1')).rejects.toThrow();
  });
});

describe('PtoLedgerRepository.create', () => {
  it('inserts a usage row and returns it', async () => {
    const created = usageRow();
    withInsertResult(created);
    const repo = new PtoLedgerRepository();
    const row = await repo.create({
      household_id: 'h1',
      carer_id: 'carer-1',
      kind: 'usage',
      minutes: -480,
      effective_date: '2026-08-01',
      time_off_id: 'to-1',
      carer_display_name: 'Nia Rowe',
      note: null,
      created_by: 'parent-1',
    });
    expect(row).toEqual(created);
  });

  it('translates a UNIQUE VIOLATION on a usage insert into PtoAlreadyMarkedPaidError', async () => {
    withInsertResult(null, { code: '23505', message: 'duplicate key' });
    const repo = new PtoLedgerRepository();
    await expect(
      repo.create({
        household_id: 'h1',
        carer_id: 'carer-1',
        kind: 'usage',
        minutes: -480,
        effective_date: '2026-08-01',
        time_off_id: 'to-1',
        carer_display_name: 'Nia Rowe',
        note: null,
        created_by: 'parent-1',
      })
    ).rejects.toBeInstanceOf(PtoAlreadyMarkedPaidError);
  });

  it('translates a UNIQUE VIOLATION on an accrual insert into PtoAccrualGrantRaceError', async () => {
    withInsertResult(null, { code: '23505', message: 'duplicate key' });
    const repo = new PtoLedgerRepository();
    await expect(
      repo.create({
        household_id: 'h1',
        carer_id: 'carer-1',
        kind: 'accrual',
        minutes: 16800,
        effective_date: '2026-01-01',
        time_off_id: null,
        carer_display_name: 'Nia Rowe',
        note: '2026 annual grant',
        created_by: null,
      })
    ).rejects.toBeInstanceOf(PtoAccrualGrantRaceError);
  });

  it('a UNIQUE VIOLATION on an adjustment insert is a genuine DatabaseError (no index guards it)', async () => {
    withInsertResult(null, { code: '23505', message: 'duplicate key' });
    const repo = new PtoLedgerRepository();
    await expect(
      repo.create({
        household_id: 'h1',
        carer_id: 'carer-1',
        kind: 'adjustment',
        minutes: 480,
        effective_date: '2026-08-01',
        time_off_id: 'to-1',
        carer_display_name: 'Nia Rowe',
        note: 'reversal',
        created_by: null,
      })
    ).rejects.not.toBeInstanceOf(PtoAlreadyMarkedPaidError);
  });

  it('a non-unique-violation error is a plain DatabaseError', async () => {
    withInsertResult(null, { code: '23000', message: 'boom' });
    const repo = new PtoLedgerRepository();
    await expect(
      repo.create({
        household_id: 'h1',
        carer_id: 'carer-1',
        kind: 'usage',
        minutes: -480,
        effective_date: '2026-08-01',
        time_off_id: 'to-1',
        carer_display_name: 'Nia Rowe',
        note: null,
        created_by: 'parent-1',
      })
    ).rejects.not.toBeInstanceOf(PtoAlreadyMarkedPaidError);
  });
});
