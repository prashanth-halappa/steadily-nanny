#!/usr/bin/env bun
/**
 * FALLBACK ONLY. Give the household's FIRST nanny a pay arrangement, when
 * `tests/07-terms-setup-and-ca-ot-week.yaml` could not be driven.
 *
 * READ THIS BEFORE RUNNING IT
 * Flow 07 drives `PaySetupScreen` through the real form and is the only thing
 * that proves that form works. This script makes flow 07 PERMANENTLY
 * unrunnable on this database, because `PaySetupScreen` redirects to
 * `/settings/pay` on mount the moment an arrangement exists. So running this
 * trades away that coverage. Only do it when flow 07 has already failed and
 * something downstream is blocked by the missing arrangement.
 *
 * WHY IT WAS NEEDED (2026-08-21): flow 07 could not be completed. The
 * simulator's QuickType prediction bar was still rendering despite all three
 * documented `simctl … defaults write` keys verifying as `false`, and
 * `hideKeyboard` is a no-op on that screen (its own flow comments record this
 * for the date field). Taps aimed at fields landed on the keyboard instead;
 * the run died asserting `pay-setup-backdating-hint`, i.e. after the rate but
 * with the effective date never correctly entered.
 *
 * WHAT DEPENDS ON THE ARRANGEMENT EXISTING
 *   - the terms gate (`termsGateService.assertAgreed`) — clock-in,
 *     add-missed-hours and edit-entry all refuse without it
 *   - every priced week in S5 (flows 09/11/12 have nothing to price)
 *   - S3's separation assertion, which compares carer 1's rate against
 *     carer 2's (1500 vs 2250 minor — deliberately no shared digits)
 *
 * £15.00/hr matches `PHASE4_HOURLY_RATE` so any flow that asserts the seeded
 * rate keeps asserting the same number flow 07 would have produced.
 *
 * Idempotent.
 *
 * Usage: bun run scripts/seed-carer1-terms.ts
 *
 * @module scripts/seed-carer1-terms
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl } from './localSupabaseGuard';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';

const RATE_MINOR = 1500;
const CARER_DISPLAY_NAME = 'Test Nanny';
const VALID_FROM = '2026-01-01';

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
  const nannyId = await findUserByEmail(NANNY_EMAIL);
  const parentId = await findUserByEmail(PARENT_EMAIL);
  if (!nannyId || !parentId) {
    console.error('Cast missing. Run scripts/seed-test-users.ts first.');
    process.exit(1);
  }

  const { data: candidates, error } = await db
    .from('households')
    .select('id, currency')
    .eq('name', HOUSEHOLD_NAME);
  if (error) throw error;

  let householdId: string | null = null;
  let currency = 'GBP';
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
      break;
    }
  }
  if (!householdId) {
    console.error(`No "${HOUSEHOLD_NAME}" with ${NANNY_EMAIL} as a member.`);
    process.exit(1);
  }

  const { data: existing } = await db
    .from('pay_arrangements')
    .select('id, rate_minor')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(
      `[skip]    carer 1 arrangement exists -> ${existing.id} (${existing.rate_minor} minor)`
    );
  } else {
    const { data: created, error: insertError } = await db
      .from('pay_arrangements')
      .insert({
        household_id: householdId,
        carer_id: nannyId,
        rate_minor: RATE_MINOR,
        currency,
        valid_from: VALID_FROM,
        carer_display_name: CARER_DISPLAY_NAME,
        created_by: parentId,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    console.log(
      `[created] carer 1 arrangement -> ${created.id} (${RATE_MINOR} minor ${currency})`
    );
    console.log(
      '[warn]    tests/07-terms-setup-and-ca-ot-week.yaml is now unrunnable ' +
        'on this database — PaySetupScreen redirects once an arrangement exists.'
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
