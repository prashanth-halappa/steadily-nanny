import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ChildCommitmentRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    order: mock(() => chain),
    insert: mock(() => chain),
    update: mock(() => chain),
    delete: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/child/repositories/childCommitmentRepository'
  );
  ChildCommitmentRepository = mod.ChildCommitmentRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

const commitment = {
  id: 'cm1',
  child_id: 'c1',
  household_id: 'h1',
  kind: 'preschool',
  label: 'Preschool',
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
  start_time: '09:00:00',
  end_time: '12:00:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
  excluded_from_cover: true,
  created_at: 't',
  updated_at: 't',
};

describe('ChildCommitmentRepository.findByChildId', () => {
  it("lists a child's commitments, oldest-created first", async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [commitment], error: null })
    );
    const repo = new ChildCommitmentRepository();
    const result = await repo.findByChildId('c1');
    expect(result).toEqual([commitment]);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('child_commitments');
  });

  it('returns [] when there are none', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ChildCommitmentRepository();
    expect(await repo.findByChildId('c1')).toEqual([]);
  });

  it('throws DatabaseError on failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new ChildCommitmentRepository();
    await expect(repo.findByChildId('c1')).rejects.toThrow();
  });
});

describe('ChildCommitmentRepository.findByHouseholdId', () => {
  it("lists a household's commitments across all children", async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [commitment], error: null })
    );
    const repo = new ChildCommitmentRepository();
    const result = await repo.findByHouseholdId('h1');
    expect(result).toEqual([commitment]);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('child_commitments');
  });

  it('throws DatabaseError on failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new ChildCommitmentRepository();
    await expect(repo.findByHouseholdId('h1')).rejects.toThrow();
  });
});
