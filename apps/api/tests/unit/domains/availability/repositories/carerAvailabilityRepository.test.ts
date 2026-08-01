import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let CarerAvailabilityRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    order: mock(() => Promise.resolve(finalResponse)),
    upsert: mock(() => chain),
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
    '../../../../../src/domains/availability/repositories/carerAvailabilityRepository'
  );
  CarerAvailabilityRepository = mod.CarerAvailabilityRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('CarerAvailabilityRepository.findByUserId', () => {
  it('returns the rows for a user, ordered by weekday', async () => {
    const rows = [
      { id: 'a1', user_id: 'u1', weekday: 1 },
      { id: 'a2', user_id: 'u1', weekday: 3 },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new CarerAvailabilityRepository();
    const result = await repo.findByUserId('u1');
    expect(result).toEqual(rows);
  });

  it('returns [] when there are no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new CarerAvailabilityRepository();
    expect(await repo.findByUserId('u1')).toEqual([]);
  });

  it('throws DatabaseError on a query failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new CarerAvailabilityRepository();
    await expect(repo.findByUserId('u1')).rejects.toThrow();
  });
});

describe('CarerAvailabilityRepository.upsertForWeekday', () => {
  it('upserts on (user_id, weekday) and returns the row', async () => {
    const upserted = {
      id: 'a1',
      user_id: 'u1',
      weekday: 2,
      is_available: true,
    };
    const chain = createMockQueryChain({ data: upserted, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new CarerAvailabilityRepository();
    const result = await repo.upsertForWeekday('u1', 2, { is_available: true });

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        weekday: 2,
        is_available: true,
      }),
      expect.objectContaining({ onConflict: 'user_id,weekday' })
    );
    expect(result).toEqual(upserted);
  });

  it('throws DatabaseError when the upsert fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new CarerAvailabilityRepository();
    await expect(
      repo.upsertForWeekday('u1', 2, { is_available: true })
    ).rejects.toThrow();
  });
});
