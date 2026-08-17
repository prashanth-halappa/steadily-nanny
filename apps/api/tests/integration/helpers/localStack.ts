/**
 * Shared plumbing for `apps/api/tests/integration/*.integration.test.ts`.
 *
 * Every file in this tier needs: env vars for a live Supabase stack, the
 * loopback guard that refuses anything that isn't `127.0.0.1`/`localhost`/
 * `::1` (GOLDEN-FIXES #26 — `bun` auto-loads `apps/api/.env`, which points at
 * the REMOTE project, for any var the shell didn't export), a service-role
 * client, an anon client, real auth users signed in for real JWTs, and a
 * household to put them in. Lifted out of `rls.integration.test.ts` so the
 * second integration file didn't reinvent it, and so a third one doesn't
 * either. See `docs/09-TESTING.md` for how to run this tier.
 *
 * Every exported client-builder calls the guard before constructing a
 * client — there is no path here that can reach a hosted project even if a
 * caller forgets to check.
 *
 * The guard is loaded via `createRequire` rather than a static `import`:
 * `apps/api/tsconfig.json` has no explicit `rootDir`, so `tsc` infers one
 * from every file the program's static import graph reaches, and a plain
 * `import` of a file outside `apps/api` (the repo-root `scripts/`) drags
 * that inference up past the package boundary — `tsc --noEmit` then fails
 * the whole package with TS6059 ("File X is not under rootDir Y"), since
 * `outDir` is set. `require()` is invisible to that graph, so the single
 * source of truth stays in `scripts/localSupabaseGuard.ts` without widening
 * `apps/api`'s rootDir.
 *
 * @module tests/integration/helpers/localStack
 */
import { createRequire } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const localRequire = createRequire(import.meta.url);
const { assertLocalSupabaseUrl } = localRequire(
  '../../../../../scripts/localSupabaseGuard'
) as {
  assertLocalSupabaseUrl: (supabaseUrl: string) => void;
};

export function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  throw new Error(
    `Integration tests need a live Supabase stack: missing ${names.join(' / ')}.\n` +
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

// LOCAL ONLY, and load-bearing: every function below creates real auth users
// and writes real rows. Refuse at module load, before any client exists.
assertLocalSupabaseUrl(SUPABASE_URL);

let cachedService: SupabaseClient | undefined;

/** The service-role client. Bypasses RLS. One instance per process. */
export function serviceClient(): SupabaseClient {
  if (!cachedService) {
    cachedService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedService;
}

/** A fresh anon-key client — used to sign in as a newly minted user. */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Per-process suffix (one per test FILE, since each runs in its own bun
// process — docs/09-TESTING.md §2) so parallel files/runs never collide on
// email or name uniqueness. Exported for callers seeding rows `createUser`/
// `withHousehold` don't cover (e.g. a second, hand-built household).
export const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = `Lst-${Math.random().toString(36).slice(2)}-9A!`;

export interface SeedUser {
  id: string;
  email: string;
  /** Anon-key client carrying this user's real JWT — drives PostgREST as they would. */
  client: SupabaseClient;
}

/** Creates a confirmed auth user + its `user_profiles` row, signs it in. */
export async function createUser(label: string): Promise<SeedUser> {
  const service = serviceClient();
  const email = `${label}+${suffix}@example.test`;
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
    .insert({ user_id: id, name: `Test ${label}` });
  if (profileErr) {
    throw new Error(`user_profiles(${label}) failed: ${profileErr.message}`);
  }

  const anon = anonClient();
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

/** Deletes auth users by id. Falsy/undefined ids are skipped, not errored. */
export async function deleteUsers(
  ids: Array<string | undefined | null>
): Promise<void> {
  const service = serviceClient();
  for (const id of ids) {
    if (id) {
      await service.auth.admin.deleteUser(id);
    }
  }
}

/** Inserts one row through the service client and returns its `id`. */
export async function insertOne<T extends Record<string, unknown>>(
  table: string,
  row: T
): Promise<string> {
  const { data, error } = await serviceClient()
    .from(table)
    .insert(row)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seed ${table} failed: ${error?.message}`);
  }
  return data.id as string;
}

export interface HouseholdSeed {
  householdId: string;
  parent?: SeedUser;
  nannies: SeedUser[];
  helpers: SeedUser[];
  /** `household_members.id` for each seeded member, keyed by the label passed in. */
  membershipIds: Record<string, string>;
}

export interface WithHouseholdOptions {
  /** Creates a user with this label, makes them the household creator, role 'parent', can_edit. */
  parentLabel?: string;
  /** Creates one user per label, role 'nanny'. */
  nannyLabels?: string[];
  /** Creates one user per label, role 'helper'. */
  helperLabels?: string[];
  householdName?: string;
}

/**
 * Seeds a household plus its members, each minted through `createUser`. If
 * `parentLabel` is omitted the household is created by its first nanny/helper
 * instead (rls.integration.test.ts's household 2: a lone-nanny tenant with no
 * parent, used only as an isolation target — not every seeded household needs
 * a parent). Membership ids are returned keyed by label so a caller that needs
 * to mutate a specific membership (e.g. a role-escalation attempt) doesn't have
 * to re-query for it.
 */
export async function withHousehold(
  options: WithHouseholdOptions
): Promise<HouseholdSeed> {
  const {
    parentLabel,
    nannyLabels = [],
    helperLabels = [],
    householdName,
  } = options;

  const parent = parentLabel ? await createUser(parentLabel) : undefined;
  // Zipped with their label up front, rather than indexing `nannyLabels[i]`
  // back into `nannies[i]` below — that pairing is `T | undefined` under
  // `noUncheckedIndexedAccess`, and index arithmetic has no business
  // surviving two separate arrays when a tuple says it once.
  const nannyEntries = await Promise.all(
    nannyLabels.map(async label => [label, await createUser(label)] as const)
  );
  const helperEntries = await Promise.all(
    helperLabels.map(async label => [label, await createUser(label)] as const)
  );
  const nannies = nannyEntries.map(([, user]) => user);
  const helpers = helperEntries.map(([, user]) => user);

  const creator = parent ?? nannies[0] ?? helpers[0];
  if (!creator) {
    throw new Error(
      'withHousehold needs at least one of parentLabel/nannyLabels/helperLabels'
    );
  }

  const householdId = await insertOne('households', {
    name: householdName ?? `Integration H ${suffix}`,
    created_by: creator.id,
  });

  const membershipIds: Record<string, string> = {};
  if (parent && parentLabel) {
    membershipIds[parentLabel] = await insertOne('household_members', {
      household_id: householdId,
      user_id: parent.id,
      role: 'parent',
      can_edit: true,
    });
  }
  for (const [label, user] of nannyEntries) {
    membershipIds[label] = await insertOne('household_members', {
      household_id: householdId,
      user_id: user.id,
      role: 'nanny',
    });
  }
  for (const [label, user] of helperEntries) {
    membershipIds[label] = await insertOne('household_members', {
      household_id: householdId,
      user_id: user.id,
      role: 'helper',
    });
  }

  return { householdId, parent, nannies, helpers, membershipIds };
}
