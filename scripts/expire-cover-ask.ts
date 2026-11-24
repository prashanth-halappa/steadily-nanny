/**
 * Backdate ONE pending cover ask's `cover_ask_expires_at` to a minute ago, so
 * the next `POST /api/jobs/cover-ask-expiry` expires it (flow 13a → 13b).
 *
 * The phase4 seeder gives that ask a FUTURE deadline on purpose: seeded in the
 * past, the deployed Worker's own cron (every 5 min) cancelled it before flow
 * 13a could see it pending. Run this immediately before the job curl.
 *
 *   [D1_REMOTE=1 CLOUDFLARE_ACCOUNT_ID=…] bun run scripts/expire-cover-ask.ts <shiftId>
 */
import { and, eq } from 'drizzle-orm';
import { shifts } from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const id = process.argv[2];
if (!id) {
  console.error('usage: expire-cover-ask.ts <shiftId>');
  process.exit(1);
}
const { db, dispose } = await getLocalDb();
try {
  const rows = await db
    .update(shifts)
    .set({ cover_ask_expires_at: new Date(Date.now() - 60_000).toISOString() })
    .where(and(eq(shifts.id, id), eq(shifts.status, 'pending')))
    .returning({ id: shifts.id });
  if (rows.length !== 1) {
    console.error(`FATAL: shift ${id} is not a pending ask (re-seed phase4)`);
    process.exit(1);
  }
  console.log(`backdated cover ask ${id}`);
} finally {
  await dispose();
}
