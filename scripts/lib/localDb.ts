/**
 * The LOCAL D1 database (the one `wrangler dev` in apps/api persists to), as
 * a Drizzle handle for Bun seed scripts, plus a Better Auth user helper.
 *
 *   const { db, dispose } = await getLocalDb();
 *   const id = await ensureUser(db, { email, password, name });
 *   …
 *   await dispose();
 *
 * Local only by construction: `getPlatformProxy` binds Miniflare's on-disk D1
 * under apps/api/.wrangler/state — never the remote database (that would need
 * `remote: true` on the binding).
 */
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
  const proxy = await getPlatformProxy<{ DB: AnyD1Database }>({
    configPath: join(API_DIR, 'wrangler.jsonc'),
    persist: { path: join(API_DIR, '.wrangler', 'state', 'v3') },
  });
  return { db: drizzle(proxy.env.DB, { schema }), dispose: proxy.dispose };
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
