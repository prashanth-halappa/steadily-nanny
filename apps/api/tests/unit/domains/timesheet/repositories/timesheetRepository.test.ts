/**
 * TimesheetRepository against a real Miniflare D1 (tests/helpers/testDb.ts):
 * the compare-and-set writes, the roll-up's paid/unpaid CASE statement
 * (MIGRATION-NOTES §5.3), the reopen trigger's TIMESHEET_HAS_PAYMENTS, and the
 * parent-viewed receipt. Also carries the intent of the Postgres-only
 * integration tests previousApproval / reopenWithPayments /
 * timesheetParentViewed, which can now run in-process.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  households,
  payments,
  timesheets,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import { DatabaseError } from '../../../../../src/errors';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let TimesheetRepository: typeof import('../../../../../src/domains/timesheet/repositories/timesheetRepository').TimesheetRepository;
let CLEARED_EARNINGS_SNAPSHOT: typeof import('../../../../../src/domains/timesheet/repositories/timesheetRepository').CLEARED_EARNINGS_SNAPSHOT;

const H1 = 'h1';
const H2 = 'h2';
const PARENT = 'parent-1';
const CARER = 'carer-1';
const CARER2 = 'carer-2';
/** Seeded explicitly so the trigger's "now" can never collide with it. */
const PAST = '2026-01-01T00:00:00.000Z';
const FROZEN_AT = '2026-08-10T18:00:00.000Z';
const GROSS = 80_000;
const WORKED = 2460;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const mod = await import(
    '../../../../../src/domains/timesheet/repositories/timesheetRepository'
  );
  TimesheetRepository = mod.TimesheetRepository;
  CLEARED_EARNINGS_SNAPSHOT = mod.CLEARED_EARNINGS_SNAPSHOT;

  for (const id of [PARENT, CARER, CARER2]) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
    await t.db.insert(userProfiles).values({ user_id: id });
  }
  await t.db.insert(households).values([
    { id: H1, name: 'One' },
    { id: H2, name: 'Two' },
  ]);
});
afterAll(() => t.dispose());

let weekSeq = 0;
/** A unique Monday per call, so tests never share a (household, carer, week). */
function nextWeek(): string {
  const d = new Date(Date.UTC(2025, 0, 6 + 7 * weekSeq++));
  return d.toISOString().slice(0, 10);
}

type Insert = typeof timesheets.$inferInsert;

