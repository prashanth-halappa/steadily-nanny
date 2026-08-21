#!/usr/bin/env bun
/**
 * Give the household's SECOND nanny their own pay arrangement, at a
 * deliberately different rate from the first — AND give the FIRST nanny an
 * `accepted` schedule_pattern, so flow 33 has an already-settled usual week
 * to prove nanny 2's own handoff never touches.
 *
 * WHY SEEDED RATHER THAN DRIVEN
 * `PaySetupScreen` is drivable — flow 07 does it — but only at the cost of
 * roughly a hundred lines of keyboard-occlusion workarounds (that screen's
 * `hideKeyboard` is a no-op, and `scrollUntilVisible` no-ops too because
 * Maestro's visibility test is hierarchy-based, not occlusion-based). Flow 07
 * already proves the form works. What S3 needs proved is something else
 * entirely: that two carers' terms stay SEPARATE, and that one nanny can never
 * read the other's rate. Seeding the second arrangement puts the flow's
 * assertions on that claim instead of on a form that is already covered.
 *
 * Same reasoning for nanny 1's pattern: flow 21 already drives build -> send
 * -> accept end to end, through the real wizard. Flow 33 needs proved is
 * COEXISTENCE — that accepting a second carer's week never supersedes,
 * ends, or edits a different carer's already-accepted one — not the handoff
 * a second time. Written directly into `schedule_patterns` /
 * `schedule_pattern_days`, bypassing `schedulePatternCommandService`, the
 * same way this script's pay arrangement bypasses `PaySetupScreen`: no
 * `shifts` rows are materialised, because every screen this flow reads
 * (`SchedulePendingScreen`, `SchedulePatternBanner`, `NannyUsualWeekScreen`)
 * renders straight off `schedule_patterns`/`schedule_pattern_days`, never off
 * materialised shifts — see their own module headers.
 *
 * The rate is deliberately distinctive. £22.50 shares no digits with the
 * seeded £15.00, so a screenshot showing the wrong carer's rate is obvious
 * rather than plausible. Same idea for the two patterns' hours: nanny 1 is
 * Mon/Wed/Fri 08:00-14:00, nanny 2 (built live, in-flow) ends up on
 * Tue/Thu 09:00-17:00 — no shared start time, so a leaked or clobbered row
 * is obvious in a screenshot rather than plausible.
 *
 * PRECONDITION: nanny2@steadilynanny.test must already be an active member of
 * "Our household" — that is what flow 31 creates, through the app. This script
 * refuses rather than inventing the membership, because a membership conjured
 * here would make flow 31 untested and still look green.
 *
 * Idempotent. Run AFTER tests/31-second-nanny-joins.yaml.
 *
 * Usage: bun run scripts/seed-s3-second-carer.ts
 *
 * @module scripts/seed-s3-second-carer
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl } from './localSupabaseGuard';

const NANNY2_EMAIL = 'nanny2@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';

/** Shares no digits with the first carer's 1500, so a leak is unmistakable. */
const NANNY2_RATE_MINOR = 2250;
const NANNY2_DISPLAY_NAME = 'Sam Okafor';
const VALID_FROM = '2026-01-01';

// --- nanny 1's accepted usual week (flow 33's coexistence fixture) --------
/** A Monday, so the RRULE's own dtstart lines up with its first BYDAY. */
const NANNY1_PATTERN_DTSTART = '2026-01-05';
const NANNY1_PATTERN_RRULE = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR';
const NANNY1_PATTERN_DAYS = [1, 3, 5] as const; // Mon, Wed, Fri
const NANNY1_PATTERN_START = '08:00';
const NANNY1_PATTERN_END = '14:00';

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
const fileEnv = loadEnvFile(join(repoRoot, 'apps/api/.env'));
const url = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_KEY ?? fileEnv.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey || serviceKey.startsWith('SET-ME')) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — export them');
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

