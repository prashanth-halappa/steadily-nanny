/**
 * `household_custom_holidays` data access (107).
 *
 * A replace-set, not a toggle: the row existing IS the observance, so an
 * empty payload must delete every row (that is how the last custom day is
 * removed). Deletes go by id after a TypeScript filter — never PostgREST
 * `not.in` with user-supplied names (quoting trap).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_OFFSET = FIXTURE_TS.replace('.000Z', '+00:00');

const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let HouseholdCustomHolidayRepository: any;
let mockSupabaseService: any;

interface CallRecord {
  rows: unknown;
  options: unknown;
  eqFilters: [string, unknown][];
  inFilters: [string, unknown][];
  deleteCalled: boolean;
  upsertCalled: boolean;
}

let calls: CallRecord[];
let nextResponse: { data: unknown; error: unknown }[];

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: [], error: null }
): any {
  const rec: CallRecord = {
    rows: undefined,
    options: undefined,
    eqFilters: [],
    inFilters: [],
    deleteCalled: false,
    upsertCalled: false,
  };
  calls.push(rec);

  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      rec.eqFilters.push([key, value]);
      return chain;
    }),
    in: mock((key: string, value: unknown) => {
      rec.inFilters.push([key, value]);
      return chain;
    }),
    order: mock(() => chain),
    upsert: mock((rows: unknown, options: unknown) => {
      rec.upsertCalled = true;
      rec.rows = rows;
      rec.options = options;
      return chain;
    }),
    delete: mock(() => {
      rec.deleteCalled = true;
      return chain;
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) => Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

function customRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: HOUSEHOLD_ID,
    name: 'Diwali',
    dates: ['2026-11-08'],
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

  ({ HouseholdCustomHolidayRepository } = await import(
    '../../../../../src/domains/household/repositories/householdCustomHolidayRepository'
  ));
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  calls = [];
  nextResponse = [];
  mockSupabaseService.from.mockClear?.();
  mockSupabaseService.from.mockImplementation(() => {
    const response = nextResponse.shift() ?? { data: [], error: null };
    return createMockQueryChain(response);
  });
});

describe('HouseholdCustomHolidayRepository.listForHousehold', () => {
  it('scopes the read to the household and returns the rows', async () => {
    const row = customRow();
    nextResponse = [{ data: [row], error: null }];

    const repo = new HouseholdCustomHolidayRepository();
    const rows = await repo.listForHousehold(HOUSEHOLD_ID);

    expect(mockSupabaseService.from).toHaveBeenCalledWith(
      'household_custom_holidays'
    );
    expect(calls[0]!.eqFilters).toEqual([['household_id', HOUSEHOLD_ID]]);
    expect(rows).toEqual([row]);
  });

  it('returns [] rather than null when the household has no custom days yet', async () => {
    nextResponse = [{ data: null, error: null }];
    const repo = new HouseholdCustomHolidayRepository();
    expect(await repo.listForHousehold('h1')).toEqual([]);
  });

  it('throws DatabaseError when the read fails', async () => {
    nextResponse = [{ data: null, error: { message: 'boom' } }];
    const repo = new HouseholdCustomHolidayRepository();
    await expect(repo.listForHousehold('h1')).rejects.toThrow(
      /custom holiday/i
    );
  });
});

describe('HouseholdCustomHolidayRepository.replaceSet', () => {
  it('upserts named rows on the (household_id, name) conflict target', async () => {
    const diwali = customRow();
    nextResponse = [
      { data: [diwali], error: null },
      { data: [diwali], error: null },
    ];

    const repo = new HouseholdCustomHolidayRepository();
    await repo.replaceSet(HOUSEHOLD_ID, [
      { name: 'Diwali', dates: ['2026-11-08'] },
    ]);

    const upsert = calls.find(call => call.upsertCalled);
    expect(upsert?.rows).toEqual([
      {
        household_id: HOUSEHOLD_ID,
        name: 'Diwali',
        dates: ['2026-11-08'],
      },
    ]);
    expect(upsert?.options).toEqual({ onConflict: 'household_id,name' });
    for (const row of upsert?.rows as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty('updated_at');
      expect(row).not.toHaveProperty('created_at');
    }
  });

  it('deletes rows whose name is not in the payload, by id', async () => {
    const keep = customRow({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Diwali',
      dates: ['2026-11-08'],
    });
    const stale = customRow({
      id: '22222222-2222-4222-8222-222222222222',
      name: "Grandma's birthday",
      dates: ['2026-03-01'],
    });
    nextResponse = [
      { data: [keep], error: null },
      { data: [keep, stale], error: null },
      { data: null, error: null },
      { data: [keep], error: null },
    ];

    const repo = new HouseholdCustomHolidayRepository();
    await repo.replaceSet(HOUSEHOLD_ID, [
      { name: 'Diwali', dates: ['2026-11-08'] },
    ]);

    const deleted = calls.find(call => call.deleteCalled);
    expect(deleted).toBeDefined();
    expect(deleted?.inFilters).toEqual([['id', [stale.id]]]);
  });

  it('clears every row when the payload is empty', async () => {
    const first = customRow({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Diwali',
      dates: ['2026-11-08'],
    });
    const second = customRow({
      id: '22222222-2222-4222-8222-222222222222',
      name: "Grandma's birthday",
      dates: ['2026-03-01'],
    });
    nextResponse = [
      { data: [first, second], error: null },
      { data: null, error: null },
      { data: [], error: null },
    ];

    const repo = new HouseholdCustomHolidayRepository();
    const result = await repo.replaceSet(HOUSEHOLD_ID, []);

    expect(calls.every(call => !call.upsertCalled)).toBe(true);
    const deleted = calls.find(call => call.deleteCalled);
    expect(deleted?.inFilters).toEqual([['id', [first.id, second.id]]]);
    expect(result).toEqual([]);
  });

  it('returns the list that reflects the final state, name-ascending', async () => {
    const alpha = customRow({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Alpha Day',
      dates: ['2026-01-01'],
    });
    const zed = customRow({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Zed Day',
      dates: ['2026-12-01'],
    });
    const stale = customRow({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Old Day',
      dates: ['2026-06-01'],
    });
    const finalRows = [alpha, zed];
    nextResponse = [
      { data: [zed, alpha], error: null },
      { data: [alpha, stale, zed], error: null },
      { data: null, error: null },
      { data: finalRows, error: null },
    ];

    const repo = new HouseholdCustomHolidayRepository();
    const result = await repo.replaceSet(HOUSEHOLD_ID, [
      { name: 'Zed Day', dates: ['2026-12-01'] },
      { name: 'Alpha Day', dates: ['2026-01-01'] },
    ]);

    expect(result).toEqual(finalRows);
  });
});
