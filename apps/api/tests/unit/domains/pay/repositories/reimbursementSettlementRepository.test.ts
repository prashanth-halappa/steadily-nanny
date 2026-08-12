/**
 * @module tests/unit/domains/pay/repositories/reimbursementSettlementRepository
 *
 * The ONE thing this repository does that `BaseRepository` does not: translate
 * the 23505 raised by `reimbursement_settlements_week_idx` (migration 086)
 * into the typed `AlreadySettledError` — the same shape
 * `expenseRepository.create` uses for 051's partial index.
 *
 * The PostgREST chain below really applies its `eq` filters to an in-memory
 * row set, the same discipline as `expenseRepository.test.ts`: a
 * recording-only fake would pass a `listForWeek` that forgot its
 * `household_id` filter, and a repository that bypasses RLS with no filter of
 * its own reads across households (docs/11-MONEY.md §8/§9).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_OFFSET = FIXTURE_TS.replace('.000Z', '+00:00');

interface FakeRow {
  [key: string]: unknown;
}

let ReimbursementSettlementRepository: any;
let AlreadySettledError: any;
let DatabaseError: any;
let mockSupabaseService: any;
let lastCalls: { method: string; args: unknown[] }[] = [];

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  let insertRow: Record<string, unknown> | null = null;

  const record = (method: string, ...args: unknown[]) => {
    lastCalls.push({ method, args });
  };

  const resolveRows = (): FakeRow[] =>
    rows.filter(row => eqFilters.every(([key, value]) => row[key] === value));

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
    order: mock((key: string, opts?: { ascending?: boolean }) => {
      record('order', key, opts);
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
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        error ? { data: null, error } : { data: resolveRows(), error: null }
      ).then(resolve),
  };
  return chain;
}

function withRows(rows: FakeRow[], error: unknown = null): void {
  mockSupabaseService.from.mockImplementation(() =>
    createFakeQuery(rows, error)
  );
}

function settlement(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'set-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    week_start: '2026-08-03',
    amount_minor: 14_600,
    currency: 'GBP',
    settled_at: '2026-08-10',
    note: null,
    recorded_by: 'parent-1',
    // `+00:00`, PostgREST's serialisation — not the JS `.000Z` form
    // (GOLDEN-FIXES #25).
    created_at: FIXTURE_TS_OFFSET,
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
    return { supabase: obj, supabaseService: obj };
  });

  ReimbursementSettlementRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/reimbursementSettlementRepository'
    )
  ).ReimbursementSettlementRepository;
  AlreadySettledError = (
    await import('../../../../../src/domains/pay/errors/payErrors')
  ).AlreadySettledError;
  DatabaseError = (await import('../../../../../src/errors')).DatabaseError;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  lastCalls = [];
  mockSupabaseService.from.mockClear?.();
});

describe('ReimbursementSettlementRepository.listForWeek', () => {
  it('filters by household_id AND the exact week_start', async () => {
    withRows([
      settlement({ id: 'mine' }),
      settlement({ id: 'other-week', week_start: '2026-07-27' }),
      settlement({ id: 'other-household', household_id: 'h2' }),
    ]);
    const repo = new ReimbursementSettlementRepository();

    const rows = await repo.listForWeek('h1', '2026-08-03');

    expect(mockSupabaseService.from).toHaveBeenCalledWith(
      'reimbursement_settlements'
    );
    expect(rows.map((row: FakeRow) => row.id)).toEqual(['mine']);
    expect(
      lastCalls.filter(call => call.method === 'eq').map(call => call.args)
    ).toEqual([
      ['household_id', 'h1'],
      ['week_start', '2026-08-03'],
    ]);
  });

  it('a query error becomes a DatabaseError, never a silent empty list', async () => {
    withRows([], { message: 'boom', code: 'XX000' });
    const repo = new ReimbursementSettlementRepository();

    await expect(repo.listForWeek('h1', '2026-08-03')).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

describe('ReimbursementSettlementRepository.create', () => {
  it('returns the inserted row', async () => {
    withRows([]);
    const repo = new ReimbursementSettlementRepository();

    const created = await repo.create(settlement({ id: undefined }));

    expect(created.amount_minor).toBe(14_600);
  });

  it('translates 23505 into AlreadySettledError, carrying the carer-week', async () => {
    withRows([], { code: '23505', message: 'duplicate key value' });
    const repo = new ReimbursementSettlementRepository();

    const thrown = await repo
      .create({
        household_id: 'h1',
        carer_id: 'carer-1',
        week_start: '2026-08-03',
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AlreadySettledError);
    expect(thrown.metadata).toMatchObject({
      householdId: 'h1',
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
  });

  it('any other insert error stays a DatabaseError', async () => {
    withRows([], { code: '23514', message: 'check violation' });
    const repo = new ReimbursementSettlementRepository();

    await expect(repo.create({ household_id: 'h1' })).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

describe('append-only', () => {
  it('adds no update or delete helper of its own (086: no correction path)', () => {
    const source = readFileSync(
      join(
        __dirname,
        '../../../../../src/domains/pay/repositories/reimbursementSettlementRepository.ts'
      ),
      'utf-8'
    );

    expect(source).not.toContain('async update');
    expect(source).not.toContain('async delete');
  });
});