async function main(): Promise<void> {
  const nanny2Id = await findUserByEmail(NANNY2_EMAIL);
  const nannyId = await findUserByEmail(NANNY_EMAIL);
  const parentId = await findUserByEmail(PARENT_EMAIL);
  if (!nanny2Id || !nannyId || !parentId) {
    console.error('Cast missing. Run scripts/seed-test-users.ts first.');
    process.exit(1);
  }

  // Same disambiguation the fixture seeders use: name AND an active nanny
  // membership, so a stray same-named household is never adopted.
  const { data: candidates, error } = await db
    .from('households')
    .select('id, currency, timezone')
    .eq('name', HOUSEHOLD_NAME);
  if (error) throw error;

  let householdId: string | null = null;
  let currency = 'GBP';
  let timezone = 'UTC';
  for (const candidate of candidates ?? []) {
    const { data: m } = await db
      .from('household_members')
      .select('user_id')
      .eq('household_id', candidate.id)
      .eq('user_id', nannyId)
      .eq('status', 'active')
      .maybeSingle();
    if (m) {
      householdId = candidate.id;
      currency = candidate.currency ?? 'GBP';
      timezone = candidate.timezone ?? 'UTC';
      break;
    }
  }
  if (!householdId) {
    console.error(`No "${HOUSEHOLD_NAME}" with ${NANNY_EMAIL} as a member.`);
    process.exit(1);
  }

  // The membership is flow 31's output. Refuse rather than create it: a
  // membership conjured here would leave flow 31 untested and still green.
  const { data: membership } = await db
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('user_id', nanny2Id)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) {
    console.error(
      `${NANNY2_EMAIL} is not an active member of "${HOUSEHOLD_NAME}". ` +
        'Run tests/31-second-nanny-joins.yaml first — this script will not ' +
        'create the membership, because that is what flow 31 proves.'
    );
    process.exit(1);
  }

  const { data: existing } = await db
    .from('pay_arrangements')
    .select('id, rate_minor')
    .eq('household_id', householdId)
    .eq('carer_id', nanny2Id)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(
      `[skip]    nanny2 arrangement exists -> ${existing.id} (${existing.rate_minor} minor)`
    );
  } else {
    const { data: created, error: insertError } = await db
      .from('pay_arrangements')
      .insert({
        household_id: householdId,
        carer_id: nanny2Id,
        rate_minor: NANNY2_RATE_MINOR,
        currency,
        valid_from: VALID_FROM,
        carer_display_name: NANNY2_DISPLAY_NAME,
        created_by: parentId,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    console.log(
      `[created] nanny2 arrangement -> ${created.id} (${NANNY2_RATE_MINOR} minor ${currency})`
    );
  }

  // --- nanny 1's accepted usual week (flow 33's coexistence fixture) ------
  // Migration 104's `schedule_patterns_one_accepted_idx` allows exactly one
  // ACCEPTED row per (household, carer) — check first, so a second run of
  // this script (or a prior flow 21/25/33 pass against this SAME household)
  // never collides with it or leaves a duplicate for `resolveActivePattern`
  // to disambiguate.
  const { data: existingPattern } = await db
    .from('schedule_patterns')
    .select('id')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('status', 'accepted')
    .maybeSingle();

  let nanny1PatternId: string;
  if (existingPattern) {
    nanny1PatternId = existingPattern.id;
    console.log(
      `[skip]    nanny1 accepted pattern exists -> ${nanny1PatternId}`
    );
  } else {
    const { data: createdPattern, error: patternError } = await db
      .from('schedule_patterns')
      .insert({
        household_id: householdId,
        carer_id: nannyId,
        status: 'accepted',
        rrule: NANNY1_PATTERN_RRULE,
        dtstart: NANNY1_PATTERN_DTSTART,
        timezone,
        created_by: parentId,
        sent_at: new Date().toISOString(),
        responded_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (patternError) throw patternError;
    nanny1PatternId = createdPattern.id;

    // Written straight into `schedule_pattern_days` (see module header for
    // why: no screen this flow reads needs a materialised `shifts` row).
    const { error: daysError } = await db.from('schedule_pattern_days').insert(
      NANNY1_PATTERN_DAYS.map(weekday => ({
        pattern_id: nanny1PatternId,
        weekday,
        start_time: NANNY1_PATTERN_START,
        end_time: NANNY1_PATTERN_END,
      }))
    );
    if (daysError) throw daysError;
    console.log(
      `[created] nanny1 accepted pattern -> ${nanny1PatternId} ` +
        `(Mon/Wed/Fri ${NANNY1_PATTERN_START}-${NANNY1_PATTERN_END})`
    );
  }

  console.log('\n# --- eval me (seed-s3-second-carer) ---');
  console.log(`S3_HOUSEHOLD_ID=${householdId}`);
  console.log(`S3_NANNY2_ID=${nanny2Id}`);
  console.log(`S3_NANNY1_ID=${nannyId}`);
  console.log(`S3_NANNY2_RATE_MINOR=${NANNY2_RATE_MINOR}`);
  console.log(`S3_NANNY2_DISPLAY_NAME=${NANNY2_DISPLAY_NAME}`);
  console.log(`S3_NANNY1_PATTERN_ID=${nanny1PatternId}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