async function seed(overrides: Partial<Insert> = {}): Promise<string> {
  const [row] = await t.db
    .insert(timesheets)
    .values({
      household_id: H1,
      carer_id: CARER,
      carer_display_name: 'Carer',
      week_start: nextWeek(),
      total_minutes: WORKED,
      status: 'submitted',
      // Non-null, so the AFTER INSERT member stamp (which would also re-stamp
      // updated_at) does not fire and PAST survives.
      household_member_id: 'member-1',
      updated_at: PAST,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row.id;
}

const approved = (earnings: Record<string, unknown> | null = null) =>
  ({
    status: 'approved',
    approved_by: PARENT,
    approved_at: FROZEN_AT,
    gross_minor: GROSS,
    currency: 'GBP',
    earnings: earnings ?? {
      status: 'ok',
      gross_minor: GROSS,
      worked_minutes: WORKED,
    },
    earnings_computed_at: FROZEN_AT,
  }) satisfies Partial<Insert>;

async function read(id: string) {
  const [row] = await t.db
    .select()
    .from(timesheets)
    .where(eq(timesheets.id, id));
  if (!row) throw new Error(`no timesheet ${id}`);
  return row;
}

async function pay(timesheetId: string) {
  await t.db.insert(payments).values({
    timesheet_id: timesheetId,
    household_id: H1,
    carer_id: CARER,
    amount_minor: GROSS,
    currency: 'GBP',
    paid_at: '2026-08-14',
    recorded_by: PARENT,
  });
}

const snapshotPatch = {
  approved_by: PARENT,
  approved_at: FROZEN_AT,
  gross_minor: 14_800,
  currency: 'GBP',
  earnings: { status: 'ok', gross_minor: 14_800 },
  earnings_computed_at: FROZEN_AT,
};

describe('findByWeek', () => {
  it('returns the timesheet for (household, carer, week), or null', async () => {
    const week = nextWeek();
    const id = await seed({ week_start: week });
    const repo = new TimesheetRepository();
    expect((await repo.findByWeek(H1, CARER, week))?.id).toBe(id);
    expect(await repo.findByWeek(H1, CARER2, week)).toBeNull();
    expect(await repo.findByWeek(H1, CARER, '1999-01-04')).toBeNull();
  });
});

describe('listForHousehold', () => {
  it('lists most recent week first, keeps every column, optional carer filter (F-B1-3)', async () => {
    const a = await seed({ household_id: H2, week_start: '2026-03-02' });
    const b = await seed({ household_id: H2, week_start: '2026-03-09' });
    const c = await seed({
      household_id: H2,
      carer_id: CARER2,
      week_start: '2026-03-09',
    });
    const repo = new TimesheetRepository();

    const all = await repo.listForHousehold(H2);
    expect(all.map(r => r.id).sort()).toEqual([a, b, c].sort());
    expect(all[all.length - 1]?.id).toBe(a);
    expect(all[0]).toMatchObject({ household_member_id: 'member-1' });
    expect(Object.keys(all[0] ?? {})).toContain('previous_approval');

    const one = await repo.listForHousehold(H2, CARER);
    expect(one.map(r => r.id)).toEqual([b, a]);
  });

  it('returns [] for a household with no weeks', async () => {
    expect(await new TimesheetRepository().listForHousehold('nope')).toEqual(
      []
    );
  });
});

describe('recentApprovedGross', () => {
  it('returns approved gross before the week, most recent first, limited', async () => {
    await seed({ week_start: '2024-01-01', ...approved(), gross_minor: 100 });
    await seed({ week_start: '2024-01-08', ...approved(), gross_minor: 200 });
    await seed({ week_start: '2024-01-15', ...approved(), gross_minor: 300 });
    await seed({ week_start: '2024-01-22', status: 'submitted' });
    await seed({ week_start: '2024-01-29', ...approved(), gross_minor: 999 });
    await seed({
      week_start: '2024-01-15',
      carer_id: CARER2,
      ...approved(),
      gross_minor: 777,
    });
    const repo = new TimesheetRepository();
    expect(await repo.recentApprovedGross(H1, CARER, '2024-01-29', 2)).toEqual([
      300, 200,
    ]);
    expect(await repo.recentApprovedGross(H1, CARER, '2023-01-02', 4)).toEqual(
      []
    );
  });
});

describe('approveSubmittedWithEarnings', () => {
  it('sets status and all four snapshot columns, clearing the display-state columns', async () => {
    const id = await seed({
      query_note: 'q',
      reopen_reason: 'r',
      hours_changed_after_payment_at: FROZEN_AT,
      previous_approval: { gross_minor: 1 },
    });
    const row = await new TimesheetRepository().approveSubmittedWithEarnings(
      id,
      snapshotPatch,
      PAST
    );
    expect(row).toMatchObject({
      status: 'approved',
      gross_minor: 14_800,
      currency: 'GBP',
      earnings: { status: 'ok', gross_minor: 14_800 },
      earnings_computed_at: FROZEN_AT,
      approved_by: PARENT,
      approved_at: FROZEN_AT,
      query_note: null,
      reopen_reason: null,
      hours_changed_after_payment_at: null,
      previous_approval: null,
    });
  });

  it('returns null when the status is not submitted (status arm of the CAS)', async () => {
    const id = await seed({ status: 'queried' });
    expect(
      await new TimesheetRepository().approveSubmittedWithEarnings(
        id,
        snapshotPatch,
        PAST
      )
    ).toBeNull();
    expect((await read(id)).status).toBe('queried');
  });

  it('returns null when the row version moved (a roll-up landed in between)', async () => {
    const id = await seed();
    const repo = new TimesheetRepository();
    await repo.rollUpHours(id, 3000);
    expect(
      await repo.approveSubmittedWithEarnings(id, snapshotPatch, PAST)
    ).toBeNull();
    expect((await read(id)).status).toBe('submitted');
  });

  it('raises a DatabaseError rather than returning a half-written row', async () => {
    const id = await seed();
    const err = await new TimesheetRepository()
      .approveSubmittedWithEarnings(
        id,
        { ...snapshotPatch, currency: 'gbp' },
        PAST
      )
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
    expect((await read(id)).status).toBe('submitted');
  });
});

describe('queryFromActionable', () => {
  for (const from of ['submitted', 'queried'] as const) {
    it(`moves ${from} → queried with the note`, async () => {
      const id = await seed({ status: from });
      const row = await new TimesheetRepository().queryFromActionable(
        id,
        PAST,
        'why?'
      );
      expect(row).toMatchObject({ status: 'queried', query_note: 'why?' });
    });
  }

  it('returns null on an approved week or a moved version', async () => {
    const repo = new TimesheetRepository();
    const a = await seed(approved());
    expect(await repo.queryFromActionable(a, PAST, 'x')).toBeNull();
    const b = await seed();
    expect(
      await repo.queryFromActionable(b, '2020-01-01T00:00:00.000Z', 'x')
    ).toBeNull();
  });
});

describe('withdrawQueryFromQueried', () => {
  it('returns the week to submitted and clears the note, approval untouched', async () => {
    const id = await seed({ status: 'queried', query_note: 'q' });
    const row = await new TimesheetRepository().withdrawQueryFromQueried(
      id,
      PAST
    );
    expect(row).toMatchObject({
      status: 'submitted',
      query_note: null,
      approved_by: null,
      approved_at: null,
    });
  });

  it('returns null when not queried or the version moved', async () => {
    const repo = new TimesheetRepository();
    expect(await repo.withdrawQueryFromQueried(await seed(), PAST)).toBeNull();
    const q = await seed({ status: 'queried' });
    expect(
      await repo.withdrawQueryFromQueried(q, '2020-01-01T00:00:00.000Z')
    ).toBeNull();
  });
});

describe('reopenFromApproved', () => {
  it('clears the snapshot and approval in the same write and leaves a receipt (111)', async () => {
    const id = await seed({ ...approved(), query_note: 'still asking' });
    const row = await new TimesheetRepository().reopenFromApproved(
      id,
      PAST,
      'wrong hours'
    );
    expect(row).toMatchObject({
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      reopen_reason: 'wrong hours',
      query_note: 'still asking',
      ...CLEARED_EARNINGS_SNAPSHOT,
      previous_approval: {
        approved_at: FROZEN_AT,
        approved_by: PARENT,
        gross_minor: GROSS,
        currency: 'GBP',
        worked_minutes: WORKED,
      },
    });
  });

  it('leaves worked_minutes null when the snapshot has no such key', async () => {
    const id = await seed(approved({ status: 'no_arrangement' }));
    const row = await new TimesheetRepository().reopenFromApproved(
      id,
      PAST,
      'r'
    );
    expect(row?.previous_approval).toMatchObject({
      gross_minor: GROSS,
      worked_minutes: null,
    });
  });

  it('writes no receipt when the pre-read row is not approved, or the pre-read fails', async () => {
    for (const findById of [
      async () => ({ status: 'submitted' }),
      async () => {
        throw new Error('read failed');
      },
    ]) {
      const id = await seed(approved());
      const repo = new TimesheetRepository();
      Object.assign(repo, { findById });
      const row = await repo.reopenFromApproved(id, PAST, 'r');
      expect(row).toMatchObject({
        status: 'submitted',
        previous_approval: null,
      });
    }
  });

  it('returns null when the week is not approved or the version moved', async () => {
    const repo = new TimesheetRepository();
    expect(await repo.reopenFromApproved(await seed(), PAST, 'r')).toBeNull();
    const a = await seed(approved());
    expect(
      await repo.reopenFromApproved(a, '2020-01-01T00:00:00.000Z', 'r')
    ).toBeNull();
    expect((await read(a)).status).toBe('approved');
  });

  it('a week with payments is refused by the trigger: DatabaseError carrying TIMESHEET_HAS_PAYMENTS', async () => {
    const id = await seed(approved());
    await pay(id);
    const err = await new TimesheetRepository()
      .reopenFromApproved(id, PAST, 'r')
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
    expect((err as DatabaseError).metadata).toMatchObject({
      code: 'TIMESHEET_HAS_PAYMENTS',
    });
    const after = await read(id);
    expect(after).toMatchObject({ status: 'approved', gross_minor: GROSS });
    expect(after.updated_at).toBe(PAST);
  });
});

describe('timesheets_refuse_reopen_when_paid (reopenWithPayments)', () => {
  it('lets a paid week take an edit that leaves status alone', async () => {
    const id = await seed(approved());
    await pay(id);
    await t.db
      .update(timesheets)
      .set({ carer_display_name: 'Renamed' })
      .where(eq(timesheets.id, id));
    expect((await read(id)).carer_display_name).toBe('Renamed');
  });
});

describe('rollUpHours — a PAID week', () => {
  it('records minutes, keeps status/approver/snapshot, raises the flag, no receipt', async () => {
    const id = await seed(approved());
    await pay(id);
    const before = await read(id);

    const row = await new TimesheetRepository().rollUpHours(id, 2700);
    expect(row).toMatchObject({
      total_minutes: 2700,
      status: 'approved',
      approved_by: PARENT,
      approved_at: FROZEN_AT,
      gross_minor: GROSS,
      currency: 'GBP',
      earnings: before.earnings,
      earnings_computed_at: FROZEN_AT,
      previous_approval: null,
    });
    expect(row.hours_changed_after_payment_at).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
    );
    // A real row version — approve's CAS depends on it moving.
    expect((await read(id)).updated_at).not.toBe(PAST);
  });

  it('never trips the reopen trigger on a repeat', async () => {
    const id = await seed(approved());
    await pay(id);
    const repo = new TimesheetRepository();
    await repo.rollUpHours(id, 2700);
    expect((await repo.rollUpHours(id, 2760)).total_minutes).toBe(2760);
  });
});

describe('rollUpHours — an UNPAID week', () => {
  it('demotes, clears approval + snapshot + flag, and copies the receipt from the OLD row', async () => {
    const id = await seed({
      ...approved(),
      hours_changed_after_payment_at: FROZEN_AT,
    });
    const row = await new TimesheetRepository().rollUpHours(id, 2940);
    expect(row).toMatchObject({
      total_minutes: 2940,
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      ...CLEARED_EARNINGS_SNAPSHOT,
      hours_changed_after_payment_at: null,
      previous_approval: {
        approved_at: FROZEN_AT,
        approved_by: PARENT,
        gross_minor: GROSS,
        currency: 'GBP',
        worked_minutes: WORKED,
      },
    });
    expect((await read(id)).updated_at).not.toBe(PAST);
  });

  it('a second roll-up keeps the receipt (ELSE previous_approval) and is idempotent', async () => {
    const id = await seed(approved());
    const repo = new TimesheetRepository();
    const first = await repo.rollUpHours(id, 2940);
    const second = await repo.rollUpHours(id, 3000);
    expect(second.total_minutes).toBe(3000);
    expect(second.status).toBe('submitted');
    expect(second.previous_approval).toEqual(first.previous_approval);
  });

  it('leaves worked_minutes null when the snapshot has no such key', async () => {
    const id = await seed(approved({ status: 'no_arrangement' }));
    const row = await new TimesheetRepository().rollUpHours(id, 2940);
    expect(row.previous_approval).toMatchObject({
      gross_minor: GROSS,
      worked_minutes: null,
    });
  });

  it('writes no receipt on a week that was already submitted', async () => {
    const id = await seed({ total_minutes: 600 });
    const row = await new TimesheetRepository().rollUpHours(id, 900);
    expect(row).toMatchObject({ total_minutes: 900, previous_approval: null });
  });

  it('the next approve supersedes the receipt', async () => {
    const id = await seed(approved());
    const repo = new TimesheetRepository();
    await repo.rollUpHours(id, 2940);
    const version = (await read(id)).updated_at;
    const row = await repo.approveSubmittedWithEarnings(
      id,
      snapshotPatch,
      version
    );
    expect(row).toMatchObject({ status: 'approved', previous_approval: null });
  });
});

describe('rollUpHours — missing row', () => {
  it('throws rather than returning nothing', async () => {
    const err = await new TimesheetRepository()
      .rollUpHours('missing', 1)
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
  });
});

describe('stampParentViewed (timesheetParentViewed)', () => {
  it('is one-way and does not bump updated_at', async () => {
    const id = await seed();
    const repo = new TimesheetRepository();
    const first = await repo.stampParentViewed(id, '2026-08-16T12:00:00.000Z');
    expect(first?.parent_viewed_at).toBe('2026-08-16T12:00:00.000Z');
    expect(
      await repo.stampParentViewed(id, '2026-08-16T18:00:00.000Z')
    ).toBeNull();
    const after = await read(id);
    expect(after.parent_viewed_at).toBe('2026-08-16T12:00:00.000Z');
    expect(after.updated_at).toBe(PAST);

    // ...so the approve CAS pinned to the pre-stamp version still matches.
    expect(
      await repo.approveSubmittedWithEarnings(id, snapshotPatch, PAST)
    ).not.toBeNull();
  });

  it('a later minutes change still bumps updated_at and keeps the receipt', async () => {
    const id = await seed();
    const repo = new TimesheetRepository();
    await repo.stampParentViewed(id, '2026-08-16T12:00:00.000Z');
    await repo.rollUpHours(id, 540);
    const after = await read(id);
    expect(after.parent_viewed_at).not.toBeNull();
    expect(after.updated_at).not.toBe(PAST);
  });
});

describe('existsForHousehold', () => {
  it('answers per household', async () => {
    await t.db.insert(households).values({ id: 'h-empty', name: 'Empty' });
    const repo = new TimesheetRepository();
    expect(await repo.existsForHousehold(H1)).toBe(true);
    expect(await repo.existsForHousehold('h-empty')).toBe(false);
  });
});

describe('CLEARED_EARNINGS_SNAPSHOT', () => {
  it('names all four columns, so the reopen path cannot forget one', () => {
    expect(CLEARED_EARNINGS_SNAPSHOT).toEqual({
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });
});
