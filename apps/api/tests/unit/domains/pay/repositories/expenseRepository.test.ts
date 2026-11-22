/**
 * ExpenseRepository against a real Miniflare D1 (tests/helpers/testDb.ts).
 *
 * The guarded writes run as real SQL: the owner+pending CAS on edit and
 * withdraw, the `expenses_one_pending_claim_idx` dedupe, and `reviewPending`
 * — the D1 replacement for `review_pending_expense` (051, MIGRATION-NOTES
 * §5.4), whose week-freeze guard is a `NOT EXISTS (approved timesheet)` in
 * the expense UPDATE itself, batched with a gated `updated_at` bump of that
 * week's timesheet.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from '../../../../../src/db/schema';
import {
  expenses,
  households,
  timesheets,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import { DuplicatePendingClaimError } from '../../../../../src/domains/pay/errors/payErrors';
import { DatabaseError } from '../../../../../src/errors';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let repo: InstanceType<
  typeof import('../../../../../src/domains/pay/repositories/expenseRepository').ExpenseRepository
>;
let broken = false;
const brokenDb = drizzle(
  {
    prepare: () => {
      throw new Error('boom');
    },
  } as unknown as AnyD1Database,
  { schema }
);

const H1 = 'h1';
const H2 = 'h2';
const PARENT = 'parent-1';
const CARER = 'carer-1';
const CARER2 = 'carer-2';
const PAST = '2026-01-01T00:00:00.000Z';
const REVIEWED_AT = '2026-08-12T10:00:00.000Z';

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({
    db: new Proxy(
      {},
      { get: (_t, key) => Reflect.get(broken ? brokenDb : t.db, key) }
    ),
  }));
  for (const id of [PARENT, CARER, CARER2]) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
    await t.db.insert(userProfiles).values({ user_id: id });
  }
  await t.db.insert(households).values([
    { id: H1, name: 'One' },
    { id: H2, name: 'Two' },
  ]);
  const { ExpenseRepository } = await import(
    '../../../../../src/domains/pay/repositories/expenseRepository'
  );
  repo = new ExpenseRepository();
});
afterAll(() => t.dispose());

let seq = 0;
async function claim(
  overrides: Partial<typeof expenses.$inferInsert> = {}
): Promise<string> {
  const [row] = await t.db
    .insert(expenses)
    .values({
      household_id: H1,
      carer_id: CARER,
      local_date: '2026-08-11',
      kind: 'expense',
      description: `Snacks ${seq++}`,
      amount_minor: 1200,
      currency: 'GBP',
      carer_display_name: 'Carer',
      household_member_id: 'member-1',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row.id;
}

async function read(id: string) {
  const [row] = await t.db.select().from(expenses).where(eq(expenses.id, id));
  return row;
}

let weekSeq = 0;
async function weekTimesheet(status: 'submitted' | 'approved') {
  const week_start = new Date(Date.UTC(2024, 0, 1 + 7 * weekSeq++))
    .toISOString()
    .slice(0, 10);
  const snapshot =
    status === 'approved'
      ? {
          approved_by: PARENT,
          approved_at: PAST,
          gross_minor: 1,
          currency: 'GBP',
          earnings: { status: 'ok' },
          earnings_computed_at: PAST,
        }
      : {};
  const [row] = await t.db
    .insert(timesheets)
    .values({
      household_id: H1,
      carer_id: CARER,
      carer_display_name: 'Carer',
      week_start,
      status,
      household_member_id: 'member-1',
      updated_at: PAST,
      ...snapshot,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row;
}

const approve = (extra: { amount_minor?: number } = {}) => ({
  status: 'approved' as const,
  reviewed_by: PARENT,
  reviewed_at: REVIEWED_AT,
  review_note: null,
  ...extra,
});

describe('ExpenseRepository reads', () => {
  it('listForWeek: this household, [start, endExclusive), every status, keeps household_member_id', async () => {
    const inWeek = await claim({ household_id: H2, local_date: '2026-03-02' });
    const reviewed = await claim({
      household_id: H2,
      local_date: '2026-03-08',
      status: 'rejected',
    });
    await claim({ household_id: H2, local_date: '2026-03-09' });
    await claim({ household_id: H1, local_date: '2026-03-03' });
    const rows = await repo.listForWeek(H2, '2026-03-02', '2026-03-09');
    expect(rows.map(r => r.id)).toEqual([inWeek, reviewed]);
    expect(rows[0]?.household_member_id).toBe('member-1');
  });

  it('listPending / listApprovedForWeek / listApprovedForHousehold scope by status', async () => {
    const p = await claim({ household_id: H2, local_date: '2026-04-06' });
    const a = await claim({
      household_id: H2,
      local_date: '2026-04-07',
      status: 'approved',
    });
    const pending = (await repo.listPending(H2)).map(r => r.id);
    expect(pending).toContain(p);
    expect(pending).not.toContain(a);
    expect(
      (await repo.listApprovedForWeek(H2, '2026-04-06', '2026-04-13')).map(
        r => r.id
      )
    ).toEqual([a]);
    expect((await repo.listApprovedForHousehold(H2)).map(r => r.id)).toContain(
      a
    );
  });

  it('wraps a failing query in a DatabaseError', async () => {
    broken = true;
    try {
      await expect(repo.listPending(H1)).rejects.toBeInstanceOf(DatabaseError);
    } finally {
      broken = false;
    }
  });
});

describe('ExpenseRepository.create — pending-claim dedupe', () => {
  const fresh = {
    household_id: H1,
    carer_id: CARER,
    local_date: '2026-05-04',
    kind: 'expense' as const,
    description: 'Museum',
    amount_minor: 900,
    currency: 'GBP',
    carer_display_name: 'Carer',
  };

  it('inserts the claim, then refuses the identical double-tap as DuplicatePendingClaimError', async () => {
    const row = await repo.create(fresh);
    expect(row).toMatchObject({ ...fresh, status: 'pending' });
    await expect(repo.create(fresh)).rejects.toBeInstanceOf(
      DuplicatePendingClaimError
    );
  });

  it('leaves any other failure (a CHECK) as a DatabaseError', async () => {
    const err = await repo
      .create({ ...fresh, description: 'bad', currency: 'gbp' })
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err).not.toBeInstanceOf(DuplicatePendingClaimError);
  });
});

describe('ExpenseRepository.updateOwnedPending / deleteOwnedPending', () => {
  it('updates the caller’s own pending row, and nobody else’s', async () => {
    const id = await claim();
    expect(
      await repo.updateOwnedPending(id, H1, CARER2, { description: 'x' })
    ).toBeNull();
    expect(
      await repo.updateOwnedPending(id, H2, CARER, { description: 'x' })
    ).toBeNull();
    const row = await repo.updateOwnedPending(id, H1, CARER, {
      description: 'Lunch',
    });
    expect(row?.description).toBe('Lunch');
  });

  it('returns null once the row is reviewed', async () => {
    const id = await claim({ status: 'rejected' });
    expect(
      await repo.updateOwnedPending(id, H1, CARER, { description: 'x' })
    ).toBeNull();
  });

  it('deletes only the owner’s pending row', async () => {
    const id = await claim();
    const reviewed = await claim({ status: 'approved' });
    expect(await repo.deleteOwnedPending(id, H1, CARER2)).toBe(false);
    expect(await repo.deleteOwnedPending(reviewed, H1, CARER)).toBe(false);
    expect(await repo.deleteOwnedPending(id, H1, CARER)).toBe(true);
    expect(await read(id)).toBeUndefined();
    expect(await read(reviewed)).toBeDefined();
  });
});

describe('ExpenseRepository.reviewPending (review_pending_expense)', () => {
  it('reviews a pending row in this household', async () => {
    const id = await claim();
    const out = await repo.reviewPending(id, H1, approve(), null);
    expect(out.outcome).toBe('reviewed');
    if (out.outcome !== 'reviewed') throw new Error('unreachable');
    expect(out.expense).toMatchObject({
      id,
      status: 'approved',
      reviewed_by: PARENT,
      reviewed_at: REVIEWED_AT,
      amount_minor: 1200,
    });
  });

  it('freezes a mileage amount in the same write, and leaves it alone when absent', async () => {
    const id = await claim({ kind: 'mileage', amount_minor: null, miles: 12 });
    const out = await repo.reviewPending(
      id,
      H1,
      approve({ amount_minor: 540 }),
      null
    );
    expect(out.outcome).toBe('reviewed');
    expect((await read(id))?.amount_minor).toBe(540);
  });

  it('answers not_pending for an already-reviewed row or another household', async () => {
    const id = await claim({ status: 'rejected' });
    expect(await repo.reviewPending(id, H1, approve(), null)).toEqual({
      outcome: 'not_pending',
    });
    const other = await claim();
    expect(await repo.reviewPending(other, H2, approve(), null)).toEqual({
      outcome: 'not_pending',
    });
    expect((await read(other))?.status).toBe('pending');
  });

  it('refuses when the locked week is already approved, writing nothing', async () => {
    const ts = await weekTimesheet('approved');
    const id = await claim();
    expect(
      await repo.reviewPending(id, H1, approve(), {
        carerId: CARER,
        weekStart: ts.week_start,
      })
    ).toEqual({
      outcome: 'week_locked',
      weekStart: ts.week_start,
      timesheetStatus: 'approved',
    });
    expect((await read(id))?.status).toBe('pending');
  });

  it('BUMPS the unfrozen week’s timesheet updated_at so an in-flight approve’s CAS loses', async () => {
    const ts = await weekTimesheet('submitted');
    const id = await claim();
    const out = await repo.reviewPending(id, H1, approve(), {
      carerId: CARER,
      weekStart: ts.week_start,
    });
    expect(out.outcome).toBe('reviewed');
    const [after] = await t.db
      .select()
      .from(timesheets)
      .where(eq(timesheets.id, ts.id));
    expect(after?.updated_at).not.toBe(PAST);
  });

  it('a lost review does NOT bump the week (the bump is gated on the review)', async () => {
    const ts = await weekTimesheet('submitted');
    const id = await claim({ status: 'rejected' });
    expect(
      (
        await repo.reviewPending(id, H1, approve(), {
          carerId: CARER,
          weekStart: ts.week_start,
        })
      ).outcome
    ).toBe('not_pending');
    const [after] = await t.db
      .select()
      .from(timesheets)
      .where(eq(timesheets.id, ts.id));
    expect(after?.updated_at).toBe(PAST);
  });

  it('a week with no timesheet at all reviews normally', async () => {
    const id = await claim();
    expect(
      (
        await repo.reviewPending(id, H1, approve(), {
          carerId: CARER,
          weekStart: '1999-01-04',
        })
      ).outcome
    ).toBe('reviewed');
  });

  it('RACE: two parents reviewing at once — exactly one lands', async () => {
    const id = await claim();
    const results = await Promise.all([
      repo.reviewPending(id, H1, approve(), null),
      repo.reviewPending(
        id,
        H1,
        { ...approve(), status: 'rejected', review_note: 'no' },
        null
      ),
    ]);
    expect(results.map(r => r.outcome).sort()).toEqual([
      'not_pending',
      'reviewed',
    ]);
  });
});
