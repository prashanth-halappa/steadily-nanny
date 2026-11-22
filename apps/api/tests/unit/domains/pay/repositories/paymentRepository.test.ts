/**
 * PaymentRepository against a real Miniflare D1 (tests/helpers/testDb.ts).
 *
 * The two money writes are the D1 replacements for `record_timesheet_payment`
 * (077/102) and `record_payment_correction` (085) — one guarded
 * `INSERT … SELECT … WHERE` each (MIGRATION-NOTES §5.1/§5.2). These tests run
 * the real SQL, so they prove the over-gross / over-reversal arithmetic, the
 * stamping from the timesheet / original row, the outcome classification on
 * a refused insert, and the race behaviour (parallel calls produce exactly
 * one success). They also carry the intent of the Postgres-only
 * tests/integration/recordTimesheetPayment.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from '../../../../../src/db/schema';
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
let repo: InstanceType<
  typeof import('../../../../../src/domains/pay/repositories/paymentRepository').PaymentRepository
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
const GROSS = 80_000;
const FROZEN_AT = '2026-08-10T18:00:00.000Z';

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
  const { PaymentRepository } = await import(
    '../../../../../src/domains/pay/repositories/paymentRepository'
  );
  repo = new PaymentRepository();
});
afterAll(() => t.dispose());

let weekSeq = 0;
const nextWeek = () =>
  new Date(Date.UTC(2025, 0, 6 + 7 * weekSeq++)).toISOString().slice(0, 10);

/** An approved, priced week (the approved-has-snapshot CHECK needs all four). */
async function week(
  overrides: Partial<typeof timesheets.$inferInsert> = {}
): Promise<string> {
  const [row] = await t.db
    .insert(timesheets)
    .values({
      household_id: H1,
      carer_id: CARER,
      carer_display_name: 'Carer',
      week_start: nextWeek(),
      total_minutes: 2400,
      status: 'approved',
      approved_by: PARENT,
      approved_at: FROZEN_AT,
      gross_minor: GROSS,
      currency: 'GBP',
      earnings: { status: 'ok', gross_minor: GROSS },
      earnings_computed_at: FROZEN_AT,
      household_member_id: 'member-1',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row.id;
}

const entry = (amount_minor: number, extra: Record<string, unknown> = {}) => ({
  amount_minor,
  paid_at: '2026-08-14',
  method_note: null,
  recorded_by: PARENT,
  ...extra,
});

async function rowsFor(timesheetId: string) {
  return repo.listForTimesheet(timesheetId);
}

describe('PaymentRepository.listForTimesheet / listForHousehold', () => {
  it('scopes to the timesheet and orders oldest settlement first', async () => {
    const a = await week();
    const b = await week();
    await t.db.insert(payments).values([
      {
        timesheet_id: a,
        household_id: H1,
        carer_id: CARER,
        amount_minor: 100,
        currency: 'GBP',
        paid_at: '2026-08-18',
        created_at: '2026-08-18T09:00:00.000Z',
      },
      {
        timesheet_id: a,
        household_id: H1,
        carer_id: CARER,
        amount_minor: 200,
        currency: 'GBP',
        paid_at: '2026-08-11',
        created_at: '2026-08-11T09:00:00.000Z',
      },
      {
        timesheet_id: b,
        household_id: H1,
        carer_id: CARER,
        amount_minor: 300,
        currency: 'GBP',
        paid_at: '2026-08-11',
      },
    ]);
    const rows = await repo.listForTimesheet(a);
    expect(rows.map(r => r.amount_minor)).toEqual([200, 100]);
    expect(await repo.listForTimesheet('nope')).toEqual([]);
  });

  it('scopes to the household, narrows by carer, newest first with a created_at tie-break', async () => {
    const mine = await week({ household_id: H2, carer_id: CARER });
    const theirs = await week({ household_id: H2, carer_id: CARER2 });
    await t.db.insert(payments).values([
      {
        timesheet_id: mine,
        household_id: H2,
        carer_id: CARER,
        amount_minor: 1,
        currency: 'GBP',
        paid_at: '2026-08-11',
        created_at: '2026-08-11T09:00:00.000Z',
      },
      {
        timesheet_id: mine,
        household_id: H2,
        carer_id: CARER,
        amount_minor: 2,
        currency: 'GBP',
        paid_at: '2026-08-11',
        created_at: '2026-08-11T17:00:00.000Z',
      },
      {
        timesheet_id: theirs,
        household_id: H2,
        carer_id: CARER2,
        amount_minor: 3,
        currency: 'GBP',
        paid_at: '2026-08-20',
      },
    ]);
    expect((await repo.listForHousehold(H2)).map(r => r.amount_minor)).toEqual([
      3, 2, 1,
    ]);
    expect(
      (await repo.listForHousehold(H2, CARER)).map(r => r.amount_minor)
    ).toEqual([2, 1]);
  });

  it('wraps a failing query in a DatabaseError', async () => {
    broken = true;
    try {
      await expect(repo.listForTimesheet('x')).rejects.toBeInstanceOf(
        DatabaseError
      );
      await expect(
        repo.recordForTimesheet('x', entry(1))
      ).rejects.toBeInstanceOf(DatabaseError);
    } finally {
      broken = false;
    }
  });
});

describe('PaymentRepository.recordForTimesheet (record_timesheet_payment)', () => {
  it('records a payment, stamping household, carer and currency FROM THE WEEK', async () => {
    const id = await week({ currency: 'EUR' });
    const out = await repo.recordForTimesheet(id, entry(30_000));
    expect(out.outcome).toBe('recorded');
    if (out.outcome !== 'recorded') throw new Error('unreachable');
    expect(out.payment).toMatchObject({
      timesheet_id: id,
      household_id: H1,
      carer_id: CARER,
      currency: 'EUR',
      amount_minor: 30_000,
      kind: 'payment',
      paid_at: '2026-08-14',
      method_note: null,
      recorded_by: PARENT,
    });
  });

  it('accepts a partial payment, then refuses the one that would tip it over — with the figures', async () => {
    const id = await week();
    await repo.recordForTimesheet(id, entry(50_000));
    expect(await repo.recordForTimesheet(id, entry(30_001))).toEqual({
      outcome: 'exceeds_gross',
      alreadyPaidMinor: 50_000,
      grossMinor: GROSS,
    });
    // Exactly to gross is fine: the guard is `<=`, never a clamp.
    expect((await repo.recordForTimesheet(id, entry(30_000))).outcome).toBe(
      'recorded'
    );
    expect(await rowsFor(id)).toHaveLength(2);
  });

  it('counts corrections SIGNED: a reversal frees that much room again', async () => {
    const id = await week();
    const first = await repo.recordForTimesheet(id, entry(GROSS));
    if (first.outcome !== 'recorded') throw new Error('setup');
    await repo.recordCorrection(id, first.payment.id, {
      amount_minor: -10_000,
      paid_at: '2026-08-15',
      reason: 'overpaid',
      recorded_by: PARENT,
    });
    expect((await repo.recordForTimesheet(id, entry(10_000))).outcome).toBe(
      'recorded'
    );
    expect((await repo.recordForTimesheet(id, entry(1))).outcome).toBe(
      'exceeds_gross'
    );
  });

  it('answers not_payable on a submitted week, carrying the status it read', async () => {
    const id = await week({
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
    expect(await repo.recordForTimesheet(id, entry(1))).toEqual({
      outcome: 'not_payable',
      status: 'submitted',
    });
    expect(await rowsFor(id)).toEqual([]);
  });

  it('answers not_payable with a null status for a week that does not exist', async () => {
    expect(await repo.recordForTimesheet('missing', entry(1))).toEqual({
      outcome: 'not_payable',
      status: null,
    });
  });

  it('RACE: two parallel payments whose sum exceeds gross produce exactly one success', async () => {
    const id = await week();
    const results = await Promise.all([
      repo.recordForTimesheet(id, entry(50_000)),
      repo.recordForTimesheet(id, entry(50_000)),
    ]);
    expect(results.map(r => r.outcome).sort()).toEqual([
      'exceeds_gross',
      'recorded',
    ]);
    expect(await rowsFor(id)).toHaveLength(1);
  });

  it('RACE: a payment against a week reopened under it is not_payable, and writes nothing', async () => {
    const id = await week();
    // The reopen lands first (no payments yet, so the trigger allows it).
    await t.d1
      .prepare(
        "UPDATE timesheets SET status = 'submitted', approved_by = NULL, approved_at = NULL, gross_minor = NULL, currency = NULL, earnings = NULL, earnings_computed_at = NULL WHERE id = ?"
      )
      .bind(id)
      .run();
    expect(await repo.recordForTimesheet(id, entry(1))).toEqual({
      outcome: 'not_payable',
      status: 'submitted',
    });
    expect(await rowsFor(id)).toEqual([]);
  });

  describe('idempotency key (102)', () => {
    it('writes ONE row for a repeated key and hands back the row it already wrote', async () => {
      const id = await week();
      const key = crypto.randomUUID();
      const a = await repo.recordForTimesheet(
        id,
        entry(GROSS, { idempotency_key: key })
      );
      const b = await repo.recordForTimesheet(
        id,
        entry(GROSS, { idempotency_key: key })
      );
      expect(a.outcome).toBe('recorded');
      // Fully paid, so without the key this would be exceeds_gross: the key
      // is answered BEFORE any payable check.
      expect(b).toEqual(a);
      expect(await rowsFor(id)).toHaveLength(1);
    });

    it('RACE: two parallel retries of one intent both answer recorded, with one row', async () => {
      const id = await week();
      const key = crypto.randomUUID();
      const [a, b] = await Promise.all([
        repo.recordForTimesheet(id, entry(1000, { idempotency_key: key })),
        repo.recordForTimesheet(id, entry(1000, { idempotency_key: key })),
      ]);
      expect(a.outcome).toBe('recorded');
      expect(b).toEqual(a);
      expect(await rowsFor(id)).toHaveLength(1);
    });

    it('does NOT dedupe two payments that carry no key', async () => {
      const id = await week();
      await repo.recordForTimesheet(id, entry(1000));
      await repo.recordForTimesheet(id, entry(1000));
      expect(await rowsFor(id)).toHaveLength(2);
    });
  });
});

describe('PaymentRepository.recordCorrection (record_payment_correction)', () => {
  const correction = (amount_minor: number) => ({
    amount_minor,
    paid_at: '2026-08-15',
    reason: 'typo',
    recorded_by: PARENT,
  });

  async function paid(amount = GROSS) {
    const id = await week();
    const out = await repo.recordForTimesheet(id, entry(amount));
    if (out.outcome !== 'recorded') throw new Error('setup');
    return { id, payment: out.payment };
  }

  it('records a negative correction, copying household, carer and currency from the ORIGINAL', async () => {
    const { id, payment } = await paid();
    const out = await repo.recordCorrection(id, payment.id, correction(-500));
    expect(out.outcome).toBe('recorded');
    if (out.outcome !== 'recorded') throw new Error('unreachable');
    expect(out.correction).toMatchObject({
      timesheet_id: id,
      household_id: H1,
      carer_id: CARER,
      currency: 'GBP',
      amount_minor: -500,
      kind: 'correction',
      corrects_payment_id: payment.id,
      correction_reason: 'typo',
    });
  });

  it('refuses an over-reversal against what REMAINS, with the figures', async () => {
    const { id, payment } = await paid(10_000);
    await repo.recordCorrection(id, payment.id, correction(-4000));
    expect(
      await repo.recordCorrection(id, payment.id, correction(-6001))
    ).toEqual({
      outcome: 'exceeds_original',
      originalAmountMinor: 10_000,
      remainingMinor: 6000,
    });
    expect(
      (await repo.recordCorrection(id, payment.id, correction(-6000))).outcome
    ).toBe('recorded');
  });

  it('refuses a non-negative amount as exceeds_original', async () => {
    const { id, payment } = await paid(10_000);
    expect(
      (await repo.recordCorrection(id, payment.id, correction(0))).outcome
    ).toBe('exceeds_original');
  });

  it('classifies each not_correctable reason', async () => {
    const { id, payment } = await paid(10_000);
    const other = await paid(10_000);
    expect(
      await repo.recordCorrection('missing', payment.id, correction(-1))
    ).toEqual({ outcome: 'not_correctable', reason: 'week_missing' });
    expect(
      await repo.recordCorrection(id, other.payment.id, correction(-1))
    ).toEqual({ outcome: 'not_correctable', reason: 'payment_missing' });
    const corr = await repo.recordCorrection(id, payment.id, correction(-1));
    if (corr.outcome !== 'recorded') throw new Error('setup');
    expect(
      await repo.recordCorrection(id, corr.correction.id, correction(-1))
    ).toEqual({ outcome: 'not_correctable', reason: 'not_a_payment' });
  });

  it('RACE: two parallel reversals that together exceed the payment produce exactly one success', async () => {
    const { id, payment } = await paid(10_000);
    const results = await Promise.all([
      repo.recordCorrection(id, payment.id, correction(-6000)),
      repo.recordCorrection(id, payment.id, correction(-6000)),
    ]);
    expect(results.map(r => r.outcome).sort()).toEqual([
      'exceeds_original',
      'recorded',
    ]);
    const sum = (await rowsFor(id)).reduce((s, r) => s + r.amount_minor, 0);
    expect(sum).toBe(4000);
  });
});

describe('PaymentRepository — append-only', () => {
  it('refuses update and delete before touching the database', async () => {
    broken = true;
    try {
      await expect(repo.update('x', {})).rejects.toThrow(/append-only/);
      await expect(repo.delete('x')).rejects.toThrow(/append-only/);
    } finally {
      broken = false;
    }
  });
});
