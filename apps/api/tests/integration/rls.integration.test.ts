/**
 * RLS lockdown — against a REAL Postgres with REAL user JWTs (F-B10-2).
 *
 * Every other RLS "test" in this repo greps migration SQL text. This one is
 * the only thing that proves the policies actually behave: it mints real auth
 * users via the admin API, signs them in for real JWTs, and drives PostgREST
 * exactly the way an attacker with the bundled anon key would.
 *
 * NOT part of `bun run test` / `bun run qc` — those sweep `tests/unit` only,
 * so nothing in the normal gate needs a database. Run it explicitly:
 *
 *   supabase start && eval "$(supabase status -o env |
 *     sed 's/^API_URL=/SUPABASE_URL=/;s/^ANON_KEY=/SUPABASE_ANON_KEY=/;s/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_KEY=/' |
 *     sed 's/^/export /')"
 *   bun test tests/integration/rls.integration.test.ts
 *
 * CI runs it in the `db-migrations-and-rls` job after `supabase db reset`.
 *
 * ASSERTION SHAPE. RLS denies a write two different ways and denies a read a
 * third: INSERT without a policy errors (42501), UPDATE/DELETE without a
 * policy silently matches zero rows, and SELECT without a policy returns `[]`.
 * So every check here is "error set OR zero rows" — never returned data — and
 * every one is paired with a vacuity guard proving the row it targeted really
 * exists and really is reachable (the service client can see it; where the
 * actor has a read policy, the actor can see it too). Without that guard a
 * typo'd uuid would make all twelve pass.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  throw new Error(
    `rls.integration.test.ts needs a live Supabase stack: missing ${names.join(' / ')}.\n` +
      '  Start one with `supabase start`, then export SUPABASE_URL, SUPABASE_ANON_KEY\n' +
      '  and SUPABASE_SERVICE_KEY (SERVICE_ROLE_KEY) from `supabase status -o env`.'
  );
}

const SUPABASE_URL = requireEnv('SUPABASE_URL', 'API_URL');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY', 'ANON_KEY');
const SUPABASE_SERVICE_KEY = requireEnv(
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SERVICE_ROLE_KEY'
);

// LOCAL ONLY, and this guard is load-bearing. This file creates auth users and
// writes real rows. Bun auto-loads `apps/api/.env` for anything the shell did
// not already export, and that file points at the REMOTE project — so running
// this without exporting the local stack's env silently seeds and deletes rows
// in production. Refuse anything that is not loopback.
// `URL.hostname` keeps the brackets on an IPv6 literal, so `http://[::1]:54321`
// arrives as `[::1]` and would fail a bare `=== '::1'` — i.e. the guard would
// refuse a loopback host. Strip them before comparing.
const host = new URL(SUPABASE_URL).hostname.replace(/^\[|\]$/g, '');
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  throw new Error(
    `rls.integration.test.ts refuses to run against ${host}: it creates users and writes rows.\n` +
      '  Export the local stack first (see the header) — never a hosted project.'
  );
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = `Rls-${Math.random().toString(36).slice(2)}-9A!`;

interface SeedUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Creates a confirmed auth user + its `user_profiles` row, signs it in. */
async function createUser(label: string): Promise<SeedUser> {
  const email = `rls-${label}+${suffix}@example.test`;
  const { data: created, error: createErr } =
    await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
  if (createErr || !created.user) {
    throw new Error(`createUser(${label}) failed: ${createErr?.message}`);
  }
  const id = created.user.id;

  // No trigger backfills user_profiles; every household FK points at it.
  const { error: profileErr } = await service
    .from('user_profiles')
    .insert({ user_id: id, name: `RLS ${label}` });
  if (profileErr) {
    throw new Error(`user_profiles(${label}) failed: ${profileErr.message}`);
  }

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInErr } =
    await anon.auth.signInWithPassword({ email, password: PASSWORD });
  const token = session?.session?.access_token;
  if (signInErr || !token) {
    throw new Error(`signIn(${label}) failed: ${signInErr?.message}`);
  }

  return {
    id,
    email,
    client: createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  };
}

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

/** The service client bypasses RLS — proof the row a denial targeted exists. */
async function serviceSees(table: string, id: string): Promise<number> {
  const { data, error } = await service.from(table).select('id').eq('id', id);
  if (error) {
    throw new Error(`service select ${table} failed: ${error.message}`);
  }
  return (data ?? []).length;
}

/**
 * The one assertion every check funnels through: the caller either got an
 * explicit RLS error or affected/returned nothing. Data back = policy hole.
 */
