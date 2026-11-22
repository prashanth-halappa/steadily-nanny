/**
 * A fresh, isolated D1 database per test file: Miniflare's real D1 (the same
 * SQLite build workerd runs in production) with `migrations/*.sql` applied.
 *
 * Usage — swap the app's `db` handle BEFORE any dynamic import of code that
 * reads it (repo convention, docs/09-TESTING.md §"D1 test database"):
 *
 *   let t: TestDb;
 *   beforeAll(async () => {
 *     t = await createTestDb();
 *     mock.module('../../../../src/db/client', () => ({ db: t.db }));
 *     ({ ShiftRepository } = await import('…/shiftRepository'));
 *   });
 *   afterAll(() => t.dispose());
 *
 * Isolation is per file (one Miniflare per file); reset between tests by
 * deleting rows yourself if a test needs a clean table.
 *
 * @module tests/helpers/testDb
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import type { Db } from '../../src/db/client';
import * as schema from '../../src/db/schema';

const MIGRATIONS = join(import.meta.dir, '../../migrations');

export interface TestDb {
  db: Db;
  d1: AnyD1Database;
  dispose: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  // No resourcePersistencePath: D1 lives in a temp dir cleared on dispose().
  // Miniflare 5 (beta) takes a parsed-config shape; the v4 converter keeps the
  // familiar options, same as wrangler's own internal uses.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch: () => new Response(null) }',
      d1Databases: ['DB'],
    })
  );
  const d1 = (await mf.getD1Database('DB')) as unknown as AnyD1Database;

  const statements = readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .flatMap(f =>
      readFileSync(join(MIGRATIONS, f), 'utf8').split(
        '--> statement-breakpoint'
      )
    )
    .filter(s => s.replace(/--.*$/gm, '').trim());
  // One batch = one round-trip into workerd; each element is one statement,
  // so trigger bodies (BEGIN … ; … END) stay intact.
  await d1.batch(statements.map(s => d1.prepare(s)));

  return {
    db: drizzle(d1, { schema }),
    d1,
    dispose: () => mf.dispose(),
  };
}
