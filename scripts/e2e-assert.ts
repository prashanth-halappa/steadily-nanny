#!/usr/bin/env bun
/**
 * Database-side assertions for the end-to-end simulator run.
 *
 * WHY THIS EXISTS
 * Maestro proves the UI did something. It cannot prove the right rows landed in
 * the right tables — a screen that renders "Invite code: R4K-92T" over an empty
 * `household_invites` table is a green test and a broken product. So every e2e
 * flow is asserted twice: once through the UI by Maestro, once here against the
 * live database.
 *
 * This half is deliberately independent of the UI. It has no knowledge of
 * testIDs, screens, or navigation, so it stays valid while the app is rewritten.
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_KEY from apps/api/.env at runtime.
 * Service role, so it bypasses RLS — that is correct here: these assertions must
 * observe ground truth, including rows the signed-in user could not see.
 *
 * Usage:
 *   bun run scripts/e2e-assert.ts <flow>
 *   bun run scripts/e2e-assert.ts all
 *
 * Flows: household, children, invite, membership, availability, pattern,
 *        shifts, anonymity, rls-parity
 *
 * Exits non-zero on the first failed assertion, so it can gate a CI step.
 *
 * The rls-parity section is the one part that cannot go through PostgREST:
 * `pg_policies` / `pg_proc` live in `pg_catalog`, which is not an exposed
 * schema. It therefore needs a direct Postgres connection and reads
 * SUPABASE_DB_URL (Supabase dashboard → Project Settings → Database →
 * Connection string) from apps/api/.env. Without it that section SKIPs;
 * everything else runs unchanged.
 *
 * @module scripts/e2e-assert
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { SQL } from 'bun';

const PARENT_EMAIL = 'parent@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';

// ---------------------------------------------------------------------------
// env + client
// ---------------------------------------------------------------------------

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
const env = loadEnvFile(join(repoRoot, 'apps/api/.env'));
const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in apps/api/.env');
  process.exit(1);
}
if (serviceKey.startsWith('SET-ME')) {
  console.error(
    'SUPABASE_SERVICE_KEY is still the placeholder. Fill it in from the Supabase dashboard.'
  );
  process.exit(1);
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// tiny assertion harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function userIdFor(email: string): Promise<string | null> {
  // listUsers is paged; these are the only users on a dev project, but page
  // explicitly rather than assuming page 1 holds everything.
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

// ---------------------------------------------------------------------------
// flow assertions
// ---------------------------------------------------------------------------

/** Flow 2 precondition: the parent created a household and owns it. */
async function assertHousehold(): Promise<string | null> {
  console.log('\nFlow: household created by the parent');
  const parentId = await userIdFor(PARENT_EMAIL);
  check('parent auth user exists', !!parentId);
  if (!parentId) return null;

  const { data: memberships } = await db
    .from('household_members')
    .select('household_id, role, status')
    .eq('user_id', parentId)
    .eq('status', 'active');

  check('parent has >= 1 active membership', (memberships?.length ?? 0) > 0);
  const owner = memberships?.find(m => m.role === 'owner');
  check('parent is OWNER of a household', !!owner);

  if (!owner) return null;

  // The orphan case the API is built to prevent: a household with no members is
  // unreachable by anyone. Worth asserting from the outside, not just in a unit
  // test, because `households.created_by` is ON DELETE SET NULL.
  const { data: allMembers } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', owner.household_id)
    .eq('status', 'active');
  check(
    'household has at least one active member (no orphan)',
    (allMembers?.length ?? 0) > 0
  );

  return owner.household_id;
}

/** Flow 2: children were added through the UI. */
async function assertChildren(householdId: string): Promise<void> {
  console.log('\nFlow: children added');
  const { data } = await db
    .from('children')
    .select('id, name, archived_at')
    .eq('household_id', householdId)
    .is('archived_at', null);

  check(
    'household has >= 1 child',
    (data?.length ?? 0) > 0,
    `found ${data?.length ?? 0}`
  );
  check(
    'every child has a non-empty name',
    (data ?? []).every(c => !!c.name?.trim())
  );
}

