#!/usr/bin/env bun
/**
 * Seed two confirmed test accounts (parent + nanny) via the Supabase Admin API,
 * so end-to-end simulator runs don't need an email round-trip.
 *
 * Idempotent: safe to run repeatedly. Looks each user up by email first and
 * skips/updates rather than erroring on duplicate creation.
 *
 * Deliberately does NOT create households, children, invites, or schedules —
 * those must be created through the app during the e2e test itself.
 *
 * Usage: bun run scripts/seed-test-users.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const TEST_PASSWORD = 'SteadilyTest!2026';
const TIMEZONE = 'Europe/London';

const TEST_USERS = [
  { email: 'parent@steadilynanny.test', name: 'Test Parent' },
  { email: 'nanny@steadilynanny.test', name: 'Test Nanny' },
] as const;

function loadEnvFile(path: string): Record<string, string> {
  const raw = readFileSync(path, 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
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

async function main() {
  const envPath = join(import.meta.dir, '..', 'apps', 'api', '.env');
  if (!existsSync(envPath)) {
    throw new Error(`Missing env file: ${envPath}`);
  }
  const env = loadEnvFile(envPath);
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_KEY missing from apps/api/.env'
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Build a full email -> user map by paging through listUsers (used for idempotency).
  const existingByEmail = new Map<string, { id: string; email: string }>();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      if (u.email) existingByEmail.set(u.email, { id: u.id, email: u.email });
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  const seededIds = new Map<string, string>();

  for (const testUser of TEST_USERS) {
    let userId: string;
    const existing = existingByEmail.get(testUser.email);

    if (existing) {
      userId = existing.id;
      console.log(
        `[skip] auth user already exists: ${testUser.email} (${userId})`
      );
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: testUser.email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(
          `createUser failed for ${testUser.email}: ${error?.message}`
        );
      }
      userId = data.user.id;
      console.log(`[created] auth user: ${testUser.email} (${userId})`);
    }
    seededIds.set(testUser.email, userId);

    // user_device_info and every household table FK to public.user_profiles,
    // NOT auth.users — the profile row must exist before any later insert
    // (see supabase/migrations/003_user_device_info.sql and GOLDEN-FIXES.md #7).
    const { error: profileError } = await supabase
      .from('user_profiles')
      .upsert(
        { user_id: userId, name: testUser.name, timezone: TIMEZONE },
        { onConflict: 'user_id' }
      );
    if (profileError) {
      throw new Error(
        `user_profiles upsert failed for ${testUser.email}: ${profileError.message}`
      );
    }
    console.log(`[ok] user_profiles row present: ${testUser.email}`);
  }

  console.log(
    '\nDone. Seeded users (password is the same for both, not printed here):'
  );
  for (const testUser of TEST_USERS) {
    console.log(`  ${testUser.email} -> ${seededIds.get(testUser.email)}`);
  }
}

main().catch(err => {
  console.error(
    'seed-test-users failed:',
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
