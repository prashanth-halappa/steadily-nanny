/**
 * D1 caps a statement at 100 bound parameters, so HouseholdRepository splits
 * caller-sized id lists (`src/db/chunk.ts`). 250 ids spans three chunks: every
 * row must come back, ordering must hold across chunks (not per chunk), and a
 * delete must reach every chunk.
 *
 * Miniflare's local D1 does NOT enforce the 100 cap (plain SQLite's limit is
 * far higher), so this proves completeness and cross-chunk ordering, not the
 * cap itself — `findByIds`' order check fails if the re-sort is per chunk.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { households } from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let repo: {
  findByIds(ids: string[]): Promise<{ id: string }[]>;
  listLiveIds(ids: string[]): Promise<string[]>;
  deleteIfMemberless(ids: string[]): Promise<string[]>;
};

const N = 250;
// h000 is the oldest, h249 the newest.
const ids = Array.from(
  { length: N },
  (_, i) => `h${String(i).padStart(3, '0')}`
);

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { HouseholdRepository } = await import(
    '../../../../../src/domains/household/repositories/householdRepository'
  );
  repo = new HouseholdRepository();
  // Drizzle binds every defaulted column (~12 per row), so seed row by row.
  for (const [i, id] of ids.entries()) {
    await t.db.insert(households).values({
      id,
      name: id,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    });
  }
});

afterAll(() => t.dispose());

describe('HouseholdRepository with more ids than one D1 statement can bind', () => {
  it('findByIds returns every row, newest first across chunks', async () => {
    const rows = await repo.findByIds(ids);
    expect(rows.map(r => r.id)).toEqual([...ids].reverse());
  });

  it('listLiveIds returns every live id', async () => {
    expect((await repo.listLiveIds(ids)).sort()).toEqual(ids);
  });

  it('deleteIfMemberless deletes every memberless household', async () => {
    expect((await repo.deleteIfMemberless(ids)).sort()).toEqual(ids);
    const left = await t.db
      .select({ id: households.id })
      .from(households)
      .where(inArray(households.id, ids.slice(0, 90)));
    expect(left).toEqual([]);
    expect(await repo.findByIds(ids)).toEqual([]);
  });
});
