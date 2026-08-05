import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * `effectiveOn` is the ONLY place the arrangement-resolution rule lives
 * (migration 041's header, docs/11-MONEY.md §2): greatest `valid_from <= date`,
 * ties broken by `created_at desc`.
 *
 * These tests therefore run against a fake PostgREST chain that ACTUALLY
 * applies eq/lte/order/limit to an in-memory row set, rather than a chain that
 * only records calls and hands back a canned row. A recording-only chain would
 * pass with the ordering reversed, the `lte` missing, or the tie-break absent —
 * i.e. it would prove nothing about the one rule this method exists to hold.
 */

interface FakeRow {
  [key: string]: unknown;
}

let PayArrangementRepository: any;
let mockSupabaseService: any;
/** Call log of the last chain built, so query shape can be asserted too. */
let lastCalls: { method: string; args: unknown[] }[] = [];

/**
 * Minimal PostgREST emulator: eq / lte / order / limit / maybeSingle, plus a
 * thenable for the list form. Ordering is applied primary-key-first, exactly
 * like Postgres, by stable-sorting in reverse key order.
 */
function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  const lteFilters: [string, string][] = [];
  const orderKeys: [string, boolean][] = [];
  let rowLimit: number | null = null;

  const resolveRows = (): FakeRow[] => {
    let out = rows.filter(
      row =>
        eqFilters.every(([key, value]) => row[key] === value) &&
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
    if (rowLimit !== null) out = out.slice(0, rowLimit);
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
    limit: mock((count: number) => {
      record('limit', count);
      rowLimit = count;
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

function arrangement(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'pa-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    rate_minor: 1500,
    currency: 'GBP',
    valid_from: '2026-01-01',
    created_at: '2026-01-01T09:00:00.000Z',
    ...overrides,
  };
}

/** Point the mocked client at a specific row set for the next call. */
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

  PayArrangementRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/payArrangementRepository'
    )
  ).PayArrangementRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  lastCalls = [];
  mockSupabaseService.from.mockClear?.();
});

describe('PayArrangementRepository.effectiveOn — the resolution rule', () => {
  it('returns null when the carer has no arrangements at all', async () => {
    withRows([]);
    const repo = new PayArrangementRepository();
    expect(await repo.effectiveOn('h1', 'carer-1', '2026-08-04')).toBeNull();
    expect(mockSupabaseService.from).toHaveBeenCalledWith('pay_arrangements');
  });

  it('returns the single row whose valid_from is before the date', async () => {
    const row = arrangement({ id: 'pa-old', valid_from: '2026-06-01' });
    withRows([row]);
    const repo = new PayArrangementRepository();
    expect(await repo.effectiveOn('h1', 'carer-1', '2026-08-04')).toEqual(row);
  });

  it('excludes a row that only takes effect AFTER the date', async () => {
    withRows([arrangement({ id: 'pa-future', valid_from: '2026-09-01' })]);
    const repo = new PayArrangementRepository();
    expect(await repo.effectiveOn('h1', 'carer-1', '2026-08-04')).toBeNull();
  });

  it('picks the later valid_from when two rows are both in effect', async () => {
    withRows([
      arrangement({
        id: 'pa-old',
        valid_from: '2026-01-01',
        created_at: '2026-01-01T09:00:00.000Z',
        rate_minor: 1500,
      }),
      arrangement({
        id: 'pa-raise',
        valid_from: '2026-07-01',
        created_at: '2026-06-20T09:00:00.000Z',
        rate_minor: 1700,
      }),
    ]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-raise');
  });

  it('SAME-DAY CORRECTION: the later created_at supersedes the typo it fixes', async () => {
    // The only correction mechanism under append-only + no-future-dates
    // (migration 041 header, review finding 2). Rows deliberately supplied
    // typo-last so a naive "first row wins" implementation cannot pass.
    withRows([
      arrangement({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:00:00.000Z',
        rate_minor: 150,
      }),
      arrangement({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:05:00.000Z',
        rate_minor: 1500,
      }),
    ]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-fix');
    expect(found?.rate_minor).toBe(1500);
  });

  it('BOUNDARY: valid_from equal to the date is in effect that day', async () => {
    withRows([arrangement({ id: 'pa-today', valid_from: '2026-08-04' })]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-today');
  });

  it("never crosses into another household's or carer's arrangements", async () => {
    withRows([
      arrangement({ id: 'pa-mine', valid_from: '2026-01-01' }),
      arrangement({
        id: 'pa-other-household',
        household_id: 'h2',
        valid_from: '2026-08-01',
      }),
      arrangement({
        id: 'pa-other-carer',
        carer_id: 'carer-2',
        valid_from: '2026-08-02',
      }),
    ]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-mine');
  });

  it('resolves in the database — one row, not the whole history', async () => {
    withRows([arrangement()]);
    const repo = new PayArrangementRepository();
    await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(lastCalls).toContainEqual({
      method: 'lte',
      args: ['valid_from', '2026-08-04'],
    });
    expect(lastCalls).toContainEqual({ method: 'limit', args: [1] });
    const orderKeys = lastCalls
      .filter(call => call.method === 'order')
      .map(call => call.args[0]);
    expect(orderKeys).toEqual(['valid_from', 'created_at']);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([], { message: 'boom' });
    const repo = new PayArrangementRepository();
    await expect(
      repo.effectiveOn('h1', 'carer-1', '2026-08-04')
    ).rejects.toThrow();
  });
});

describe('PayArrangementRepository.listForCarer', () => {
  it('returns the history newest-first, same tie-break as effectiveOn', async () => {
    withRows([
      arrangement({
        id: 'pa-first',
        valid_from: '2026-01-01',
        created_at: '2026-01-01T09:00:00.000Z',
      }),
      arrangement({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:00:00.000Z',
      }),
      arrangement({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:05:00.000Z',
      }),
    ]);
    const repo = new PayArrangementRepository();
    const history = await repo.listForCarer('h1', 'carer-1');
    expect(history.map((row: FakeRow) => row.id)).toEqual([
      'pa-fix',
      'pa-typo',
      'pa-first',
    ]);
  });

  it('includes future-dated rows (history is not filtered by date)', async () => {
    // No future-dating exists in v1, but listForCarer must not silently hide a
    // row: the history list is the audit trail, not a resolution query.
    withRows([arrangement({ id: 'pa-1', valid_from: '2026-12-01' })]);
    const repo = new PayArrangementRepository();
    const history = await repo.listForCarer('h1', 'carer-1');
    expect(history).toHaveLength(1);
  });

  it("scopes to this household's carer only", async () => {
    withRows([
      arrangement({ id: 'pa-mine' }),
      arrangement({ id: 'pa-theirs', household_id: 'h2' }),
    ]);
    const repo = new PayArrangementRepository();
    const history = await repo.listForCarer('h1', 'carer-1');
    expect(history.map((row: FakeRow) => row.id)).toEqual(['pa-mine']);
  });

  it('returns [] when the carer has no arrangements', async () => {
    withRows([]);
    const repo = new PayArrangementRepository();
    expect(await repo.listForCarer('h1', 'carer-1')).toEqual([]);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([], { message: 'boom' });
    const repo = new PayArrangementRepository();
    await expect(repo.listForCarer('h1', 'carer-1')).rejects.toThrow();
  });
});
