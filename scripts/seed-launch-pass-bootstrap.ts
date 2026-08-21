#!/usr/bin/env bun
/**
 * Bootstrap the two households the rest of the seed chain assumes already exist.
 *
 * WHY THIS EXISTS
 * `seed-e2e-approval-fixtures.ts` and `seed-phase4-fixtures.ts` both resolve
 * "Our household" by name AND by an active nanny membership. Neither creates
 * it. On a database that has just been reset, `seed-e2e-approval-fixtures.ts`
 * prints `[skip]` and **exits 0** — a silently green run that seeds nothing,
 * after which every downstream flow fails on missing fixtures for reasons that
 * look like app defects. That trap is the whole reason this file exists.
 *
 * Until now the two households were created by hand in psql (the recipe was
 * carried in a comment block at the bottom of `apps/mobile/.env.maestro`, which
 * dies with the file it documents). This is that recipe, executable.
 *
 * Creates, idempotently:
 *   1. "Our household" — the primary household for parent@ + nanny@, with one
 *      child. The child is not decoration: `useIsOnboarded` treats an owner as
 *      set up only once the active household has >= 1 child, so a childless
 *      household sends the seed parent into the onboarding wizard on next
 *      sign-in and every flow after that fails on a missing tab bar.
 *   2. A `state='draft'` household authored by the nanny — flow 20's fixture.
 *      Draft households need no owner/parent (see migration 093's module doc),
 *      so the shape is deliberately minimal: no terms proposal, no invite.
 *
 * Run AFTER scripts/seed-test-users.ts and BEFORE the fixture seeders.
 *
 * Usage: bun run scripts/seed-launch-pass-bootstrap.ts
 *
 * @module scripts/seed-launch-pass-bootstrap
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl } from './localSupabaseGuard';

const PARENT_EMAIL = 'parent@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';
const COPARENT_EMAIL = 'coparent@steadilynanny.test';

const HOUSEHOLD_NAME = 'Our household';
const TIMEZONE = 'Europe/London';
const CURRENCY = 'GBP';
const CHILD_NAME = 'Nia';
const CARE_HOURS_LABEL = 'Care hours';

function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const repoRoot = join(import.meta.dir, '..');
// An EXPORTED value wins over the file: `apps/api/.env` points at PRODUCTION
// (GOLDEN-FIXES #26), so reading the file alone would make the loopback guard
// refuse every run. Export the local stack's values instead.
const fileEnv = loadEnvFile(join(repoRoot, 'apps/api/.env'));
const url = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_KEY ?? fileEnv.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey || serviceKey.startsWith('SET-ME')) {
  console.error(
    'Missing or placeholder SUPABASE_URL / SUPABASE_SERVICE_KEY — export them (see `supabase status -o env`)'
  );
  process.exit(1);
}
assertLocalSupabaseUrl(url);

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(u => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function requireUser(email: string): Promise<string> {
  const id = await findUserByEmail(email);
  if (!id) {
    console.error(`${email} not found. Run scripts/seed-test-users.ts first.`);
    process.exit(1);
  }
  return id;
}

/** The named household, disambiguated the same way the fixture seeders do it:
 *  by name AND an active nanny membership. Matching on name alone would adopt
 *  a stray same-named household with no nanny and reproduce the `[skip]`. */
async function ensureOurHousehold(
  parentId: string,
  nannyId: string
): Promise<string> {
  const { data: candidates, error } = await db
    .from('households')
    .select('id')
    .eq('name', HOUSEHOLD_NAME);
  if (error) throw error;

  for (const candidate of candidates ?? []) {
    const { data: membership } = await db
      .from('household_members')
      .select('user_id')
      .eq('household_id', candidate.id)
      .eq('user_id', nannyId)
      .eq('status', 'active')
      .maybeSingle();
    if (membership) {
      console.log(`[skip]    "${HOUSEHOLD_NAME}" exists -> ${candidate.id}`);
      return candidate.id;
    }
  }

  const { data: created, error: createError } = await db
    .from('households')
    .insert({
      name: HOUSEHOLD_NAME,
      timezone: TIMEZONE,
      currency: CURRENCY,
      created_by: parentId,
    })
    .select('id')
    .single();
  if (createError) throw createError;
  console.log(`[created] "${HOUSEHOLD_NAME}" -> ${created.id}`);
  return created.id;
}

