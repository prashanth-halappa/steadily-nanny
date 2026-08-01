import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AlreadyMemberError } from '../../../../../src/domains/household/errors/householdErrors';

let HouseholdMemberRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    insert: mock(() => chain),
    order: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/household/repositories/householdMemberRepository'
  );
  HouseholdMemberRepository = mod.HouseholdMemberRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('HouseholdMemberRepository.createMembership', () => {
  it('translates a unique-constraint violation (23505) into AlreadyMemberError, not a 500', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      })
    );
    const repo = new HouseholdMemberRepository();
    await expect(
      repo.createMembership({
        household_id: 'h1',
        user_id: 'u1',
        role: 'nanny',
      })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
  });

  it('returns the created row on success', async () => {
    const created = {
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
    };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: created, error: null })
    );
    const repo = new HouseholdMemberRepository();
    const result = await repo.createMembership({
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
    });
    expect(result).toEqual(created);
  });
});