/** Flow 3: the parent generated an invite code. */
async function assertInvite(householdId: string): Promise<string | null> {
  console.log('\nFlow: invite code generated');
  const { data } = await db
    .from('household_invites')
    .select('code, role, status, expires_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });

  const invite = data?.[0];
  check('an invite row exists', !!invite);
  if (!invite) return null;

  // The alphabet deliberately excludes 0/O/1/I/L — this gets read aloud and
  // typed by hand, so an ambiguous glyph is a real support cost.
  check(
    `code matches XXX-XXX with no ambiguous glyphs (${invite.code})`,
    /^[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(invite.code) &&
      !/[01OIL]/.test(invite.code)
  );
  check('invite role is nanny', invite.role === 'nanny');
  check(
    'invite is not already expired',
    new Date(invite.expires_at) > new Date()
  );
  return invite.code;
}

/** Flow 4: the nanny redeemed the code and became a member. */
async function assertMembership(householdId: string): Promise<string | null> {
  console.log('\nFlow: nanny redeemed the invite');
  const nannyId = await userIdFor(NANNY_EMAIL);
  check('nanny auth user exists', !!nannyId);
  if (!nannyId) return null;

  const { data: membership } = await db
    .from('household_members')
    .select('role, status')
    .eq('household_id', householdId)
    .eq('user_id', nannyId)
    .maybeSingle();

  check(
    'nanny is an active member of the household',
    membership?.status === 'active'
  );
  check(
    'nanny joined with role=nanny (not parent/owner)',
    membership?.role === 'nanny'
  );

  // Redeeming twice must not create a second row — there is a unique index on
  // (user_id, household_id) and the API translates 23505 into a clean error.
  const { data: dupes } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('user_id', nannyId);
  check(
    'exactly one membership row (no double-redeem)',
    (dupes?.length ?? 0) === 1
  );

  const { data: invite } = await db
    .from('household_invites')
    .select('status, accepted_by')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  check('invite marked accepted', invite?.status === 'accepted');
  check('invite records who accepted it', invite?.accepted_by === nannyId);

  return nannyId;
}

/** Flow 5: the nanny set her availability. */
async function assertAvailability(nannyId: string): Promise<void> {
  console.log('\nFlow: nanny availability saved');
  const { data } = await db
    .from('carer_availability')
    .select('weekday, is_available, earliest_start, latest_finish')
    .eq('user_id', nannyId);

  check(
    'availability rows exist',
    (data?.length ?? 0) > 0,
    `found ${data?.length ?? 0}`
  );
  check(
    'weekdays are within 0..6',
    (data ?? []).every(r => r.weekday >= 0 && r.weekday <= 6)
  );
  check(
    'any available day has a finish after its start',
    (data ?? [])
      .filter(r => r.is_available && r.earliest_start && r.latest_finish)
      .every(r => (r.latest_finish as string) > (r.earliest_start as string))
  );
}

/** Flow 6: the parent sent a weekly pattern. */
async function assertPattern(householdId: string): Promise<string | null> {
  console.log('\nFlow: schedule pattern sent');
  const { data } = await db
    .from('schedule_patterns')
    .select('id, status, rrule, timezone, dtstart, sent_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });

  const pattern = data?.[0];
  check('a schedule pattern exists', !!pattern);
  if (!pattern) return null;

  check(
    `pattern is pending or accepted (is: ${pattern.status})`,
    pattern.status === 'pending' || pattern.status === 'accepted'
  );
  check('pattern carries a real RRULE', /FREQ=/.test(pattern.rrule ?? ''));
  check('pattern captured an IANA timezone', !!pattern.timezone?.includes('/'));
  check('pattern has been sent', !!pattern.sent_at);
  return pattern.id;
}

/** Flow 7: acceptance materialised shifts at the correct UTC instants. */
async function assertShifts(
  householdId: string,
  patternId: string
): Promise<void> {
  console.log('\nFlow: shifts materialised on acceptance');
  const { data } = await db
    .from('shifts')
    .select(
      'id, starts_at, ends_at, timezone, local_date, status, ical_uid, carer_id'
    )
    .eq('household_id', householdId)
    .eq('source_pattern_id', patternId)
    .order('starts_at');

  check(
    'shifts were materialised',
    (data?.length ?? 0) > 0,
    `found ${data?.length ?? 0}`
  );
  if (!data?.length) return;

  check(
    'every shift ends after it starts',
    data.every(s => s.ends_at > s.starts_at)
  );
  check(
    'every shift has a carer assigned',
    data.every(s => !!s.carer_id)
  );
  check(
    'every shift has a unique ical_uid',
    new Set(data.map(s => s.ical_uid)).size === data.length
  );

  // local_date is trigger-derived from starts_at in the shift's own timezone.
  // If it disagrees, the trigger did not fire and every day-grouped read is wrong.
  const mismatched = data.filter(s => {
    const local = new Date(s.starts_at).toLocaleDateString('en-CA', {
      timeZone: s.timezone,
    });
    return local !== s.local_date;
  });
  check(
    'local_date matches starts_at rendered in the shift timezone',
    mismatched.length === 0,
    mismatched.length ? `${mismatched.length} mismatched` : undefined
  );
}

/**
 * Flow 8: the cross-family anonymity promise.
 *
 * The product says a family may learn a carer is unavailable, never who she is
 * with. This asserts the floor from the database side: a second household's
 * shifts for the same carer must not be readable by the first household's
 * members, and the anonymised busy view must expose no identifying column.
 */
async function assertAnonymity(
  nannyId: string,
  knownHouseholdId: string
): Promise<void> {
  console.log('\nFlow: cross-family anonymity');

  const { data: view, error } = await db
    .from('v_busy_blocks')
    .select('*')
    .eq('user_id', nannyId)
    .limit(5);

  check('v_busy_blocks is queryable', !error, error?.message);

  const allowed = new Set([
    'user_id',
    'starts_at',
    'ends_at',
    'kind',
    'source_uid',
  ]);
  const leaked = new Set<string>();
  for (const row of view ?? []) {
    for (const key of Object.keys(row)) if (!allowed.has(key)) leaked.add(key);
  }
  check(
    'v_busy_blocks exposes no column beyond user_id/starts_at/ends_at/kind/source_uid',
    leaked.size === 0,
    leaked.size ? `leaked: ${[...leaked].join(', ')}` : undefined
  );

  // If the nanny works for more than one household, prove the busy view does not
  // reveal which. Skipped rather than silently passing when she only has one —
  // a test that cannot fail is not evidence.
  const { data: memberships } = await db
    .from('household_members')
    .select('household_id')
    .eq('user_id', nannyId)
    .eq('status', 'active');

  const others = (memberships ?? []).filter(
    m => m.household_id !== knownHouseholdId
  );
  if (others.length === 0) {
    console.log(
      '  SKIP  multi-household leak check — nanny belongs to only one household.'
    );
    console.log(
      '        Add her to a second household to make this assertion meaningful.'
    );
    return;
  }
  check(
    'busy rows carry no household reference at all',
    (view ?? []).every(r => !('household_id' in r) && !('household_name' in r))
  );
}

/**
 * Migrations 040 and 041: RLS semantic predicates, and the money-table read
 * rule that is the first thing built on top of them.
 *
 * 040 is a pure refactor — every policy that called
 * `private.is_household_member` / `private.is_household_parent` now calls the
 * semantic wrapper `private.can_read_household` / `private.can_write_household`
 * instead. `apps/api/tests/unit/migration040PolicyParity.test.ts` proves the
 * migration FILE is faithful; only a live database can prove it was actually
 * applied and that the grants landed.
 *
 * The grant assertions are not ceremony. A policy expression is evaluated with
 * the CALLER's privileges — SECURITY DEFINER changes who the function runs AS
 * once entered, it does not grant the right to enter it. A wrapper that
 * `authenticated` cannot EXECUTE turns every ordinary read into
 * `42501: permission denied for function can_read_household`: a 500, not an
 * empty result. That is the 012 incident (GOLDEN-FIXES.md #16), and repeating
 * it with new function names is exactly the way this refactor could go wrong.
 *
 * The 041 block at the end asserts the pay_arrangements read rule for the same
 * reason, one level up: a static test can only prove the migration FILE is
 * right, and the row a nanny must not see is not protected by a file.
 */
async function assertRlsSemanticParity(): Promise<void> {
  console.log('\nFlow: RLS semantic predicates (migrations 040, 041)');

  // Same source as every other credential this script uses: apps/api/.env.
  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.log(
      '  SKIP  pg_catalog assertions — no SUPABASE_DB_URL to connect with.'
    );
    console.log(
      '        pg_policies/pg_proc are not reachable through PostgREST. Add'
    );
    console.log(
      '        SUPABASE_DB_URL=<Project Settings → Database → Connection string>'
    );
    console.log('        to apps/api/.env to make these assertions run.');
    return;
  }

  interface WrapperRow {
    proname: string;
    prosecdef: boolean;
    provolatile: string;
    proconfig: string[] | null;
    anon_can_execute: boolean;
    authenticated_can_execute: boolean;
    service_role_can_execute: boolean;
  }
  interface StalePolicyRow {
    schemaname: string;
    tablename: string;
    policyname: string;
  }

  const sql = new SQL(dbUrl);
  try {
    const wrappers = (await sql`
      select p.proname,
             p.prosecdef,
             p.provolatile,
             p.proconfig,
             has_function_privilege('anon', p.oid, 'execute')
               as anon_can_execute,
             has_function_privilege('authenticated', p.oid, 'execute')
               as authenticated_can_execute,
             has_function_privilege('service_role', p.oid, 'execute')
               as service_role_can_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname in ('can_read_household', 'can_write_household')
    `) as WrapperRow[];

    for (const name of ['can_read_household', 'can_write_household']) {
      const fn = wrappers.find(w => w.proname === name);
      check(`private.${name} exists`, !!fn);
      if (!fn) continue;

      check(`private.${name} is SECURITY DEFINER`, fn.prosecdef === true);
      // 'i' immutable, 's' stable, 'v' volatile — 009's house style is stable.
      check(`private.${name} is STABLE`, fn.provolatile === 's');
      check(
        `private.${name} pins search_path to ''`,
        (fn.proconfig ?? []).includes('search_path='),
        `proconfig: ${JSON.stringify(fn.proconfig)}`
      );
      check(
        `private.${name} is EXECUTEable by anon/authenticated/service_role`,
        fn.anon_can_execute &&
          fn.authenticated_can_execute &&
          fn.service_role_can_execute,
        `anon=${fn.anon_can_execute} authenticated=${fn.authenticated_can_execute} service_role=${fn.service_role_can_execute}`
      );
    }

    const stale = (await sql`
      select schemaname, tablename, policyname
        from pg_policies
       where coalesce(qual, '') || ' ' || coalesce(with_check, '')
             like any (array['%is_household_member%', '%is_household_parent%'])
       order by tablename, policyname
    `) as StalePolicyRow[];

    check(
      'no policy still calls is_household_member/is_household_parent directly',
      stale.length === 0,
      stale.length
        ? stale.map(p => `${p.tablename}."${p.policyname}"`).join(', ')
        : undefined
    );

    // The mirror image: 040 must have left the repointed policies in place, not
    // merely dropped them. A dropped-and-not-recreated policy is a silent
    // lockout, and "zero rows" reads as "no data yet" in the UI.
    const repointed = (await sql`
      select count(*)::int as n
        from pg_policies
       where coalesce(qual, '') || ' ' || coalesce(with_check, '')
             like any (array['%can_read_household%', '%can_write_household%'])
    `) as { n: number }[];
    const repointedCount = repointed[0]?.n ?? 0;
    check(
      'all 38 household-scoped policies call a semantic wrapper',
      repointedCount === 38,
      `found ${repointedCount}`
    );

    // -----------------------------------------------------------------
    // Migration 041: pay_arrangements RLS.
    //
    // `migration041PayArrangements.test.ts` proves the FILE says the right
    // thing. Only the live catalog proves the file was applied and that the
    // policy Postgres actually stored is the one that was written — the
    // planner rewrites a qual on the way in, so "the SQL is right" and "the
    // policy is right" are two different claims.
    //
    // What this pins is a product rule, not a style: pay is readable by
    // parents/owners and by the carer for HER OWN rows. A helper, or a
    // second nanny, must not be able to read a rate straight off PostgREST
    // with her own JWT — `payArrangementQueryService` refuses her, and a
    // wider policy would make that refusal cosmetic. `can_read_household`
    // (every active member) and `is_household_member` are therefore
    // asserted ABSENT, not merely "not preferred".
    //
    // SKIPped, not failed, when the table isn't there yet: 041 is unapplied
    // on this branch, and a red line for "not deployed yet" trains people
    // to ignore the summary.
    // -----------------------------------------------------------------
    interface PolicyRow {
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
      rls_enabled: boolean;
    }

    const payPolicies = (await sql`
      select p.policyname,
             p.cmd,
             p.qual,
             p.with_check,
             c.relrowsecurity as rls_enabled
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_policies p
               on p.schemaname = n.nspname and p.tablename = c.relname
       where n.nspname = 'public'
         and c.relname = 'pay_arrangements'
    `) as PolicyRow[];

    if (payPolicies.length === 0) {
      console.log(
        '  SKIP  pay_arrangements RLS — table not present; 041 is not applied here.'
      );
    } else {
      check(
        'pay_arrangements has row level security enabled',
        payPolicies[0]?.rls_enabled === true
      );

      const policies = payPolicies.filter(p => !!p.policyname);
      check(
        'pay_arrangements has exactly one policy (select-only, service-role writes)',
        policies.length === 1,
        policies.length
          ? policies.map(p => `${p.cmd} "${p.policyname}"`).join(', ')
          : 'none'
      );

      const policy = policies[0];
      check('that policy is a SELECT policy', policy?.cmd === 'SELECT');
      check(
        'that policy has no WITH CHECK clause (nothing writes through RLS)',
        !policy?.with_check
      );

      const qual = policy?.qual ?? '';
      check(
        'pay read qual grants parents/owners via can_write_household',
        qual.includes('can_write_household'),
        `qual: ${qual || '(none)'}`
      );
      check(
        'pay read qual carries the carer self-arm (carer_id = auth.uid())',
        qual.includes('carer_id') && qual.includes('auth.uid()'),
        `qual: ${qual || '(none)'}`
      );
      check(
        'pay read qual does NOT grant every member via can_read_household',
        !qual.includes('can_read_household'),
        `qual: ${qual || '(none)'}`
      );
      check(
        'pay read qual does NOT call the pre-040 is_household_member helper',
        !qual.includes('is_household_member'),
        `qual: ${qual || '(none)'}`
      );
    }
  } catch (error) {
    check(
      'pg_catalog assertions ran',
      false,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flow = process.argv[2] ?? 'all';
  console.log(`e2e database assertions — ${flow}\n${'='.repeat(48)}`);

  // Schema-level, fixture-independent — runs before the early return below so
  // it is asserted even on a project with no seeded flow data.
  await assertRlsSemanticParity();

  const householdId = await assertHousehold();
  if (!householdId) {
    console.log('\nNo household yet — run the parent setup flow first.');
    summarise();
    return;
  }

  await assertChildren(householdId);
  await assertInvite(householdId);
  const nannyId = await assertMembership(householdId);
  if (nannyId) await assertAvailability(nannyId);

  const patternId = await assertPattern(householdId);
  if (patternId) await assertShifts(householdId, patternId);
  if (nannyId) await assertAnonymity(nannyId, householdId);

  summarise();
}

function summarise(): void {
  console.log(`\n${'='.repeat(48)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

await main();
