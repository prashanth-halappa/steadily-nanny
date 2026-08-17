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

/** One branch of a PostgREST `.or(...)` expression. */
interface OrBranch {
  column: string;
  op: 'is' | 'gte';
  value?: string;
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
  const isFilters: [string, unknown][] = [];
  const orGroups: OrBranch[][] = [];
  const orderKeys: [string, boolean][] = [];
  let rowLimit: number | null = null;
  let updatePatch: Record<string, unknown> | null = null;

  const resolveRows = (): FakeRow[] => {
    let out = rows.filter(
      row =>
        eqFilters.every(([key, value]) => row[key] === value) &&
        lteFilters.every(([key, value]) => String(row[key]) <= value) &&
        isFilters.every(([key, value]) => (row[key] ?? null) === value) &&
        orGroups.every(branches =>
          branches.some(({ column, op, value }) =>
            op === 'is'
              ? (row[column] ?? null) === null
              : row[column] != null && String(row[column]) >= String(value)
          )
        )
    );
    if (updatePatch) {
      for (const row of out) Object.assign(row, updatePatch);
    }
    for (const [key, ascending] of [...orderKeys].reverse()) {
      out = [...out].sort((a, b) => {
        const left = String(a[key]);
        const right = String(b[key]);
        // Postgres orders timestamptz by INSTANT, so two serialisations of the
        // same moment ('+00:00' vs '.000Z') compare equal and differing offsets
        // compare chronologically — a raw string compare here models a database
        // that does not exist (GOLDEN-FIXES #25). Fall back to string compare
        // only for non-date values (uuids, plain dates are order-equivalent).
        const leftMs = Date.parse(left);
        const rightMs = Date.parse(right);
        const [l, r] =
          Number.isNaN(leftMs) || Number.isNaN(rightMs)
            ? [left, right]
            : [leftMs, rightMs];
        if (l === r) return 0;
        return (l < r ? -1 : 1) * (ascending ? 1 : -1);
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
    // PostgREST `.or('a.is.null,a.gte.X')` — a row matches if ANY branch does.
    // Only the two operators 065 uses are modelled; anything else throws
    // rather than silently passing.
    or: mock((expression: string) => {
      record('or', expression);
      orGroups.push(
        expression.split(',').map(branch => {
          const [column, op, value] = branch.split('.');
          if (op !== 'is' && op !== 'gte') {
            throw new Error(`fake chain: unsupported or() operator ${op}`);
          }
          return { column, op, value } as OrBranch;
        })
      );
      return chain;
    }),
    is: mock((key: string, value: unknown) => {
      record('is', key, value);
      isFilters.push([key, value]);
      return chain;
    }),
    update: mock((patch: Record<string, unknown>) => {
      record('update', patch);
      updatePatch = patch;
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

  // 065's load-bearing invariant, and the one mistake its header warns against.
  // `endForCarer` ends an arrangement when a member is removed; the engine
  // prices HISTORICAL weeks from this very list (weekEarningsService feeds
  // `listForCarer` into the in-memory resolver). Filter ended rows out HERE and
  // every week worked before the removal silently re-prices to nothing — the
  // per-date exclusion belongs in `effectiveOn`, never in the history read.
  it('includes ENDED rows — a removal must not erase the terms that priced past weeks', async () => {
    withRows([arrangement({ id: 'pa-ended', valid_to: '2026-06-30' })]);
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

describe('PayArrangementRepository.effectiveOn — ended arrangements (065)', () => {
  // Removal end-dates the arrangement so a rejoined carer has no live terms
  // and a parent must re-confirm them (docs/11-MONEY.md §10).
  it('ignores an arrangement that ended before the date — a rejoined carer has no terms', async () => {
    withRows([
      arrangement({ valid_from: '2026-01-01', valid_to: '2026-03-31' }),
    ]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-07-01')).toBeNull();
  });

  // THE load-bearing case: a week worked in March must keep pricing at March's
  // rate after a July removal, or every past timesheet re-prices to nothing.
  it('still resolves the arrangement for a date BEFORE the end — history keeps pricing', async () => {
    withRows([
      arrangement({ valid_from: '2026-01-01', valid_to: '2026-06-30' }),
    ]);
    const repo = new PayArrangementRepository();

    const found = await repo.effectiveOn('h1', 'carer-1', '2026-03-15');

    expect(found).toMatchObject({ id: 'pa-1', rate_minor: 1500 });
  });

  it('resolves the arrangement ON its valid_to — the end is inclusive, so the removal day is paid', async () => {
    withRows([
      arrangement({ valid_from: '2026-01-01', valid_to: '2026-06-30' }),
    ]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-06-30')).toMatchObject(
      {
        id: 'pa-1',
      }
    );
  });

  it('still resolves a live row — valid_to null is every arrangement that predates 065', async () => {
    withRows([arrangement({ valid_to: null })]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-07-01')).toMatchObject(
      {
        id: 'pa-1',
      }
    );
  });

  it('picks the live row over an ended one for a current date', async () => {
    withRows([
      arrangement({
        id: 'pa-old',
        valid_from: '2026-01-01',
        valid_to: '2026-03-31',
      }),
      arrangement({
        id: 'pa-new',
        valid_from: '2026-04-01',
        valid_to: null,
        created_at: '2026-04-01T09:00:00.000Z',
      }),
    ]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-07-01')).toMatchObject(
      {
        id: 'pa-new',
      }
    );
  });
});

describe('PayArrangementRepository.endForCarer (065)', () => {
  it('end-dates the live arrangement and returns what it ended', async () => {
    const row = arrangement({ valid_to: null });
    withRows([row]);
    const repo = new PayArrangementRepository();

    const ended = await repo.endForCarer('h1', 'carer-1', '2026-07-01');

    expect(row.valid_to).toBe('2026-07-01');
    expect(ended).toHaveLength(1);
  });

  it('leaves an ALREADY-ended row alone — the end date must not move on a re-removal', async () => {
    // Remove -> rejoin -> remove again, or a retry: rewriting valid_to would
    // reopen or re-close a window that history has already been priced against.
    const row = arrangement({ valid_to: '2026-03-31' });
    withRows([row]);
    const repo = new PayArrangementRepository();

    const ended = await repo.endForCarer('h1', 'carer-1', '2026-07-01');

    expect(row.valid_to).toBe('2026-03-31');
    expect(ended).toHaveLength(0);
  });

  it('scopes the write to this household and carer, and only to live rows', async () => {
    withRows([arrangement({ valid_to: null })]);
    const repo = new PayArrangementRepository();

    await repo.endForCarer('h1', 'carer-1', '2026-07-01');

    const eqs = lastCalls.filter(call => call.method === 'eq').map(c => c.args);
    expect(eqs).toContainEqual(['household_id', 'h1']);
    expect(eqs).toContainEqual(['carer_id', 'carer-1']);
    expect(
      lastCalls.some(c => c.method === 'is' && c.args[0] === 'valid_to')
    ).toBe(true);
  });

  it('throws a DatabaseError when the write fails', async () => {
    withRows([arrangement({ valid_to: null })], { message: 'boom' });
    const repo = new PayArrangementRepository();
    await expect(
      repo.endForCarer('h1', 'carer-1', '2026-07-01')
    ).rejects.toThrow('Failed to end pay arrangements for carer');
  });
});

/**
 * 033/058: a departed carer's `pay_arrangements` rows keep `carer_id = null`,
 * so `listForCarer` — the only history read the routes had — can never reach
 * the terms she actually worked under. This is the household-scoped read.
 */
describe('PayArrangementRepository.listForHousehold', () => {
  it('returns every carer’s history, including a departed carer’s', async () => {
    withRows([
      arrangement({
        id: 'live',
        carer_id: 'carer-1',
        valid_from: '2026-01-01',
      }),
      arrangement({
        id: 'departed',
        carer_id: null,
        household_member_id: 'hm-2',
        valid_from: '2026-03-01',
      }),
    ]);
    const repo = new PayArrangementRepository();

    const rows = await repo.listForHousehold('h1');

    // Newest first, same ordering keys as `listForCarer`.
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['departed', 'live']);
  });

  it('never filters carer_id — that is the whole point', async () => {
    withRows([]);
    const repo = new PayArrangementRepository();

    await repo.listForHousehold('h1');

    const eqs = lastCalls.filter(call => call.method === 'eq').map(c => c.args);
    expect(eqs).toContainEqual(['household_id', 'h1']);
    expect(eqs.some(args => args[0] === 'carer_id')).toBe(false);
  });

  it('still scopes to ONE household', async () => {
    withRows([
      arrangement({ id: 'mine' }),
      arrangement({ id: 'theirs', household_id: 'h2' }),
    ]);
    const repo = new PayArrangementRepository();

    expect(
      (await repo.listForHousehold('h1')).map((r: FakeRow) => r.id)
    ).toEqual(['mine']);
  });

  it('throws a DatabaseError when the query fails', async () => {
    withRows([arrangement()], { message: 'boom' });
    const repo = new PayArrangementRepository();
    await expect(repo.listForHousehold('h1')).rejects.toThrow(
      'Failed to list pay arrangements for household'
    );
  });
});
