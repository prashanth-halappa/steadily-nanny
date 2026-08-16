/**
 * @module tests/integration/timesheetParentViewed.integration.test
 *
 * Proves migration 100's timesheets-own `updated_at` trigger against a REAL
 * Postgres: a `parent_viewed_at`-only write must not bump `updated_at`
 * (otherwise `approveSubmittedWithEarnings`'s compare-and-swap loses), a
 * `total_minutes` write still bumps, and a second stamp guarded by
 * `.is('parent_viewed_at', null)` matches no rows.
 *
 * NOT part of `bun run test` / `bun run qc` — those sweep `tests/unit` only.
 * Run it explicitly:
 *
 *   supabase start && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/timesheetParentViewed.integration.test.ts
 *
 * CI runs it in the `db-migrations-and-rls` job after the RLS file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createClient } from '@supabase/supabase-js';

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  throw new Error(
    `timesheetParentViewed.integration.test.ts needs a live Supabase stack: missing ${names.join(' / ')}.\n` +
      '  Start one with `supabase start`, then export SUPABASE_URL, SUPABASE_ANON_KEY\n' +
      '  and SUPABASE_SERVICE_KEY (SERVICE_ROLE_KEY) from `supabase status -o env`.'
  );
}

const SUPABASE_URL = requireEnv('SUPABASE_URL', 'API_URL');
const SUPABASE_SERVICE_KEY = requireEnv(
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SERVICE_ROLE_KEY'
);

// LOCAL ONLY, and this guard is load-bearing. Bun auto-loads `apps/api/.env`
// for anything the shell did not already export, and that file points at the
// REMOTE project. Refuse anything that is not loopback.
const host = new URL(SUPABASE_URL).hostname.replace(/^\[|\]$/g, '');
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  throw new Error(
    `timesheetParentViewed.integration.test.ts refuses to run against ${host}: it writes rows.\n` +
      '  Export the local stack first (see the header) — never a hosted project.'
  );
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = `Viewed-${Math.random().toString(36).slice(2)}-9A!`;

const VIEWED_AT = '2026-08-16T12:00:00.000Z';

let parentId = '';
let carerId = '';
let householdId = '';
let timesheetId = '';

async function insertOne<T extends Record<string, unknown>>(
  table: string,
  row: T
): Promise<string> {
  const { data, error } = await service
    .from(table)
    .insert(row)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seed ${table} failed: ${error?.message}`);
  }
  return data.id as string;
}

async function readTimesheet(): Promise<{
  updated_at: string;
  parent_viewed_at: string | null;
  total_minutes: number;
  status: string;
}> {
  const { data, error } = await service
    .from('timesheets')
    .select('updated_at, parent_viewed_at, total_minutes, status')
    .eq('id', timesheetId)
    .single();
  if (error || !data) {
    throw new Error(`read timesheet failed: ${error?.message}`);
  }
  return data as {
    updated_at: string;
    parent_viewed_at: string | null;
    total_minutes: number;
    status: string;
  };
}

beforeAll(async () => {
  const parentEmail = `viewed-parent+${suffix}@example.test`;
  const carerEmail = `viewed-carer+${suffix}@example.test`;

  const { data: parentCreated, error: parentErr } =
    await service.auth.admin.createUser({
      email: parentEmail,
      password: PASSWORD,
      email_confirm: true,
    });
  if (parentErr || !parentCreated.user) {
    throw new Error(`createUser(parent) failed: ${parentErr?.message}`);
  }
  parentId = parentCreated.user.id;

  const { data: carerCreated, error: carerErr } =
    await service.auth.admin.createUser({
      email: carerEmail,
      password: PASSWORD,
      email_confirm: true,
    });
  if (carerErr || !carerCreated.user) {
    throw new Error(`createUser(carer) failed: ${carerErr?.message}`);
  }
  carerId = carerCreated.user.id;

  const { error: parentProfileErr } = await service
    .from('user_profiles')
    .insert({ user_id: parentId, name: 'Viewed Parent' });
  if (parentProfileErr) {
    throw new Error(
      `user_profiles(parent) failed: ${parentProfileErr.message}`
    );
  }
  const { error: carerProfileErr } = await service
    .from('user_profiles')
    .insert({ user_id: carerId, name: 'Viewed Carer' });
  if (carerProfileErr) {
    throw new Error(`user_profiles(carer) failed: ${carerProfileErr.message}`);
  }

  householdId = await insertOne('households', {
    name: `Viewed H ${suffix}`,
    created_by: parentId,
  });
  await insertOne('household_members', {
    household_id: householdId,
    user_id: parentId,
    role: 'parent',
    can_edit: true,
  });
  await insertOne('household_members', {
    household_id: householdId,
    user_id: carerId,
    role: 'nanny',
  });

  timesheetId = await insertOne('timesheets', {
    household_id: householdId,
    carer_id: carerId,
    carer_display_name: 'Viewed Carer',
    week_start: '2026-08-03',
    total_minutes: 480,
    status: 'submitted',
  });
});

afterAll(async () => {
  if (householdId) {
    await service.from('households').delete().eq('id', householdId);
  }
  for (const id of [parentId, carerId].filter(Boolean)) {
    await service.auth.admin.deleteUser(id);
  }
});

describe('100 — timesheets parent_viewed_at trigger (live Postgres)', () => {
  it('an update of only parent_viewed_at leaves updated_at unchanged', async () => {
    const before = await readTimesheet();

    const { error } = await service
      .from('timesheets')
      .update({ parent_viewed_at: VIEWED_AT })
      .eq('id', timesheetId);
    if (error) {
      throw new Error(`viewed stamp failed: ${error.message}`);
    }

    const after = await readTimesheet();
    expect(after.parent_viewed_at).not.toBeNull();
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('an update of total_minutes still bumps updated_at and keeps parent_viewed_at', async () => {
    const before = await readTimesheet();
    expect(before.parent_viewed_at).not.toBeNull();

    const { error } = await service
      .from('timesheets')
      .update({ total_minutes: 540 })
      .eq('id', timesheetId);
    if (error) {
      throw new Error(`minutes bump failed: ${error.message}`);
    }

    const after = await readTimesheet();
    expect(after.total_minutes).toBe(540);
    expect(after.parent_viewed_at).not.toBeNull();
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('the approve compare-and-swap still matches after a viewed stamp', async () => {
    const { data: reset, error: resetErr } = await service
      .from('timesheets')
      .update({
        parent_viewed_at: null,
        status: 'submitted',
        total_minutes: 480,
      })
      .eq('id', timesheetId)
      .select('updated_at')
      .single();
    if (resetErr || !reset) {
      throw new Error(`reset failed: ${resetErr?.message}`);
    }
    const version = reset.updated_at as string;

    const { error: stampErr } = await service
      .from('timesheets')
      .update({ parent_viewed_at: VIEWED_AT })
      .eq('id', timesheetId);
    if (stampErr) {
      throw new Error(`CAS viewed stamp failed: ${stampErr.message}`);
    }

    const { data, error } = await service
      .from('timesheets')
      .update({ status: 'approved' })
      .eq('id', timesheetId)
      .eq('status', 'submitted')
      .eq('updated_at', version)
      .select('id')
      .maybeSingle();
    if (error) {
      throw new Error(`CAS approve failed: ${error.message}`);
    }
    expect(data).not.toBeNull();
    expect(data?.id).toBe(timesheetId);
  });

  it('a second stamp guarded by .is(parent_viewed_at, null) matches no rows', async () => {
    const { data: reset, error: resetErr } = await service
      .from('timesheets')
      .update({ parent_viewed_at: null, status: 'submitted' })
      .eq('id', timesheetId)
      .select('id')
      .single();
    if (resetErr || !reset) {
      throw new Error(`second-stamp reset failed: ${resetErr?.message}`);
    }

    const { error: firstErr } = await service
      .from('timesheets')
      .update({ parent_viewed_at: VIEWED_AT })
      .eq('id', timesheetId)
      .is('parent_viewed_at', null);
    if (firstErr) {
      throw new Error(`first stamp failed: ${firstErr.message}`);
    }

    const { data, error } = await service
      .from('timesheets')
      .update({ parent_viewed_at: '2026-08-16T18:00:00.000Z' })
      .eq('id', timesheetId)
      .is('parent_viewed_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      throw new Error(`second stamp failed: ${error.message}`);
    }
    expect(data).toBeNull();

    const row = await readTimesheet();
    expect(row.parent_viewed_at).not.toBeNull();
  });
});
