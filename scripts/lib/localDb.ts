/**
 * The LOCAL D1 database (the one `wrangler dev` in apps/api persists to), as
 * a Drizzle handle for Bun seed scripts, plus a Better Auth user helper.
 *
 *   const { db, dispose } = await getLocalDb();
 *   const id = await ensureUser(db, { email, password, name });
 *   …
 *   await dispose();
 *
 * Local only: `getPlatformProxy` binds Miniflare's on-disk D1 under
 * apps/api/.wrangler/state. `D1_REMOTE=1` fails fast — production has no
 * email/password sign-in, so seeded email users are useless there.
 */
import { join } from 'node:path';
import { CURRENT_LEGAL_VERSION } from '@steadily-nanny/shared-types';
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
    throw new Error(
      'D1_REMOTE=1 is no longer supported: production refuses email/password sign-in, so seeded email users could never log in there. Seed LOCAL D1 and run the tests against `wrangler dev` (apps/api, with EMAIL_AUTH_ENABLED=true in .dev.vars).'
    );
  }
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
/**
 * Seeded accounts also accept the current Terms + Privacy version, so Maestro
 * flows land past the legal gate (docs/LEGAL-ACCEPTANCE-PLAN.md). Pass
 * `acceptLegal: false` for an account that should meet the gate.
 */
export async function ensureUser(
  db: Db,
  input: {
    email: string;
    password: string;
    name: string;
    acceptLegal?: boolean;
  }
): Promise<{ id: string; created: boolean }> {
  const result = await ensureAuthUser(db, input);
  if (input.acceptLegal !== false) {
    await db
      .insert(schema.legalAcceptances)
      .values({
        user_id: result.id,
        version: CURRENT_LEGAL_VERSION,
        accepted_at: new Date().toISOString(),
        platform: 'web',
      })
      .onConflictDoNothing({
        target: [
          schema.legalAcceptances.user_id,
          schema.legalAcceptances.version,
        ],
      });
  }
  return result;
}

async function ensureAuthUser(
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
