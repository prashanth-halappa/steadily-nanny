/** tests/helpers/testDb.ts: migrations applied, isolation, guarded writes in db.batch. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { households } from '../../../src/db/schema';
import { createTestDb, type TestDb } from '../../helpers/testDb';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.dispose());

describe('createTestDb', () => {
  test('applies every migration, triggers included', async () => {
    const r = await t.d1
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'")
      .first<{ n: number }>();
    expect(r?.n).toBe(45);
  });

  test('each instance is isolated', async () => {
    await t.db.insert(households).values({ id: 'iso', name: 'x' });
    const other = await createTestDb();
    try {
      expect(await other.db.select().from(households)).toHaveLength(0);
    } finally {
      await other.dispose();
    }
  });

  test('db.batch: a guarded UPDATE whose precondition fails changes 0 rows', async () => {
    await t.db
      .insert(households)
      .values({ id: 'b1', name: 'Home', state: 'live' });
    const guarded = (name: string, expectedState: string) =>
      t.db
        .update(households)
        .set({ name })
        .where(
          and(eq(households.id, 'b1'), eq(households.state, expectedState))
        );

    const [lost, won] = await t.db.batch([
      guarded('Lost race', 'draft'),
      guarded('Won', 'live'),
    ]);
    expect(lost.meta.changes).toBe(0);
    // meta.changes counts trigger writes too (set_households_updated_at): the
    // won update reports 2. Test `> 0`, or use `.returning()` length.
    expect(won.meta.changes).toBeGreaterThan(0);

    // A dependent write gated on the primary having happened is a no-op too.
    const [, dependent] = await t.db.batch([
      guarded('Lost again', 'draft'),
      t.db
        .update(households)
        .set({ country: 'GB' })
        .where(
          and(
            eq(households.id, 'b1'),
            sql`EXISTS (SELECT 1 FROM households WHERE id = 'b1' AND name = 'Lost again')`
          )
        ),
    ]);
    expect(dependent.meta.changes).toBe(0);
    const [row] = await t.db
      .select()
      .from(households)
      .where(eq(households.id, 'b1'));
    expect(row).toMatchObject({ name: 'Won', country: 'US' });
  });

  test('db.batch is all-or-nothing on a constraint failure', async () => {
    const err = await t.db
      .batch([
        t.db.insert(households).values({ id: 'b2', name: 'ok' }),
        t.db.insert(households).values({ id: 'b3', currency: 'bad' }),
      ])
      .catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(
      await t.db.select().from(households).where(eq(households.id, 'b2'))
    ).toHaveLength(0);
  });
});