function expectDenied(result: {
  data: unknown[] | null;
  error: { message: string } | null;
}): void {
  if (result.error) {
    expect(result.error.message).toBeTruthy();
    return;
  }
  expect(result.data ?? []).toHaveLength(0);
}

let p1: SeedUser;
let n1: SeedUser;
let c2: SeedUser;
let household1 = '';
let household2 = '';
let n1MembershipId = '';
let h1ShiftId = '';
let h1ChildId = '';
let n1TimeOffId = '';
let h2TimeEntryId = '';
let h2PtoLedgerId = '';
let h2ExpenseId = '';

beforeAll(async () => {
  p1 = await createUser('p1');
  n1 = await createUser('n1');
  c2 = await createUser('c2');

  household1 = await insertOne('households', {
    name: `RLS H1 ${suffix}`,
    created_by: p1.id,
  });
  household2 = await insertOne('households', {
    name: `RLS H2 ${suffix}`,
    created_by: c2.id,
  });

  await insertOne('household_members', {
    household_id: household1,
    user_id: p1.id,
    role: 'parent',
    can_edit: true,
  });
  n1MembershipId = await insertOne('household_members', {
    household_id: household1,
    user_id: n1.id,
    role: 'nanny',
  });
  await insertOne('household_members', {
    household_id: household2,
    user_id: c2.id,
    role: 'nanny',
  });

  h1ShiftId = await insertOne('shifts', {
    household_id: household1,
    carer_id: n1.id,
    starts_at: '2026-03-02T09:00:00Z',
    ends_at: '2026-03-02T17:00:00Z',
    timezone: 'Europe/London',
    local_date: '2026-03-02',
    status: 'confirmed',
  });
  h1ChildId = await insertOne('children', {
    household_id: household1,
    name: 'Seed Child',
  });
  n1TimeOffId = await insertOne('carer_time_off', {
    user_id: n1.id,
    starts_at: '2026-04-06T00:00:00Z',
    ends_at: '2026-04-10T00:00:00Z',
  });

  // Household 2's money rows — the tenant-isolation targets.
  h2TimeEntryId = await insertOne('time_entries', {
    household_id: household2,
    carer_id: c2.id,
    clock_in_at: '2026-03-03T09:00:00Z',
    clock_out_at: '2026-03-03T17:00:00Z',
    status: 'submitted',
    local_date: '2026-03-03',
    timezone: 'Europe/London',
    carer_display_name: 'RLS c2',
  });
  h2PtoLedgerId = await insertOne('pto_ledger', {
    household_id: household2,
    carer_id: c2.id,
    kind: 'accrual',
    minutes: 480,
    effective_date: '2026-03-03',
    carer_display_name: 'RLS c2',
  });
  h2ExpenseId = await insertOne('expenses', {
    household_id: household2,
    carer_id: c2.id,
    local_date: '2026-03-03',
    kind: 'expense',
    description: 'Seed expense',
    amount_minor: 1234,
    carer_display_name: 'RLS c2',
  });
});

afterAll(async () => {
  // Households first — they cascade shifts/children/time_entries/pto/expenses.
  for (const id of [household1, household2].filter(Boolean)) {
    await service.from('households').delete().eq('id', id);
  }
  if (n1TimeOffId) {
    await service.from('carer_time_off').delete().eq('id', n1TimeOffId);
  }
  for (const user of [p1, n1, c2]) {
    if (user?.id) {
      await service.auth.admin.deleteUser(user.id);
    }
  }
});

