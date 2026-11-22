import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { eq } from 'drizzle-orm';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from '../../../../../src/db/schema';
import {
  households,
  payArrangements,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

/**
 * `effectiveOn` is the ONLY place the arrangement-resolution rule lives
 * (migration 041's header, docs/11-MONEY.md §2): greatest `valid_from <= date`,
 * ties broken by `created_at desc`.
 *
 * These tests run against a real Miniflare D1 (tests/helpers/testDb.ts): the
 * filters, ordering and limit are SQLite's own, so a reversed ordering, a
 * missing `valid_from <= date` or an absent tie-break goes red here.
 */

interface FakeRow {
  [key: string]: unknown;
}

let PayArrangementRepository: any;
let t: TestDb;
/** Flip to route the repository at a D1 whose every prepare() throws. */
let broken = false;
const brokenDb = drizzle(
  {
    prepare: () => {
      throw new Error('boom');
    },
  } as unknown as AnyD1Database,
  { schema }
);

function arrangement(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'pa-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    rate_minor: 1500,
    currency: 'GBP',
    valid_from: '2026-01-01',
    created_at: '2026-01-01T09:00:00.000Z',
    carer_display_name: 'Maria',
    ...overrides,
  };
}

/** Replace the table's contents with exactly these rows. */
async function withRows(rows: FakeRow[]): Promise<void> {
  await t.d1.prepare('DELETE FROM pay_arrangements').run();
  if (rows.length) await t.db.insert(payArrangements).values(rows as any);
}

async function stored(id: string): Promise<any> {
  const [found] = await t.db
    .select()
    .from(payArrangements)
    .where(eq(payArrangements.id, id));
  return found;
}

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({
    db: new Proxy(
      {},
      { get: (_target, key) => Reflect.get(broken ? brokenDb : t.db, key) }
    ),
  }));
  for (const id of ['carer-1', 'carer-2']) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
    await t.db.insert(userProfiles).values({ user_id: id });
  }
  await t.db.insert(households).values([
    { id: 'h1', name: 'One' },
    { id: 'h2', name: 'Two' },
  ]);

  PayArrangementRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/payArrangementRepository'
    )
  ).PayArrangementRepository;
});
afterAll(() => t.dispose());

beforeEach(() => {
  broken = false;
});

