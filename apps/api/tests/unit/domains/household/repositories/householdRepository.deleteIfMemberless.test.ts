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
/**
 * Rows the fake payroll tables hold, per table — the guard's evidence that a
 * memberless household is not actually garbage.
 */
let payrollRows: Record<string, Row[]> = {
  time_entries: [],
  timesheets: [],
  shifts: [],
};
/** Every `households` delete the fake saw, as the id list it was given. */
let deletedIds: string[][] = [];
/** Forced errors, per table. */
let failures: Record<string, { message: string } | null> = {};

const PAYROLL_TABLES = ['time_entries', 'timesheets', 'shifts'] as const;

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

function payrollChain(table: string): any {
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
        failures[table]
          ? { data: null, error: failures[table] }
          : {
              data: (payrollRows[table] ?? [])
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
      from: mock((table: string) => {
        if (table === 'household_members') {
          return membersChain();
        }
        if ((PAYROLL_TABLES as readonly string[]).includes(table)) {
          return payrollChain(table);
        }
        return householdsChain();
      }),
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
  payrollRows = { time_entries: [], timesheets: [], shifts: [] };
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

describe('HouseholdRepository.deleteIfMemberless — payroll history guard', () => {
  // A household with nobody left in it is not garbage if it is still holding
  // somebody's evidence of hours worked. Migration 033 exists so this evidence
  // survives a carer's own account deletion; the reaper must not undo that.
  it('SPARES a memberless household that still has time_entries', async () => {
    payrollRows.time_entries = [{ household_id: 'h1' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('SPARES a memberless household that still has timesheets', async () => {
    payrollRows.timesheets = [{ household_id: 'h1' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('SPARES a memberless household that still has shifts', async () => {
    payrollRows.shifts = [{ household_id: 'h1' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('reaps only the memberless households with no payroll history of any kind', async () => {
    // h1: memberless, has time_entries -> spared.
    // h2: memberless, no payroll rows -> reaped.
    // h3: still has a member -> spared (unrelated to this guard).
    payrollRows.time_entries = [{ household_id: 'h1' }];
    memberRows = [{ household_id: 'h3', user_id: 'u2', status: 'active' }];
    const repo = new HouseholdRepository();

    expect(await repo.deleteIfMemberless(['h1', 'h2', 'h3'])).toEqual(['h2']);
    expect(deletedIds).toEqual([['h2']]);
  });

  it('throws rather than guessing when a payroll-table read fails', async () => {
    failures.time_entries = { message: 'boom' };
    const repo = new HouseholdRepository();

    expect(repo.deleteIfMemberless(['h1'])).rejects.toThrow();
    expect(deletedIds).toEqual([]);
  });
});
