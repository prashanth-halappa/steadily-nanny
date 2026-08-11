import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ChildCommitmentRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    in: mock(() => chain),
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

describe('ChildCommitmentRepository.listHouseholdIdsWithCommitments', () => {
  /**
   * Two tables, two chains — the second query is the point of the test.
   * `from()` is called with 'child_commitments' first, then 'households'.
   */
  function chainsByTable(rows: Record<string, unknown[]>) {
    const chains: Record<string, any> = {};
    mockSupabaseService.from.mockImplementation((table: string) => {
      chains[table] = createMockQueryChain({
        data: rows[table] ?? [],
        error: null,
      });
      return chains[table];
    });
    return chains;
  }

  // §12 "Draft, cron": nothing. 093's trigger makes eight of the ten jobs
  // structurally empty; this repository is the enumeration point for the two
  // that DO start from households (scheduleHorizonJob, uncoveredDigestJob), so
  // it is where the filter belongs. Its caller set is jobs-only, which is what
  // makes narrowing it here safe — `householdRepository.findByIds` is
  // deliberately left alone because the product path uses it.
  it('drops households that are still drafts, in one extra batched query', async () => {
    const chains = chainsByTable({
      child_commitments: [
        { household_id: 'h-live' },
        { household_id: 'h-draft' },
        { household_id: 'h-live' },
      ],
      households: [{ id: 'h-live' }],
    });
    const repo = new ChildCommitmentRepository();

    expect(await repo.listHouseholdIdsWithCommitments()).toEqual(['h-live']);
    // Batched, never a lookup per household (GOLDEN-FIXES #28).
    expect(chains.households.in.mock.calls).toEqual([
      ['id', ['h-live', 'h-draft']],
    ]);
    expect(chains.households.eq.mock.calls).toEqual([['state', 'live']]);
  });

  it('does not ask about households at all when nothing has commitments', async () => {
    chainsByTable({ child_commitments: [] });
    const repo = new ChildCommitmentRepository();

    expect(await repo.listHouseholdIdsWithCommitments()).toEqual([]);
    expect(mockSupabaseService.from.mock.calls.map((c: any[]) => c[0])).toEqual(
      ['child_commitments']
    );
  });
});