describe('PayArrangementRepository.effectiveOn — the resolution rule', () => {
  it('returns null when the carer has no arrangements at all', async () => {
    await withRows([]);
    const repo = new PayArrangementRepository();
    expect(await repo.effectiveOn('h1', 'carer-1', '2026-08-04')).toBeNull();
  });

  it('returns the single row whose valid_from is before the date', async () => {
    const row = arrangement({ id: 'pa-old', valid_from: '2026-06-01' });
    await withRows([row]);
    const repo = new PayArrangementRepository();
    expect(await repo.effectiveOn('h1', 'carer-1', '2026-08-04')).toMatchObject(
      row
    );
  });

  it('excludes a row that only takes effect AFTER the date', async () => {
    await withRows([
      arrangement({ id: 'pa-future', valid_from: '2026-09-01' }),
    ]);
    const repo = new PayArrangementRepository();
    expect(await repo.effectiveOn('h1', 'carer-1', '2026-08-04')).toBeNull();
  });

  it('picks the later valid_from when two rows are both in effect', async () => {
    await withRows([
      arrangement({
        id: 'pa-old',
        valid_from: '2026-01-01',
        created_at: '2026-01-01T09:00:00.000Z',
        rate_minor: 1500,
      }),
      arrangement({
        id: 'pa-raise',
        valid_from: '2026-07-01',
        created_at: '2026-06-20T09:00:00.000Z',
        rate_minor: 1700,
      }),
    ]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-raise');
  });

  it('SAME-DAY CORRECTION: the later created_at supersedes the typo it fixes', async () => {
    // The only correction mechanism under append-only + no-future-dates
    // (migration 041 header, review finding 2). Rows deliberately supplied
    // typo-last so a naive "first row wins" implementation cannot pass.
    await withRows([
      arrangement({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:00:00.000Z',
        rate_minor: 150,
      }),
      arrangement({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:05:00.000Z',
        rate_minor: 1500,
      }),
    ]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-fix');
    expect(found?.rate_minor).toBe(1500);
  });

  it('BOUNDARY: valid_from equal to the date is in effect that day', async () => {
    await withRows([arrangement({ id: 'pa-today', valid_from: '2026-08-04' })]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-today');
  });

  it("never crosses into another household's or carer's arrangements", async () => {
    await withRows([
      arrangement({ id: 'pa-mine', valid_from: '2026-01-01' }),
      arrangement({
        id: 'pa-other-household',
        household_id: 'h2',
        valid_from: '2026-08-01',
      }),
      arrangement({
        id: 'pa-other-carer',
        carer_id: 'carer-2',
        valid_from: '2026-08-02',
      }),
    ]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-mine');
  });

  it('orders created_at by INSTANT, not by spelling (GOLDEN-FIXES #25)', async () => {
    // '+01:00' sorts above '.000Z' as text here while being the EARLIER
    // instant (10:00Z vs 10:30Z). A text ORDER BY would pick the typo.
    await withRows([
      arrangement({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T11:00:00+01:00',
      }),
      arrangement({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T10:30:00.000Z',
      }),
    ]);
    const repo = new PayArrangementRepository();
    const found = await repo.effectiveOn('h1', 'carer-1', '2026-08-04');
    expect(found?.id).toBe('pa-fix');
  });

  it('throws a DatabaseError when the query fails', async () => {
    await withRows([]);
    broken = true;
    const repo = new PayArrangementRepository();
    await expect(
      repo.effectiveOn('h1', 'carer-1', '2026-08-04')
    ).rejects.toThrow();
  });
});

describe('PayArrangementRepository.listForCarer', () => {
  it('returns the history newest-first, same tie-break as effectiveOn', async () => {
    await withRows([
      arrangement({
        id: 'pa-first',
        valid_from: '2026-01-01',
        created_at: '2026-01-01T09:00:00.000Z',
      }),
      arrangement({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:00:00.000Z',
      }),
      arrangement({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:05:00.000Z',
      }),
    ]);
    const repo = new PayArrangementRepository();
    const history = await repo.listForCarer('h1', 'carer-1');
    expect(history.map((row: FakeRow) => row.id)).toEqual([
      'pa-fix',
      'pa-typo',
      'pa-first',
    ]);
  });

  it('includes future-dated rows (history is not filtered by date)', async () => {
    // No future-dating exists in v1, but listForCarer must not silently hide a
    // row: the history list is the audit trail, not a resolution query.
    await withRows([arrangement({ id: 'pa-1', valid_from: '2026-12-01' })]);
    const repo = new PayArrangementRepository();
    const history = await repo.listForCarer('h1', 'carer-1');
    expect(history).toHaveLength(1);
  });

  // 065's load-bearing invariant, and the one mistake its header warns against.
  // `endForCarer` ends an arrangement when a member is removed; the engine
  // prices HISTORICAL weeks from this very list (weekEarningsService feeds
  // `listForCarer` into the in-memory resolver). Filter ended rows out HERE and
  // every week worked before the removal silently re-prices to nothing — the
  // per-date exclusion belongs in `effectiveOn`, never in the history read.
  it('includes ENDED rows — a removal must not erase the terms that priced past weeks', async () => {
    await withRows([arrangement({ id: 'pa-ended', valid_to: '2026-06-30' })]);
    const repo = new PayArrangementRepository();
    const history = await repo.listForCarer('h1', 'carer-1');
    expect(history).toHaveLength(1);
  });

  it("scopes to this household's carer only", async () => {
    await withRows([
      arrangement({ id: 'pa-mine' }),
      arrangement({ id: 'pa-theirs', household_id: 'h2' }),
    ]);
    const repo = new PayArrangementRepository();
    const history = await repo.listForCarer('h1', 'carer-1');
    expect(history.map((row: FakeRow) => row.id)).toEqual(['pa-mine']);
  });

  it('returns [] when the carer has no arrangements', async () => {
    await withRows([]);
    const repo = new PayArrangementRepository();
    expect(await repo.listForCarer('h1', 'carer-1')).toEqual([]);
  });

  it('throws a DatabaseError when the query fails', async () => {
    await withRows([]);
    broken = true;
    const repo = new PayArrangementRepository();
    await expect(repo.listForCarer('h1', 'carer-1')).rejects.toThrow();
  });
});

describe('PayArrangementRepository.effectiveOn — ended arrangements (065)', () => {
  // Removal end-dates the arrangement so a rejoined carer has no live terms
  // and a parent must re-confirm them (docs/11-MONEY.md §10).
  it('ignores an arrangement that ended before the date — a rejoined carer has no terms', async () => {
    await withRows([
      arrangement({ valid_from: '2026-01-01', valid_to: '2026-03-31' }),
    ]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-07-01')).toBeNull();
  });

  // THE load-bearing case: a week worked in March must keep pricing at March's
  // rate after a July removal, or every past timesheet re-prices to nothing.
  it('still resolves the arrangement for a date BEFORE the end — history keeps pricing', async () => {
    await withRows([
      arrangement({ valid_from: '2026-01-01', valid_to: '2026-06-30' }),
    ]);
    const repo = new PayArrangementRepository();

    const found = await repo.effectiveOn('h1', 'carer-1', '2026-03-15');

    expect(found).toMatchObject({ id: 'pa-1', rate_minor: 1500 });
  });

  it('resolves the arrangement ON its valid_to — the end is inclusive, so the removal day is paid', async () => {
    await withRows([
      arrangement({ valid_from: '2026-01-01', valid_to: '2026-06-30' }),
    ]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-06-30')).toMatchObject(
      {
        id: 'pa-1',
      }
    );
  });

  it('still resolves a live row — valid_to null is every arrangement that predates 065', async () => {
    await withRows([arrangement({ valid_to: null })]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-07-01')).toMatchObject(
      {
        id: 'pa-1',
      }
    );
  });

  it('picks the live row over an ended one for a current date', async () => {
    await withRows([
      arrangement({
        id: 'pa-old',
        valid_from: '2026-01-01',
        valid_to: '2026-03-31',
      }),
      arrangement({
        id: 'pa-new',
        valid_from: '2026-04-01',
        valid_to: null,
        created_at: '2026-04-01T09:00:00.000Z',
      }),
    ]);
    const repo = new PayArrangementRepository();

    expect(await repo.effectiveOn('h1', 'carer-1', '2026-07-01')).toMatchObject(
      {
        id: 'pa-new',
      }
    );
  });
});

describe('PayArrangementRepository.endForCarer (065)', () => {
  it('end-dates the live arrangement and returns what it ended', async () => {
    const row = arrangement({ valid_to: null });
    await withRows([row]);
    const repo = new PayArrangementRepository();

    const ended = await repo.endForCarer('h1', 'carer-1', '2026-07-01');

    expect((await stored('pa-1')).valid_to).toBe('2026-07-01');
    expect(ended).toHaveLength(1);
    expect(ended[0].valid_to).toBe('2026-07-01');
  });

  it('leaves an ALREADY-ended row alone — the end date must not move on a re-removal', async () => {
    // Remove -> rejoin -> remove again, or a retry: rewriting valid_to would
    // reopen or re-close a window that history has already been priced against.
    const row = arrangement({ valid_to: '2026-03-31' });
    await withRows([row]);
    const repo = new PayArrangementRepository();

    const ended = await repo.endForCarer('h1', 'carer-1', '2026-07-01');

    expect((await stored('pa-1')).valid_to).toBe('2026-03-31');
    expect(ended).toHaveLength(0);
  });

  it('scopes the write to this household and carer, and only to live rows', async () => {
    await withRows([
      arrangement({ id: 'mine', valid_to: null }),
      arrangement({ id: 'other-household', household_id: 'h2' }),
      arrangement({ id: 'other-carer', carer_id: 'carer-2' }),
      arrangement({ id: 'future', valid_from: '2026-09-01' }),
    ]);
    const repo = new PayArrangementRepository();

    const ended = await repo.endForCarer('h1', 'carer-1', '2026-07-01');

    expect(ended.map((r: FakeRow) => r.id)).toEqual(['mine']);
    for (const id of ['other-household', 'other-carer', 'future']) {
      expect((await stored(id)).valid_to).toBeNull();
    }
  });

  it('throws a DatabaseError when the write fails', async () => {
    await withRows([arrangement({ valid_to: null })]);
    broken = true;
    const repo = new PayArrangementRepository();
    await expect(
      repo.endForCarer('h1', 'carer-1', '2026-07-01')
    ).rejects.toThrow('Failed to end pay arrangements for carer');
  });
});

/**
 * 033/058: a departed carer's `pay_arrangements` rows keep `carer_id = null`,
 * so `listForCarer` — the only history read the routes had — can never reach
 * the terms she actually worked under. This is the household-scoped read.
 */
describe('PayArrangementRepository.listForHousehold', () => {
  it('returns every carer’s history, including a departed carer’s', async () => {
    await withRows([
      arrangement({
        id: 'live',
        carer_id: 'carer-1',
        valid_from: '2026-01-01',
      }),
      arrangement({
        id: 'departed',
        carer_id: null,
        household_member_id: 'hm-2',
        valid_from: '2026-03-01',
      }),
    ]);
    const repo = new PayArrangementRepository();

    const rows = await repo.listForHousehold('h1');

    // Newest first, same ordering keys as `listForCarer`.
    expect(rows.map((r: FakeRow) => r.id)).toEqual(['departed', 'live']);
  });

  it('never filters carer_id — that is the whole point', async () => {
    await withRows([
      arrangement({ id: 'carer-1-row' }),
      arrangement({ id: 'carer-2-row', carer_id: 'carer-2' }),
    ]);
    const repo = new PayArrangementRepository();

    const rows = await repo.listForHousehold('h1');

    expect(rows.map((r: FakeRow) => r.id).sort()).toEqual([
      'carer-1-row',
      'carer-2-row',
    ]);
  });

  it('still scopes to ONE household', async () => {
    await withRows([
      arrangement({ id: 'mine' }),
      arrangement({ id: 'theirs', household_id: 'h2' }),
    ]);
    const repo = new PayArrangementRepository();

    expect(
      (await repo.listForHousehold('h1')).map((r: FakeRow) => r.id)
    ).toEqual(['mine']);
  });

  it('throws a DatabaseError when the query fails', async () => {
    await withRows([arrangement()]);
    broken = true;
    const repo = new PayArrangementRepository();
    await expect(repo.listForHousehold('h1')).rejects.toThrow(
      'Failed to list pay arrangements for household'
    );
  });
});
