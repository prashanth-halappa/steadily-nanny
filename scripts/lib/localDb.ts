/**
 * The LOCAL D1 database (the one `wrangler dev` in apps/api persists to), as
 * a Drizzle handle for Bun seed scripts, plus a Better Auth user helper.
 *
 *   const { db, dispose } = await getLocalDb();
 *   const id = await ensureUser(db, { email, password, name });
 *   …
 *   await dispose();
 *
 * Local by default: `getPlatformProxy` binds Miniflare's on-disk D1 under
 * apps/api/.wrangler/state. `D1_REMOTE=1` instead talks to the REMOTE
 * (production) database over the D1 REST API — only for an explicitly
 * authorized seed of the deployed Worker's database. (wrangler's own remote
 * bindings refuse to run under Bun, so this is a thin D1Database shim.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import { getPlatformProxy } from 'wrangler';
import type { Db } from '../../apps/api/src/db/client';
import * as schema from '../../apps/api/src/db/schema';

const API_DIR = join(import.meta.dir, '..', '..', 'apps', 'api');

export async function getLocalDb(): Promise<{
  db: Db;
  dispose: () => Promise<void>;
}> {
  if (process.env.D1_REMOTE === '1') {
    return { db: drizzle(remoteD1(), { schema }), dispose: async () => {} };
  }
  const proxy = await getPlatformProxy<{ DB: AnyD1Database }>({
    configPath: join(API_DIR, 'wrangler.jsonc'),
    persist: { path: join(API_DIR, '.wrangler', 'state', 'v3') },
  });
  return { db: drizzle(proxy.env.DB, { schema }), dispose: proxy.dispose };
}

/**
 * Just enough of the D1Database surface for drizzle's d1 driver (prepare /
 * bind / all / run / raw / first), over `POST …/d1/database/<id>/{query,raw}`,
 * authenticated with wrangler's own login token.
 * ponytail: no batch() — no seeder uses it; add via the REST `batch` body if one does.
 */
function remoteD1(): AnyD1Database {
  const cfg = readFileSync(join(API_DIR, 'wrangler.jsonc'), 'utf8');
  const dbId = cfg.match(/"database_id":\s*"([^"]+)"/)?.[1];
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!dbId || !accountId) {
    throw new Error(
      'D1_REMOTE=1 needs CLOUDFLARE_ACCOUNT_ID and a database_id in wrangler.jsonc'
    );
  }
  const token =
    process.env.CLOUDFLARE_API_TOKEN ??
    Bun.spawnSync(['bunx', 'wrangler', 'auth', 'token'], { cwd: API_DIR })
      .stdout.toString()
      .split('\n')
      .map(l => l.trim())
      .find(l => /^[\w.-]{40,}$/.test(l));
  if (!token)
    throw new Error(
      'could not get a Cloudflare token from `wrangler auth token`'
    );
  console.error(
    `\n${'!'.repeat(72)}\n!! D1_REMOTE=1 — writing to the REMOTE D1 database ${dbId}\n${'!'.repeat(72)}\n`
  );

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}`;
  const call = async (
    kind: 'query' | 'raw',
    sqlText: string,
    params: unknown[]
  ) => {
    const res = await fetch(`${base}/${kind}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql: sqlText, params }),
    });
    const body = (await res.json()) as {
      success: boolean;
      errors?: { message: string }[];
      result?: { results: unknown; meta: unknown }[];
    };
    const r = body.result?.[0];
    if (!body.success || !r) {
      throw new Error(
        `D1 ${kind} failed: ${JSON.stringify(body.errors)} — ${sqlText}`
      );
    }
    return r;
  };
  const statement = (sqlText: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => statement(sqlText, p),
    all: async () => {
      const r = await call('query', sqlText, params);
      return { results: r.results, success: true, meta: r.meta };
    },
    run: async () => {
      const r = await call('query', sqlText, params);
      return { results: r.results, success: true, meta: r.meta };
    },
    raw: async () => {
      const r = (await call('raw', sqlText, params)) as {
        results: { rows: unknown[][] };
      };
      return r.results.rows;
    },
    first: async (col?: string) => {
      const r = (await call('query', sqlText, params)) as {
        results: Record<string, unknown>[];
      };
      const row = r.results[0] ?? null;
      return col && row ? row[col] : row;
    },
  });
  return {
    prepare: (sqlText: string) => statement(sqlText),
  } as unknown as AnyD1Database;
}

/**
 * Find-or-create an email/password user exactly as Better Auth's sign-up
 * would store it (user row + `credential` account with its scrypt hash).
 * Returns the user id. Idempotent on email; an existing user's password is
 * left alone.
 */
export async function ensureUser(
  db: Db,
  input: { email: string; password: string; name: string }
): Promise<{ id: string; created: boolean }> {
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (existing) {
    return { id: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  await db.insert(schema.user).values({
    id,
    email,
    name: input.name,
    emailVerified: true,
  });
  await db.insert(schema.account).values({
    id: crypto.randomUUID(),
    userId: id,
    accountId: id,
    providerId: 'credential',
    password: await hashPassword(input.password),
  });
  return { id, created: true };
}
