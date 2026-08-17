/**
 * The orphan reaper's one decision: a household nobody has a row in.
 *
 * ZERO ROWS, NOT ZERO ACTIVE ROWS — this is the load-bearing bit. A nanny who
 * merely left keeps `status = 'removed'` and still reads the hours she worked
 * and the pay she was owed through `householdQueryService.listPastForUser()`
 * (`householdMemberRepository.findMembershipAnyStatus`'s header spells out
 * why: payroll is an audit trail, not a live surface that vanishes with the
 * badge). Sweeping on "no ACTIVE members" would delete the household out from
 * under her — and every `household_id` FK is `on delete cascade` across 19
 * tables, so it would take her tax records with it.
 *
 * A row survives only while the person exists: `household_members.user_id` is
 * `on delete cascade` (009, and 033's header records the deliberate choice not
 * to change it). So "no rows at all" means every person who was ever on this
 * roster has deleted their account — genuinely nobody left.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let HouseholdRepository: any;
let mockSupabaseService: any;

interface Row {
  [key: string]: unknown;
}

/** Rows the fake `household_members` table holds for the duration of a test. */
let memberRows: Row[] = [];
/** Every `households` delete the fake saw, as the id list it was given. */
let deletedIds: string[][] = [];
/** Forced errors, per table. */
let failures: Record<string, { message: string } | null> = {};

function membersChain(): any {
  let ids: string[] = [];
  const chain: any = {
    select: mock(() => chain),
    in: mock((key: string, values: string[]) => {
      if (key === 'household_id') {
        ids = values;
      }
      return chain;
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) =>
      Promise.resolve(
        failures.household_members
          ? { data: null, error: failures.household_members }
          : {
              data: memberRows
                .filter(row => ids.includes(row.household_id as string))
                .map(row => ({ household_id: row.household_id })),
              error: null,
            }
      ).then(resolve),
  };
  return chain;
}

function householdsChain(): any {
  const chain: any = {
    delete: mock(() => chain),
    in: mock((key: string, values: string[]) => {
      if (key === 'id') {
        deletedIds.push(values);
      }
      return chain;
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) =>
      Promise.resolve({
        data: null,
        error: failures.households ?? null,
      }).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = {
      from: mock((table: string) =>
        table === 'household_members' ? membersChain() : householdsChain()
      ),
    };
    return { supabase: obj, supabaseService: obj };
  });
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: { info: mock(), error: mock(), warn: mock(), debug: mock() },
  }));

  HouseholdRepository = (
    await import(
      '../../../../../src/domains/household/repositories/householdRepository'
    )
  ).HouseholdRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  memberRows = [];
  deletedIds = [];
  failures = {};
  mockSupabaseService.from.mockClear?.();
});

describe('HouseholdRepository.deleteIfMemberless', () => {
  it('deletes a household whose last member row is gone', async () => {
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1'])).toEqual(['h1']);
    expect(deletedIds).toEqual([['h1']]);
  });

  it('SPARES a household where one of two members remains', async () => {
    memberRows = [{ household_id: 'h1', user_id: 'u2', status: 'active' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('SPARES a household whose only surviving row is a removed past member', async () => {
    // The ex-nanny's pay history lives behind this row. Deleting the household
    // cascades it away across 19 tables.
    memberRows = [{ household_id: 'h1', user_id: 'u2', status: 'removed' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('SPARES a household whose only surviving row is a candidate', async () => {
    memberRows = [{ household_id: 'h1', user_id: 'u2', status: 'candidate' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
  });

  it('reaps only the memberless ids out of a mixed batch', async () => {
    memberRows = [{ household_id: 'h2', user_id: 'u2', status: 'removed' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1', 'h2', 'h3'])).toEqual([
      'h1',
      'h3',
    ]);
    expect(deletedIds).toEqual([['h1', 'h3']]);
  });

  it('asks the database nothing for an empty id list', async () => {
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless([])).toEqual([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });

  it('issues no delete when every household still has someone', async () => {
    memberRows = [{ household_id: 'h1', user_id: 'u2', status: 'active' }];
    const repo = new HouseholdRepository();

    await repo.deleteIfMemberless(['h1']);

    expect(deletedIds).toEqual([]);
  });

  it('throws rather than guessing when the membership read fails', async () => {
    failures.household_members = { message: 'boom' };
    const repo = new HouseholdRepository();

    // A failed read is NOT "nobody is left" — that answer deletes households.
    expect(repo.deleteIfMemberless(['h1'])).rejects.toThrow();
    expect(deletedIds).toEqual([]);
  });

  it('throws when the delete itself fails', async () => {
    failures.households = { message: 'boom' };
    const repo = new HouseholdRepository();

    expect(repo.deleteIfMemberless(['h1'])).rejects.toThrow();
  });
});
