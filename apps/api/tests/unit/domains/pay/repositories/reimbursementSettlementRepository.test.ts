/**
 * @module tests/unit/domains/pay/repositories/reimbursementSettlementRepository
 *
 * The ONE thing this repository does that `BaseRepository` does not: translate
 * the unique violation raised by `reimbursement_settlements_week_idx`
 * (migration 086) into the typed `AlreadySettledError` — the same shape
 * `expenseRepository.create` uses for 051's partial index.
 *
 * Runs against a real Miniflare D1 (tests/helpers/testDb.ts), so the
 * `household_id` filter and the unique index are the database's own: a
 * `listForWeek` that forgot its household filter reads across households
 * (docs/11-MONEY.md §8/§9) and goes red here.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from '../../../../../src/db/schema';
import {
  households,
  reimbursementSettlements,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

interface FakeRow {
  [key: string]: unknown;
}

let ReimbursementSettlementRepository: any;
let AlreadySettledError: any;
let DatabaseError: any;
let t: TestDb;
/** Flip to route the repository at a D1 whose every prepare() throws. */
let broken = false;
/** Counts every touch of the `db` handle. */
let dbAccesses = 0;
const brokenDb = drizzle(
  {
    prepare: () => {
      throw new Error('boom');
    },
  } as unknown as AnyD1Database,
  { schema }
);

function settlement(overrides: FakeRow = {}): FakeRow {
  return {
    household_id: 'h1',
    carer_id: 'carer-1',
    week_start: '2026-08-03',
    amount_minor: 14_600,
    currency: 'GBP',
    settled_at: '2026-08-10',
    note: null,
    recorded_by: 'parent-1',
    ...overrides,
  };
}

async function withRows(rows: FakeRow[]): Promise<void> {
  await t.d1.prepare('DELETE FROM reimbursement_settlements').run();
  if (rows.length)
    await t.db.insert(reimbursementSettlements).values(rows as any);
}

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({
    db: new Proxy(
      {},
      {
        get: (_target, key) => {
          dbAccesses++;
          return Reflect.get(broken ? brokenDb : t.db, key);
        },
      }
    ),
  }));
  for (const id of ['carer-1', 'carer-2', 'parent-1']) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
    await t.db.insert(userProfiles).values({ user_id: id });
  }
  await t.db.insert(households).values([
    { id: 'h1', name: 'One' },
    { id: 'h2', name: 'Two' },
  ]);

  ReimbursementSettlementRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/reimbursementSettlementRepository'
    )
  ).ReimbursementSettlementRepository;
  AlreadySettledError = (
    await import('../../../../../src/domains/pay/errors/payErrors')
  ).AlreadySettledError;
  DatabaseError = (await import('../../../../../src/errors')).DatabaseError;
});
afterAll(() => t.dispose());

beforeEach(async () => {
  broken = false;
  await withRows([]);
});

describe('ReimbursementSettlementRepository.listForWeek', () => {
  it('filters by household_id AND the exact week_start', async () => {
    await withRows([
      settlement({ id: 'mine' }),
      settlement({ id: 'other-week', week_start: '2026-07-27' }),
      settlement({ id: 'other-household', household_id: 'h2' }),
    ]);
    const repo = new ReimbursementSettlementRepository();

    const rows = await repo.listForWeek('h1', '2026-08-03');

    expect(rows.map((row: FakeRow) => row.id)).toEqual(['mine']);
  });

  it('a query error becomes a DatabaseError, never a silent empty list', async () => {
    broken = true;
    const repo = new ReimbursementSettlementRepository();

    await expect(repo.listForWeek('h1', '2026-08-03')).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

describe('ReimbursementSettlementRepository.listForHousehold', () => {
  it('scopes to the household, newest week first, then created_at ascending', async () => {
    await withRows([
      settlement({ id: 'old-week', week_start: '2026-07-27' }),
      settlement({
        id: 'new-week-second',
        carer_id: 'carer-2',
        created_at: '2026-08-10T10:00:00.000Z',
      }),
      settlement({
        id: 'new-week-first',
        created_at: '2026-08-10T09:00:00.000Z',
      }),
      settlement({ id: 'other-household', household_id: 'h2' }),
    ]);
    const rows = await new ReimbursementSettlementRepository().listForHousehold(
      'h1'
    );
    expect(rows.map((row: FakeRow) => row.id)).toEqual([
      'new-week-first',
      'new-week-second',
      'old-week',
    ]);
  });
});

describe('ReimbursementSettlementRepository.create', () => {
  it('returns the inserted row', async () => {
    const repo = new ReimbursementSettlementRepository();

    const created = await repo.create(settlement());

    expect(created.amount_minor).toBe(14_600);
    expect(created.id).toBeString();
  });

  it('a second settlement for the same carer-week hits the real index → AlreadySettledError', async () => {
    const repo = new ReimbursementSettlementRepository();
    await repo.create(settlement());

    const thrown = await repo
      .create(settlement({ amount_minor: 1 }))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AlreadySettledError);
    expect(thrown.metadata).toMatchObject({
      householdId: 'h1',
      carerId: 'carer-1',
      weekStart: '2026-08-03',
    });
  });

  it('any other insert error stays a DatabaseError', async () => {
    const repo = new ReimbursementSettlementRepository();

    const thrown = await repo
      .create(settlement({ amount_minor: 0 }))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DatabaseError);
    expect(thrown).not.toBeInstanceOf(AlreadySettledError);
  });
});

/**
 * Append-only, structurally (`docs/AS-BUILT-PAYMENT.md` §7 P8).
 *
 * This used to be a source-text assertion that the file contained no
 * `async update` / `async delete`, which proved the opposite of what it
 * looked like: BOTH were inherited from `BaseRepository`, callable, and run
 * as service role where RLS cannot stop them. Absence in this file was
 * absence of a guard, not absence of a path. The methods now exist here
 * precisely so they can refuse.
 */
describe('append-only', () => {
  it('refuses update — 086 gives this table no correction path at all', async () => {
    await expect(
      new ReimbursementSettlementRepository().update('rs-1', {
        amount_minor: 1,
      })
    ).rejects.toThrow('reimbursement_settlements is append-only');
  });

  it('refuses delete', async () => {
    await expect(
      new ReimbursementSettlementRepository().delete('rs-1')
    ).rejects.toThrow('reimbursement_settlements is append-only');
  });

  it('never reaches the database to find that out', async () => {
    dbAccesses = 0;
    await new ReimbursementSettlementRepository()
      .update('rs-1', {})
      .catch(() => undefined);
    await new ReimbursementSettlementRepository()
      .delete('rs-1')
      .catch(() => undefined);
    expect(dbAccesses).toBe(0);
  });
});
