import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let CarerTimeOffRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    order: mock(() => Promise.resolve(finalResponse)),
    update: mock(() => chain),
    single: mock(() => Promise.resolve(finalResponse)),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/availability/repositories/carerTimeOffRepository'
  );
  CarerTimeOffRepository = mod.CarerTimeOffRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('CarerTimeOffRepository.listByUserId', () => {
  it('returns the rows for a user', async () => {
    const rows = [
      { id: 't1', user_id: 'u1', starts_at: '2026-01-01T00:00:00Z' },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new CarerTimeOffRepository();
    expect(await repo.listByUserId('u1')).toEqual(rows);
  });

  it('returns [] when there are no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new CarerTimeOffRepository();
    expect(await repo.listByUserId('u1')).toEqual([]);
  });

  it('throws DatabaseError on a query failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new CarerTimeOffRepository();
    await expect(repo.listByUserId('u1')).rejects.toThrow();
  });
});

describe('CarerTimeOffRepository.cancelById', () => {
  it('soft-cancels — updates status to cancelled and returns the row (never a hard delete)', async () => {
    const cancelled = { id: 't1', user_id: 'u1', status: 'cancelled' };
    const chain = createMockQueryChain({ data: cancelled, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new CarerTimeOffRepository();
    const result = await repo.cancelById('t1');

    expect(chain.update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(chain.eq).toHaveBeenCalledWith('id', 't1');
    expect(result).toEqual(cancelled);
  });

  it('throws DatabaseError when the update fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new CarerTimeOffRepository();
    await expect(repo.cancelById('t1')).rejects.toThrow();
  });
});
