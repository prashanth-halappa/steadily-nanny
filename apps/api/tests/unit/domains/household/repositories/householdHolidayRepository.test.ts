/**
 * `household_holidays` data access (080).
 *
 * The two things a recording mock can actually prove here are the two things
 * that silently break: the conflict target the upsert names (name it wrong and
 * every save 23505s or, worse, inserts a duplicate toggle), and whether the
 * seed leaves existing rows alone. `updated_at` is deliberately NOT asserted as
 * a written column — the SQL trigger owns it (080), and setting it from
 * TypeScript would be a second clock.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { holidayKeysForCountry } from '@steadily-nanny/shared-types/holidayPacks';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_OFFSET = FIXTURE_TS.replace('.000Z', '+00:00');

let HouseholdHolidayRepository: any;
let mockSupabaseService: any;

interface Recorded {
  rows: unknown;
  options: unknown;
  eqFilters: [string, unknown][];
  inFilters: [string, unknown][];
  deleteCalled: boolean;
}

let recorded: Recorded;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: [], error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      recorded.eqFilters.push([key, value]);
      return chain;
    }),
    in: mock((key: string, value: unknown) => {
      recorded.inFilters.push([key, value]);
      return chain;
    }),
    order: mock(() => chain),
    upsert: mock((rows: unknown, options: unknown) => {
      recorded.rows = rows;
      recorded.options = options;
      return chain;
    }),
    delete: mock(() => {
      recorded.deleteCalled = true;
      return chain;
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) => Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

// Deliberately BOTH timestamp serialisations across the fixtures in this file
// (GOLDEN-FIXES #25): PostgREST hands back `+00:00`, JS-built rows carry
// `.000Z`, and nothing here may depend on which one it got.
function holidayRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    holiday_key: 'independence_day',
    observed: true,
    created_at: FIXTURE_TS_OFFSET,
    updated_at: FIXTURE_TS,
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  ({ HouseholdHolidayRepository } = await import(
    '../../../../../src/domains/household/repositories/householdHolidayRepository'
  ));
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  recorded = {
    rows: undefined,
    options: undefined,
    eqFilters: [],
    inFilters: [],
    deleteCalled: false,
  };
  mockSupabaseService.from.mockClear?.();
  mockSupabaseService.from.mockImplementation(() => createMockQueryChain());
});

describe('HouseholdHolidayRepository.listForHousehold', () => {
  it('scopes the read to the household and returns the rows', async () => {
    const row = holidayRow();
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [row], error: null })
    );

    const repo = new HouseholdHolidayRepository();
    const rows = await repo.listForHousehold(row.household_id);

    expect(mockSupabaseService.from).toHaveBeenCalledWith('household_holidays');
    expect(recorded.eqFilters).toEqual([['household_id', row.household_id]]);
    expect(rows).toEqual([row]);
  });

  it('returns [] rather than null when the household has no toggles yet', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new HouseholdHolidayRepository();
    expect(await repo.listForHousehold('h1')).toEqual([]);
  });

  it('throws DatabaseError when the read fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new HouseholdHolidayRepository();
    await expect(repo.listForHousehold('h1')).rejects.toThrow(
      /household holidays/i
    );
  });
});

describe('HouseholdHolidayRepository.upsertMany', () => {
  it('names the (household_id, holiday_key) conflict target and overwrites', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: [holidayRow({ observed: false })],
        error: null,
      })
    );

    const repo = new HouseholdHolidayRepository();
    await repo.upsertMany('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [
      { holiday_key: 'independence_day', observed: false },
    ]);

    expect(recorded.rows).toEqual([
      {
        household_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        holiday_key: 'independence_day',
        observed: false,
      },
    ]);
    // The plain unique CONSTRAINT from 080 is nameable as a column list, so
    // unlike GOLDEN-FIXES #31's expression index this target really applies.
    expect(recorded.options).toEqual({
      onConflict: 'household_id,holiday_key',
    });
  });

  it('never writes updated_at — the 080 trigger owns it', async () => {
    const repo = new HouseholdHolidayRepository();
    await repo.upsertMany('h1', [{ holiday_key: 'labor_day', observed: true }]);
    for (const row of recorded.rows as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty('updated_at');
      expect(row).not.toHaveProperty('created_at');
    }
  });

  it('throws DatabaseError when the write fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new HouseholdHolidayRepository();
    await expect(
      repo.upsertMany('h1', [{ holiday_key: 'labor_day', observed: true }])
    ).rejects.toThrow(/household holidays/i);
  });
});

describe('HouseholdHolidayRepository.seedCountryPack', () => {
  it('writes one observed row per key in the country pack', async () => {
    const repo = new HouseholdHolidayRepository();
    await repo.seedCountryPack('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'US');

    const usKeys = holidayKeysForCountry('US');
    const rows = recorded.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(usKeys.length);
    expect(rows.map(row => row.holiday_key)).toEqual([...usKeys]);
    expect(rows.every(row => row.observed === true)).toBe(true);
    expect(
      rows.every(
        row => row.household_id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      )
    ).toBe(true);
  });

  it('seeds the Canadian pack when the household country is CA', async () => {
    const repo = new HouseholdHolidayRepository();
    await repo.seedCountryPack('h1', 'CA');

    const caKeys = holidayKeysForCountry('CA');
    const rows = recorded.rows as Record<string, unknown>[];
    expect(rows.map(row => row.holiday_key)).toEqual([...caKeys]);
    expect(rows.every(row => row.observed === true)).toBe(true);
  });

  it('ignores duplicates so a retried creation cannot 23505 or reset toggles', async () => {
    const repo = new HouseholdHolidayRepository();
    await repo.seedCountryPack('h1', 'US');

    expect(recorded.options).toEqual({
      onConflict: 'household_id,holiday_key',
      ignoreDuplicates: true,
    });
  });
});

describe('HouseholdHolidayRepository.deleteKeysNotIn', () => {
  const householdId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('deletes only the rows whose key is not in the keep set, by id', async () => {
    const keep = holidayRow({
      id: '11111111-1111-4111-8111-111111111111',
      holiday_key: 'new_years_day',
    });
    const staleA = holidayRow({
      id: '22222222-2222-4222-8222-222222222222',
      holiday_key: 'independence_day',
    });
    const staleB = holidayRow({
      id: '33333333-3333-4333-8333-333333333333',
      holiday_key: 'juneteenth',
    });
    let fromCalls = 0;
    mockSupabaseService.from.mockImplementation(() => {
      fromCalls += 1;
      if (fromCalls === 1) {
        return createMockQueryChain({
          data: [keep, staleA, staleB],
          error: null,
        });
      }
      return createMockQueryChain({ data: null, error: null });
    });

    const repo = new HouseholdHolidayRepository();
    await repo.deleteKeysNotIn(householdId, ['new_years_day']);

    expect(recorded.deleteCalled).toBe(true);
    expect(recorded.inFilters).toEqual([['id', [staleA.id, staleB.id]]]);
    expect(recorded.eqFilters).toEqual([['household_id', householdId]]);
  });

  it('no-ops the delete when nothing is stale', async () => {
    const row = holidayRow({ holiday_key: 'new_years_day' });
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [row], error: null })
    );

    const repo = new HouseholdHolidayRepository();
    await repo.deleteKeysNotIn(householdId, ['new_years_day', 'christmas_day']);

    expect(mockSupabaseService.from).toHaveBeenCalledTimes(1);
    expect(recorded.deleteCalled).toBe(false);
    expect(recorded.inFilters).toEqual([]);
  });
});
