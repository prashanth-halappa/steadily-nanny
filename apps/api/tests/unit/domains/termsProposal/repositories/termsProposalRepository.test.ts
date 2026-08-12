/**
 * The two things this repository does that `BaseRepository` does not:
 *
 *  - translate the 23505 raised by `terms_proposals_open_unique_idx`
 *    (092, a PARTIAL index) into a typed conflict. GOLDEN-FIXES #31: PostgREST
 *    can never name a partial index as an `onConflict` target, so catching the
 *    code is the only option — and the catch must NAME the index, or an
 *    unrelated constraint violation gets swallowed as "already open".
 *  - CAS the lifecycle stamps on `status = 'proposed'`, so two simultaneous
 *    answers to one proposal cannot both win.
 *
 * The fake chain really applies its `eq`/`is` filters, the same discipline as
 * `reimbursementSettlementRepository.test.ts`: a recording-only fake would
 * pass a `listChain` that forgot its `household_id` filter, and a repository
 * that bypasses RLS with no filter of its own reads across households.
 *
 * @module tests/unit/domains/termsProposal/repositories/termsProposalRepository
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

interface FakeRow {
  [key: string]: unknown;
}

let TermsProposalRepository: any;
let OpenTermsProposalExistsError: any;
let DatabaseError: any;
let mockSupabaseService: any;
let lastCalls: { method: string; args: unknown[] }[] = [];

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const filters: ((row: FakeRow) => boolean)[] = [];
  let written: Record<string, unknown> | null = null;

  const record = (method: string, ...args: unknown[]) => {
    lastCalls.push({ method, args });
  };

  const resolveRows = (): FakeRow[] =>
    rows.filter(row => filters.every(match => match(row)));

  const chain: any = {
    select: mock((...args: unknown[]) => {
      record('select', ...args);
      return chain;
    }),
    eq: mock((key: string, value: unknown) => {
      record('eq', key, value);
      filters.push(row => row[key] === value);
      return chain;
    }),
    is: mock((key: string, value: unknown) => {
      record('is', key, value);
      filters.push(row => row[key] === value);
      return chain;
    }),
    order: mock((key: string, opts?: { ascending?: boolean }) => {
      record('order', key, opts);
      return chain;
    }),
    insert: mock((row: Record<string, unknown>) => {
      record('insert', row);
      written = row;
      return chain;
    }),
    update: mock((row: Record<string, unknown>) => {
      record('update', row);
      written = row;
      return chain;
    }),
    single: mock(async () => {
      if (error) return { data: null, error };
      return { data: written ?? resolveRows()[0] ?? null, error: null };
    }),
    maybeSingle: mock(async () => {
      if (error) return { data: null, error };
      const match = resolveRows()[0] ?? null;
      // An update returns the patched row only when a row actually matched —
      // that is the CAS: no match, no row, no win.
      if (written && !match) return { data: null, error: null };
      return {
        data: match ? { ...match, ...(written ?? {}) } : null,
        error: null,
      };
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

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_CREATED_AT = new Date(Date.now() - 2 * DAY_MS)
  .toISOString()
  .replace('.000Z', '+00:00');
const FIXTURE_STAMP_AT = new Date().toISOString();
const FIXTURE_PRIOR_VIEWED_AT = new Date(Date.now() - 3 * DAY_MS)
  .toISOString()
  .replace('.000Z', '+00:00');

function row(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'tp-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    proposed_by: 'carer-1',
    direction: 'carer',
    status: 'proposed',
    terms: { rate_minor: 2800 },
    viewed_at: null,
    created_at: FIXTURE_CREATED_AT,
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
    return { supabase: obj, supabaseService: obj };
  });

  TermsProposalRepository = (
    await import(
      '../../../../../src/domains/termsProposal/repositories/termsProposalRepository'
    )
  ).TermsProposalRepository;
  OpenTermsProposalExistsError = (
    await import(
      '../../../../../src/domains/termsProposal/errors/termsProposalErrors'
    )
  ).OpenTermsProposalExistsError;
  DatabaseError = (await import('../../../../../src/errors')).DatabaseError;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  lastCalls = [];
  mockSupabaseService.from.mockClear?.();
});

describe('TermsProposalRepository.create — GOLDEN-FIXES #31', () => {
  it('returns the inserted row', async () => {
    withRows([]);
    const repo = new TermsProposalRepository();
    const created = await repo.create(row({ id: undefined }));
    expect(created.direction).toBe('carer');
    expect(mockSupabaseService.from).toHaveBeenCalledWith('terms_proposals');
  });

  it('translates a 23505 NAMING the open-proposal index into OpenTermsProposalExistsError', async () => {
    withRows([], {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "terms_proposals_open_unique_idx"',
    });
    const repo = new TermsProposalRepository();
    const thrown = await repo.create(row()).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(OpenTermsProposalExistsError);
  });

  it('a 23505 from ANOTHER constraint still surfaces, never swallowed as "already open"', async () => {
    withRows([], {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "some_other_idx"',
    });
    const repo = new TermsProposalRepository();
    const thrown = await repo.create(row()).catch((error: unknown) => error);
    expect(thrown).not.toBeInstanceOf(OpenTermsProposalExistsError);
    expect(thrown).toBeInstanceOf(DatabaseError);
  });

  it('a non-unique error is a DatabaseError', async () => {
    withRows([], { code: 'XX000', message: 'boom' });
    const repo = new TermsProposalRepository();
    await expect(repo.create(row())).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('TermsProposalRepository.findOpenForCarer', () => {
  it('filters household, carer AND status=proposed', async () => {
    withRows([
      row({ id: 'open' }),
      row({ id: 'countered', status: 'countered' }),
      row({ id: 'other-household', household_id: 'h2' }),
      row({ id: 'other-carer', carer_id: 'carer-2' }),
    ]);
    const repo = new TermsProposalRepository();
    const found = await repo.findOpenForCarer('h1', 'carer-1');
    expect(found?.id).toBe('open');
    expect(
      lastCalls.filter(call => call.method === 'eq').map(call => call.args)
    ).toEqual([
      ['household_id', 'h1'],
      ['carer_id', 'carer-1'],
      ['status', 'proposed'],
    ]);
  });
});

describe('TermsProposalRepository.listChain', () => {
  it('scopes to the pair and orders newest first', async () => {
    withRows([row({ id: 'mine' }), row({ id: 'theirs', carer_id: 'carer-2' })]);
    const repo = new TermsProposalRepository();
    const rows = await repo.listChain('h1', 'carer-1');
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['mine']);
    expect(lastCalls.find(call => call.method === 'order')?.args).toEqual([
      'created_at',
      { ascending: false },
    ]);
  });

  it('a query error becomes a DatabaseError, never a silent empty history', async () => {
    withRows([], { message: 'boom', code: 'XX000' });
    const repo = new TermsProposalRepository();
    await expect(repo.listChain('h1', 'carer-1')).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

describe('TermsProposalRepository.resolve — CAS on status=proposed', () => {
  it('patches a proposed row and returns it', async () => {
    withRows([row()]);
    const repo = new TermsProposalRepository();
    const updated = await repo.resolve('tp-1', {
      status: 'countered',
      responded_at: FIXTURE_STAMP_AT,
    });
    expect(updated?.status).toBe('countered');
    expect(
      lastCalls.filter(call => call.method === 'eq').map(call => call.args)
    ).toEqual([
      ['id', 'tp-1'],
      ['status', 'proposed'],
    ]);
  });

  it('returns null when the row has already left proposed — the loser of a race', async () => {
    withRows([row({ status: 'accepted' })]);
    const repo = new TermsProposalRepository();
    expect(await repo.resolve('tp-1', { status: 'withdrawn' })).toBeNull();
  });
});

describe('TermsProposalRepository.stampViewed — one-way', () => {
  it('only writes when viewed_at is still null', async () => {
    withRows([row()]);
    const repo = new TermsProposalRepository();
    const stamped = await repo.stampViewed('tp-1', FIXTURE_STAMP_AT);
    expect(stamped?.viewed_at).toBe(FIXTURE_STAMP_AT);
    expect(lastCalls.find(call => call.method === 'is')?.args).toEqual([
      'viewed_at',
      null,
    ]);
  });

  it('never re-stamps a row that already carries a viewed_at', async () => {
    withRows([row({ viewed_at: FIXTURE_PRIOR_VIEWED_AT })]);
    const repo = new TermsProposalRepository();
    expect(await repo.stampViewed('tp-1', FIXTURE_STAMP_AT)).toBeNull();
  });
});