async function ensureMembers(
  householdId: string,
  parentId: string,
  nannyId: string,
  coParentId: string
): Promise<void> {
  const { error } = await db.from('household_members').upsert(
    [
      {
        household_id: householdId,
        user_id: parentId,
        role: 'owner',
        can_edit: true,
        status: 'active',
      },
      {
        household_id: householdId,
        user_id: nannyId,
        role: 'nanny',
        can_edit: false,
        status: 'active',
      },
      // The co-parent. `role: 'parent'` and NOT 'owner' is the whole point:
      // `approval_mode = 'owner_only'` is defined as "only the household owner
      // decides", so a second parent who is not the owner is the only account
      // that can demonstrate the refusal. seed-test-users.ts deliberately
      // creates this account with no household ("must be created through the
      // app"), which left every owner_only assertion unwritable — there was no
      // non-owner parent anywhere to refuse.
      {
        household_id: householdId,
        user_id: coParentId,
        role: 'parent',
        can_edit: true,
        status: 'active',
      },
    ],
    { onConflict: 'user_id,household_id' }
  );
  if (error) throw error;
  console.log('[ok]      members: parent=owner, nanny=nanny, coparent=parent');
}

async function ensureChild(householdId: string): Promise<string> {
  const { data: existing } = await db
    .from('children')
    .select('id')
    .eq('household_id', householdId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    console.log('[skip]    child exists');
    return existing.id;
  }
  const { data: created, error } = await db
    .from('children')
    .insert({
      household_id: householdId,
      name: CHILD_NAME,
      avatar_initial: CHILD_NAME.slice(0, 1),
    })
    .select('id')
    .single();
  if (error) throw error;
  console.log(`[created] child ${CHILD_NAME}`);
  return created.id;
}

/** Declared care hours for the child.
 *
 *  NOT decoration, and NOT optional. Every `child_commitments` row IS a need
 *  window (migration 070 dropped `excluded_from_cover`), and coverage is
 *  computed live as `need − covering shifts − closures`. With no commitments
 *  there is no need, so `TodayCoverage` renders nothing at all and
 *  `today-coverage` is simply absent — which is what flow 18 failed on when
 *  this household was first bootstrapped without them. That failure looked
 *  exactly like a Today-screen regression and was a missing fixture.
 *
 *  Weekday 09:00–17:00 matches the shape the manual pass describes a parent
 *  entering in S1 ("add each child and the regular hours they'll need your
 *  nanny"), and leaves room for flow 40 to WIDEN the window and produce a
 *  genuinely uncovered row. */
async function ensureCareHours(
  householdId: string,
  childId: string
): Promise<void> {
  const { data: existing } = await db
    .from('child_commitments')
    .select('id')
    .eq('child_id', childId)
    .eq('label', CARE_HOURS_LABEL)
    .maybeSingle();
  if (existing) {
    console.log('[skip]    care hours exist');
    return;
  }
  const { error } = await db.from('child_commitments').insert({
    child_id: childId,
    household_id: householdId,
    kind: 'other',
    label: CARE_HOURS_LABEL,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    start_time: '09:00',
    end_time: '17:00',
  });
  if (error) throw error;
  console.log(`[created] care hours ${CARE_HOURS_LABEL} weekday 09:00-17:00`);
}

/** Flow 20's fixture. A fresh `supabase db reset` drops it; the fixture seeders
 *  never touch it (different household), so it only needs creating once per
 *  reset. */
async function ensureNannyDraftHousehold(nannyId: string): Promise<string> {
  const { data: existing } = await db
    .from('households')
    .select('id')
    .eq('state', 'draft')
    .eq('created_by', nannyId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    console.log(`[skip]    nanny draft household exists -> ${existing.id}`);
    return existing.id;
  }

  const { data: created, error } = await db
    .from('households')
    .insert({
      name: null,
      state: 'draft',
      timezone: TIMEZONE,
      currency: 'USD',
      created_by: nannyId,
    })
    .select('id')
    .single();
  if (error) throw error;

  const { error: memberError } = await db.from('household_members').upsert(
    {
      household_id: created.id,
      user_id: nannyId,
      role: 'nanny',
      can_edit: false,
      status: 'active',
    },
    { onConflict: 'user_id,household_id' }
  );
  if (memberError) throw memberError;

  console.log(`[created] nanny draft household -> ${created.id}`);
  return created.id;
}

async function main(): Promise<void> {
  const parentId = await requireUser(PARENT_EMAIL);
  const nannyId = await requireUser(NANNY_EMAIL);
  console.log(`[found]   parent ${PARENT_EMAIL} -> ${parentId}`);
  console.log(`[found]   nanny  ${NANNY_EMAIL} -> ${nannyId}`);

  const coParentId = await requireUser(COPARENT_EMAIL);
  const householdId = await ensureOurHousehold(parentId, nannyId);
  await ensureMembers(householdId, parentId, nannyId, coParentId);
  const childId = await ensureChild(householdId);
  await ensureCareHours(householdId, childId);
  const draftHouseholdId = await ensureNannyDraftHousehold(nannyId);

  // Same contract as seed-phase4-fixtures.ts: everything above the marker is
  // human-readable progress, everything below is eval-able KEY=VALUE.
  console.log('\n# --- eval me (seed-launch-pass-bootstrap) ---');
  console.log(`PHASE4_HOUSEHOLD_ID=${householdId}`);
  console.log(`NANNY_DRAFT_HOUSEHOLD_ID=${draftHouseholdId}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
