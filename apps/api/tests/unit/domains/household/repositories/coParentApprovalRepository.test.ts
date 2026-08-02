import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let CoParentApprovalRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    lt: mock(() => chain),
    update: mock(() => chain),
    order: mock(() => chain),
    single: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) => Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/household/repositories/coParentApprovalRepository'
  );
  CoParentApprovalRepository = mod.CoParentApprovalRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('CoParentApprovalRepository.listPendingByHousehold', () => {
  it('returns pending rows for the household', async () => {
    const rows = [{ id: 'a1', household_id: 'h1', status: 'pending' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new CoParentApprovalRepository();
    expect(await repo.listPendingByHousehold('h1')).toEqual(rows);
  });

  it('returns [] when there are none', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new CoParentApprovalRepository();
    expect(await repo.listPendingByHousehold('h1')).toEqual([]);
  });
});

describe('CoParentApprovalRepository.respond', () => {
  it('updates status, responded_by, and responded_at', async () => {
    const updated = { id: 'a1', status: 'approved', responded_by: 'u1' };
    const chain = createMockQueryChain({ data: updated, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();
    const result = await repo.respond('a1', 'approved', 'u1');
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', responded_by: 'u1' })
    );
    expect(result).toEqual(updated);
  });
});

describe('CoParentApprovalRepository.expireTimedOut', () => {
  it('flips past-due pending rows to timed_out and returns them', async () => {
    const expired = [{ id: 'a1', status: 'timed_out' }];
    const chain = createMockQueryChain({ data: expired, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();
    const result = await repo.expireTimedOut('2026-01-01T00:00:00.000Z');
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'timed_out' })
    );
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(chain.lt).toHaveBeenCalledWith(
      'timeout_at',
      '2026-01-01T00:00:00.000Z'
    );
    expect(result).toEqual(expired);
  });

  it('scopes to one household when a householdId is given', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new CoParentApprovalRepository();
    await repo.expireTimedOut('2026-01-01T00:00:00.000Z', 'h1');
    expect(chain.eq).toHaveBeenCalledWith('household_id', 'h1');
  });
});
