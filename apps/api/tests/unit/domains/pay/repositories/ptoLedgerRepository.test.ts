/**
 * PtoLedgerRepository against a real Miniflare D1 (tests/helpers/testDb.ts).
 *
 * Reads are checked for their scoping (household AND carer, or the one
 * deliberate cross-household read), `create` for its translation of the two
 * real partial unique indexes, and `applyCorrection` — the D1 replacement for
 * `apply_pto_correction` (050/079, MIGRATION-NOTES §5.5) — for the
 * compare-and-set on the ledger aggregate: each insert is gated on the
 * per-day fingerprint the ledger must have just before it, so a competing
 * write between the caller's read and the batch makes NOTHING land.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import {
  carerTimeOff,
  households,
  ptoLedger,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import {
  PtoAccrualGrantRaceError,
  PtoAlreadyMarkedPaidError,
  PtoTimeOffNotConfirmedError,
  PtoTimeOffNotFoundError,
} from '../../../../../src/domains/pay/errors/payErrors';
import type { NewPtoLedgerRow } from '../../../../../src/domains/pay/repositories/ptoLedgerRepository';
import { DatabaseError } from '../../../../../src/errors';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

type Mod =
  typeof import('../../../../../src/domains/pay/repositories/ptoLedgerRepository');
let t: TestDb;
let repo: InstanceType<Mod['PtoLedgerRepository']>;
let canonicalPaidByDate: Mod['canonicalPaidByDate'];

const H1 = 'h1';
const H2 = 'h2';
const PARENT = 'parent-1';
const CARER = 'carer-1';
const CARER2 = 'carer-2';

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  for (const id of [PARENT, CARER, CARER2]) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
    await t.db.insert(userProfiles).values({ user_id: id });
  }
  await t.db.insert(households).values([
    { id: H1, name: 'One' },
    { id: H2, name: 'Two' },
  ]);
  const mod: Mod = await import(
    '../../../../../src/domains/pay/repositories/ptoLedgerRepository'
  );
  repo = new mod.PtoLedgerRepository();
  canonicalPaidByDate = mod.canonicalPaidByDate;
});
afterAll(() => t.dispose());

async function timeOff(
  overrides: Partial<typeof carerTimeOff.$inferInsert> = {}
): Promise<string> {
  const [row] = await t.db
    .insert(carerTimeOff)
    .values({
      user_id: CARER,
      starts_at: '2026-03-02T00:00:00.000Z',
      ends_at: '2026-03-04T00:00:00.000Z',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row.id;
}

const row = (overrides: Partial<NewPtoLedgerRow> = {}): NewPtoLedgerRow => ({
  household_id: H1,
  carer_id: CARER,
  kind: 'usage',
  minutes: -480,
  effective_date: '2026-03-02',
  time_off_id: null,
  carer_display_name: 'Carer',
  note: null,
  created_by: PARENT,
  ...overrides,
});

async function seedRows(rows: NewPtoLedgerRow[]) {
  for (const r of rows) await t.db.insert(ptoLedger).values(r);
}

describe('PtoLedgerRepository reads', () => {
  it('listForCarerYear: this household AND carer, inclusive calendar year, oldest first', async () => {
    await seedRows([
      row({ kind: 'accrual', minutes: 1, effective_date: '2025-12-31' }),
      row({ kind: 'accrual', minutes: 2, effective_date: '2025-01-01' }),
      row({ kind: 'adjustment', minutes: 3, effective_date: '2025-06-01' }),
      row({ kind: 'accrual', minutes: 4, effective_date: '2024-12-31' }),
      row({
        kind: 'adjustment',
        minutes: 5,
        effective_date: '2025-06-01',
        carer_id: CARER2,
      }),
      row({
        kind: 'adjustment',
        minutes: 6,
        effective_date: '2025-06-01',
        household_id: H2,
      }),
    ]);
    const rows = await repo.listForCarerYear(H1, CARER, 2025);
    expect(rows.map(r => r.minutes)).toEqual([2, 3, 1]);
    expect(await repo.listForCarerYear(H1, CARER, 1990)).toEqual([]);
  });

  it('listForHouseholdYear: every carer in this household, including a departed one', async () => {
    await seedRows([
      row({
        kind: 'adjustment',
        minutes: 7,
        effective_date: '2023-02-01',
        carer_id: null,
      }),
      row({
        kind: 'adjustment',
        minutes: 8,
        effective_date: '2023-03-01',
        carer_id: CARER2,
      }),
      row({
        kind: 'adjustment',
        minutes: 9,
        effective_date: '2023-03-01',
        household_id: H2,
      }),
    ]);
    expect(
      (await repo.listForHouseholdYear(H1, 2023)).map(r => r.minutes)
    ).toEqual([7, 8]);
  });

  it('listForHouseholdTimeOff is household-scoped and kind-blind; listAllForTimeOff crosses households', async () => {
    const to = await timeOff();
    await seedRows([
      row({ time_off_id: to }),
      row({ time_off_id: to, kind: 'adjustment', minutes: 120 }),
      row({ time_off_id: to, household_id: H2 }),
    ]);
    const mine = await repo.listForHouseholdTimeOff(H1, to);
    expect(mine.map(r => r.kind).sort()).toEqual(['adjustment', 'usage']);
    expect(await repo.listAllForTimeOff(to)).toHaveLength(3);
    expect(await repo.listForHouseholdTimeOff(H1, 'nope')).toEqual([]);
  });
});

describe('PtoLedgerRepository.create', () => {
  it('inserts and returns the row', async () => {
    const to = await timeOff();
    const created = await repo.create(row({ time_off_id: to }));
    expect(created).toMatchObject({
      time_off_id: to,
      minutes: -480,
      kind: 'usage',
    });
  });

  it('a duplicate usage day is PtoAlreadyMarkedPaidError', async () => {
    const to = await timeOff();
    await repo.create(row({ time_off_id: to }));
    await expect(repo.create(row({ time_off_id: to }))).rejects.toBeInstanceOf(
      PtoAlreadyMarkedPaidError
    );
  });

  it('a duplicate annual accrual is PtoAccrualGrantRaceError', async () => {
    const accrual = row({
      kind: 'accrual',
      minutes: 100,
      effective_date: '2030-01-01',
    });
    await repo.create(accrual);
    await expect(repo.create(accrual)).rejects.toBeInstanceOf(
      PtoAccrualGrantRaceError
    );
  });

  it('any other failure is a plain DatabaseError', async () => {
    const err = await repo
      .create(row({ kind: 'adjustment', minutes: 0 }))
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
  });
});

describe('PtoLedgerRepository.applyCorrection (apply_pto_correction)', () => {
  const adj = (to: string, minutes: number, effective_date: string) =>
    row({ kind: 'adjustment', time_off_id: to, minutes, effective_date });

  it('canonicalPaidByDate matches what SQLite emits for the same ledger, byte for byte', async () => {
    const to = await timeOff();
    await seedRows([
      row({ time_off_id: to, effective_date: '2026-03-03', minutes: -240 }),
      row({ time_off_id: to, effective_date: '2026-03-02', minutes: -480 }),
      adj(to, 480, '2026-03-02'), // a fully reversed day nets to 0 and stays
    ]);
    const got = await t.db.get<{ fp: string }>(
      sql`SELECT (SELECT coalesce(json_group_object(d, -m), '{}') FROM (SELECT effective_date AS d, sum(minutes) AS m FROM pto_ledger WHERE household_id = ${H1} AND time_off_id = ${to} GROUP BY effective_date ORDER BY effective_date)) AS fp`
    );
    expect(got?.fp).toBe(
      canonicalPaidByDate({ '2026-03-03': 240, '2026-03-02': 0 })
    );
    expect(got?.fp).toBe('{"2026-03-02":0,"2026-03-03":240}');
  });

  it('applies against the expected state, stamping household, time off and leave_kind from the TIME OFF', async () => {
    const to = await timeOff({ kind: 'sick' });
    await seedRows([
      row({ time_off_id: to, effective_date: '2026-03-02' }),
      row({ time_off_id: to, effective_date: '2026-03-03' }),
    ]);
    const written = await repo.applyCorrection({
      householdId: H1,
      timeOffId: to,
      expected: { '2026-03-03': 480, '2026-03-02': 480 },
      rows: [adj(to, 120, '2026-03-03'), adj(to, 120, '2026-03-02')],
      requireConfirmed: true,
    });
    expect(written?.map(r => [r.effective_date, r.minutes])).toEqual([
      ['2026-03-02', 120],
      ['2026-03-03', 120],
    ]);
    expect(written?.every(r => r.leave_kind === 'sick')).toBe(true);
    expect(written?.every(r => r.household_id === H1)).toBe(true);
  });

  it('a first marking (expected {}) can write several rows, two on one day', async () => {
    const to = await timeOff();
    const written = await repo.applyCorrection({
      householdId: H1,
      timeOffId: to,
      expected: {},
      rows: [
        row({ time_off_id: to, effective_date: '2026-03-02', minutes: -480 }),
        adj(to, 60, '2026-03-02'),
      ],
      requireConfirmed: true,
    });
    expect(written).toHaveLength(2);
  });

  it('nothing to write against an unchanged ledger is [] — applied, not a failure', async () => {
    const to = await timeOff();
    expect(
      await repo.applyCorrection({
        householdId: H1,
        timeOffId: to,
        expected: {},
        rows: [],
        requireConfirmed: true,
      })
    ).toEqual([]);
  });

  it('a stale expected state is null and writes nothing', async () => {
    const to = await timeOff();
    await seedRows([row({ time_off_id: to })]);
    expect(
      await repo.applyCorrection({
        householdId: H1,
        timeOffId: to,
        expected: { '2026-03-02': 360 },
        rows: [adj(to, 60, '2026-03-02')],
        requireConfirmed: true,
      })
    ).toBeNull();
    expect(await repo.listForHouseholdTimeOff(H1, to)).toHaveLength(1);
  });

  it('RACE: a competing write between the read and the guarded write makes the batch a no-op (stale)', async () => {
    const to = await timeOff();
    await seedRows([
      row({ time_off_id: to, effective_date: '2026-03-02' }),
      row({ time_off_id: to, effective_date: '2026-03-03' }),
    ]);
    // Parent A reads 8h/8h …
    const read = await repo.listForHouseholdTimeOff(H1, to);
    const expected = Object.fromEntries(
      read.map(r => [r.effective_date, -r.minutes])
    );
    // … parent B's correction lands first …
    await seedRows([adj(to, 120, '2026-03-03')]);
    // … so A's two-row correction must write NEITHER row.
    expect(
      await repo.applyCorrection({
        householdId: H1,
        timeOffId: to,
        expected,
        rows: [adj(to, 120, '2026-03-02'), adj(to, 120, '2026-03-03')],
        requireConfirmed: true,
      })
    ).toBeNull();
    const after = await repo.listForHouseholdTimeOff(H1, to);
    expect(after.reduce((s, r) => s + r.minutes, 0)).toBe(-960 + 120);
  });

  it('RACE: two parents correcting from the same state in parallel — exactly one applies', async () => {
    const to = await timeOff();
    await seedRows([row({ time_off_id: to })]);
    const args = {
      householdId: H1,
      timeOffId: to,
      expected: { '2026-03-02': 480 },
      rows: [adj(to, 120, '2026-03-02')],
      requireConfirmed: true,
    };
    const results = await Promise.all([
      repo.applyCorrection(args),
      repo.applyCorrection(args),
    ]);
    expect(results.filter(r => r === null)).toHaveLength(1);
    const after = await repo.listForHouseholdTimeOff(H1, to);
    expect(-after.reduce((s, r) => s + r.minutes, 0)).toBe(360);
  });

  it('refuses an unconfirmed time off when required, carrying its status', async () => {
    const to = await timeOff({ status: 'cancelled' });
    const err = await repo
      .applyCorrection({
        householdId: H1,
        timeOffId: to,
        expected: {},
        rows: [adj(to, 60, '2026-03-02')],
        requireConfirmed: true,
      })
      .catch(e => e);
    expect(err).toBeInstanceOf(PtoTimeOffNotConfirmedError);
    expect(await repo.listForHouseholdTimeOff(H1, to)).toEqual([]);
  });

  it('writes against a cancelled time off when confirmation is not required (reversal)', async () => {
    const to = await timeOff({ status: 'cancelled' });
    await seedRows([row({ time_off_id: to })]);
    const written = await repo.applyCorrection({
      householdId: H1,
      timeOffId: to,
      expected: { '2026-03-02': 480 },
      rows: [adj(to, 480, '2026-03-02')],
      requireConfirmed: false,
    });
    expect(written).toHaveLength(1);
  });

  it('a missing time off is PtoTimeOffNotFoundError', async () => {
    await expect(
      repo.applyCorrection({
        householdId: H1,
        timeOffId: 'missing',
        expected: {},
        rows: [],
        requireConfirmed: false,
      })
    ).rejects.toBeInstanceOf(PtoTimeOffNotFoundError);
  });

  it('does not touch another household’s marking of the same time off', async () => {
    const to = await timeOff();
    await seedRows([row({ time_off_id: to, household_id: H2 })]);
    const written = await repo.applyCorrection({
      householdId: H1,
      timeOffId: to,
      expected: {},
      rows: [row({ time_off_id: to })],
      requireConfirmed: true,
    });
    expect(written).toHaveLength(1);
    const h2 = await t.db
      .select()
      .from(ptoLedger)
      .where(eq(ptoLedger.household_id, H2));
    expect(h2.filter(r => r.time_off_id === to)).toHaveLength(1);
  });
});