describe('RLS — a parent cannot write through PostgREST (049/052)', () => {
  test('P1 cannot escalate a membership role (F-B3-1 / I-43)', async () => {
    // Vacuity: P1 *can read* the row, so a denial here is the write policy.
    const readable = await p1.client
      .from('household_members')
      .select('id')
      .eq('id', n1MembershipId);
    expect(readable.data ?? []).toHaveLength(1);

    expectDenied(
      await p1.client
        .from('household_members')
        .update({ role: 'owner' })
        .eq('id', n1MembershipId)
        .select()
    );

    const { data } = await service
      .from('household_members')
      .select('role')
      .eq('id', n1MembershipId)
      .single();
    expect(data?.role).toBe('nanny');
  });

  test('P1 cannot INSERT a shift', async () => {
    expectDenied(
      await p1.client
        .from('shifts')
        .insert({
          household_id: household1,
          carer_id: n1.id,
          starts_at: '2026-03-09T09:00:00Z',
          ends_at: '2026-03-09T17:00:00Z',
          timezone: 'Europe/London',
          local_date: '2026-03-09',
        })
        .select()
    );
  });

  test('P1 cannot UPDATE a shift', async () => {
    const readable = await p1.client
      .from('shifts')
      .select('id')
      .eq('id', h1ShiftId);
    expect(readable.data ?? []).toHaveLength(1);

    expectDenied(
      await p1.client
        .from('shifts')
        .update({ status: 'cancelled', cancellation_paid: true })
        .eq('id', h1ShiftId)
        .select()
    );

    const { data } = await service
      .from('shifts')
      .select('status')
      .eq('id', h1ShiftId)
      .single();
    expect(data?.status).toBe('confirmed');
  });

  test('P1 cannot INSERT a schedule pattern', async () => {
    expectDenied(
      await p1.client
        .from('schedule_patterns')
        .insert({
          household_id: household1,
          carer_id: n1.id,
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          dtstart: '2026-03-02',
          timezone: 'Europe/London',
        })
        .select()
    );
  });

  test('P1 cannot UPDATE the household', async () => {
    const readable = await p1.client
      .from('households')
      .select('id')
      .eq('id', household1);
    expect(readable.data ?? []).toHaveLength(1);

    expectDenied(
      await p1.client
        .from('households')
        .update({ cancellation_paid_within_hours: 999 })
        .eq('id', household1)
        .select()
    );

    const { data } = await service
      .from('households')
      .select('cancellation_paid_within_hours')
      .eq('id', household1)
      .single();
    expect(data?.cancellation_paid_within_hours).toBe(24);
  });
});

describe('RLS — tenant isolation on the money tables (041/043/044)', () => {
  test("N1 cannot SELECT household 2's time entries", async () => {
    expect(await serviceSees('time_entries', h2TimeEntryId)).toBe(1);
    const { data, error } = await n1.client
      .from('time_entries')
      .select('*')
      .eq('id', h2TimeEntryId);
    expectDenied({ data, error });
  });

  test("N1 cannot SELECT household 2's PTO ledger", async () => {
    expect(await serviceSees('pto_ledger', h2PtoLedgerId)).toBe(1);
    const { data, error } = await n1.client
      .from('pto_ledger')
      .select('*')
      .eq('id', h2PtoLedgerId);
    expectDenied({ data, error });
  });

  test("N1 cannot SELECT household 2's expenses", async () => {
    expect(await serviceSees('expenses', h2ExpenseId)).toBe(1);
    const { data, error } = await n1.client
      .from('expenses')
      .select('*')
      .eq('id', h2ExpenseId);
    expectDenied({ data, error });
  });
});

describe('RLS — 052 closed the remaining client writes', () => {
  test('handoff notes are insert-locked even for a parent', async () => {
    expectDenied(
      await p1.client
        .from('handoff_notes')
        .insert({
          household_id: household1,
          local_date: '2026-03-02',
          author_id: p1.id,
          phase: 'morning',
          body: 'injected',
        })
        .select()
    );
  });

  test('children cannot be hard-deleted (soft-delete invariant)', async () => {
    const readable = await p1.client
      .from('children')
      .select('id')
      .eq('id', h1ChildId);
    expect(readable.data ?? []).toHaveLength(1);

    expectDenied(
      await p1.client.from('children').delete().eq('id', h1ChildId).select()
    );
    expect(await serviceSees('children', h1ChildId)).toBe(1);
  });

  test('a nanny cannot UPDATE children (the surviving policy is parent-only)', async () => {
    expectDenied(
      await n1.client
        .from('children')
        .update({ name: 'Renamed by nanny' })
        .eq('id', h1ChildId)
        .select()
    );

    const { data } = await service
      .from('children')
      .select('name')
      .eq('id', h1ChildId)
      .single();
    expect(data?.name).toBe('Seed Child');
  });

  test("N1 cannot UPDATE her own time off ('Write own time off' is gone)", async () => {
    const readable = await n1.client
      .from('carer_time_off')
      .select('id')
      .eq('id', n1TimeOffId);
    expect(readable.data ?? []).toHaveLength(1);

    expectDenied(
      await n1.client
        .from('carer_time_off')
        .update({ starts_at: '2026-04-01T00:00:00Z' })
        .eq('id', n1TimeOffId)
        .select()
    );

    const { data } = await service
      .from('carer_time_off')
      .select('starts_at')
      .eq('id', n1TimeOffId)
      .single();
    expect(new Date(data?.starts_at as string).toISOString()).toBe(
      '2026-04-06T00:00:00.000Z'
    );
  });
});
