/**
 * @module tests/unit/migration052LockRemainingClientWrites.test
 * Pattern A — migration contract for `052_lock_remaining_client_writes.sql`.
 *
 * Written BEFORE the migration existed, same discipline as
 * `migration049LockClientWrites.test.ts` and the convention
 * `migration045PtoUsagePerDay.test.ts` states in its own header.
 *
 * 052 finishes what 049 started. 049 closed the household and schedule write
 * surfaces (F-B3-1, F-B3-2); a full enumeration of what remained turned up
 * three more, one of them a tenant-isolation break the original audit missed.
 * The safety argument is unchanged and re-verified: the API runs on
 * SUPABASE_SERVICE_KEY so RLS never applies to the API path, and `apps/mobile`
 * has zero `supabase.from(` / `.rpc(` / `.storage` / `.channel` calls anywhere
 * — its only Supabase client is `src/store/auth.ts`, all `supabase.auth.*`.
 * Every policy dropped here is reachable only by driving PostgREST directly.
 *
 *   1. **`handoff_notes` UPDATE was a CROSS-TENANT write.** `"Authors or
 *      parents can update handoff notes"` had
 *      `can_write_household(household_id) or author_id = (select auth.uid())`
 *      in BOTH `using` and `with check`. The `with check` is satisfiable by
 *      the author arm ALONE, which says nothing about `household_id` — so the
 *      new row's household is unconstrained. `PATCH handoff_notes?id=eq.<my
 *      own note> {"household_id":"<a household I am not in>"}` passes USING
 *      (I authored the old row) and passes WITH CHECK (I still author the new
 *      one), landing my content in a stranger's household where their
 *      `Members can view handoff notes` renders it. The INSERT policy has the
 *      mirror defect: membership is checked, `author_id` is free, and 021's
 *      only trigger sets `updated_at` — so any member could post a note
 *      attributed to a parent.
 *   2. **`"Parents can delete children"` contradicted the schema's own
 *      invariant.** `010_children.sql` documents `archived_at` as a soft
 *      delete because "a child who leaves the arrangement must not vanish
 *      from last month's approved timesheet". The DELETE policy permitted a
 *      hard delete, cascading through `shift_children`,
 *      `schedule_pattern_day_children` and `child_commitments` and stripping
 *      children off historical shifts that back approved timesheets. The API
 *      only ever archives; PostgREST would delete.
 *   3. **`carer_time_off` `"Write own time off"` was `for all` and desynced
 *      the money ledger.** `apply_pto_correction` exists to lock
 *      `carer_time_off` FOR UPDATE and CAS the household's netted PTO total;
 *      a direct PATCH bypasses that lock and `reconcilePtoUsage` entirely,
 *      letting a carer move the dates of leave already paid out in
 *      `pto_ledger`. Its sibling `"Read own or shared time off"` is a
 *      separate SELECT policy, so select-only is reached by pure deletion —
 *      no policy needs recreating.
 *
 * `child_commitments` and `household_closures` are the same open shape at
 * lower stakes, simply missed by 049's scope.
 *
 * `children` IS A DELIBERATE PARTIAL and the one table here that does NOT end
 * up select-only: only its DELETE policy is dropped, because that is the one
 * with the documented invariant behind it. Its INSERT and UPDATE remain, and
 * `CHILDREN_REMAINING` below pins them so the asymmetry is visible and
 * deliberate rather than an oversight someone silently "fixes" later. Both are
 * `can_write_household(household_id)` on old AND new row, so neither is
 * cross-tenant the way handoff_notes was.
 *
 * SQL parsing is quote- and dollar-quote-aware, copied from
 * `migration049LockClientWrites.test.ts` rather than imported — the local
 * convention these migration contracts follow (see the note at
 * `migration044Expenses.test.ts:40-42`).
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '052_lock_remaining_client_writes.sql';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

// ---------------------------------------------------------------------------
// SQL parsing — `--` comments stripped, `'...'` and `$$ ... $$` respected, so a
// `;` inside a comment or a string does not split a statement in half.
// ---------------------------------------------------------------------------

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const newline = sql.indexOf('\n', i);
      i = newline === -1 ? sql.length : newline;
      continue;
    }
    if (sql.startsWith('$$', i)) {
      const close = sql.indexOf('$$', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    if (sql[i] === ';') {
      statements.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += sql[i];
    i += 1;
  }

  if (current.trim()) statements.push(current);
  return statements;
}

/** Layout-independent form: one space between tokens, none hugging parens. */
function normalise(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

const migrationSql = readMigration(MIGRATION);
const statements = splitStatements(migrationSql).map(normalise).filter(Boolean);
/** Executable SQL only — the header comment is deliberately excluded. */
const executable = statements.join('; ').toLowerCase();

/** Only the `--` comment lines, lowercased — the documentation contract. */
const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

// ---------------------------------------------------------------------------
// Replaying the migration history
// ---------------------------------------------------------------------------

interface PolicyState {
  /** Everything after `on <table>`, normalised — `for select using (...)`. */
  body: string;
  /** Migration file the surviving definition came from. */
  source: string;
}

function policyKey(table: string, name: string): string {
  return `${table}::${name}`;
}

/** Every `.sql` file in the migrations dir, in lexicographic (= apply) order. */
function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort();
}

/**
 * Apply every `create policy` / `drop policy` in the repo's migrations, in
 * order, and return the policies still standing.
 *
 * `bound` limits the replay: `'before'` stops just short of the named file
 * (the state 052 inherited), `'through'` includes it (the state 052 left
 * behind). Both are needed so the SELECT-drift check attributes changes to
 * 052 SPECIFICALLY — comparing against today's end state would fail this file
 * whenever an unrelated later migration legitimately touched another table's
 * read policy. Omit `bound` for the true end state, which is what the
 * select-only assertions want: a later migration handing a write policy back
 * to one of these tables SHOULD fail here.
 */
function replayPolicies(bound?: {
  file: string;
  mode: 'before' | 'through';
}): Map<string, PolicyState> {
  const live = new Map<string, PolicyState>();

  for (const file of migrationFiles()) {
    if (bound?.mode === 'before' && file >= bound.file) break;
    if (bound?.mode === 'through' && file > bound.file) break;
    for (const statement of splitStatements(readMigration(file))) {
      const created = statement.match(
        /^\s*create\s+policy\s+"([^"]+)"\s+on\s+([\w.]+)([\s\S]*)$/i
      );
      if (created) {
        live.set(policyKey(created[2] ?? '', created[1] ?? ''), {
          body: normalise(created[3] ?? ''),
          source: file,
        });
        continue;
      }
      const dropped = statement.match(
        /^\s*drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+([\w.]+)\s*$/i
      );
      if (dropped) live.delete(policyKey(dropped[2] ?? '', dropped[1] ?? ''));
    }
  }

  return live;
}

function policiesOn(live: Map<string, PolicyState>, table: string): string[] {
  return [...live.keys()]
    .filter(key => key.startsWith(`${table}::`))
    .map(key => key.slice(table.length + 2))
    .sort();
}

// ---------------------------------------------------------------------------
// The contract: what 052 takes away, and what it must leave alone.
// ---------------------------------------------------------------------------

const DROPPED_WRITE_POLICIES: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  // 1. Cross-tenant write + forgeable author_id.
  [
    'public.handoff_notes',
    [
      'Members can insert handoff notes',
      'Authors or parents can update handoff notes',
    ],
  ],
  // 2. Hard delete against a documented soft-delete invariant.
  ['public.children', ['Parents can delete children']],
  // 3. `for all`, bypassing apply_pto_correction's lock + CAS.
  ['public.carer_time_off', ['Write own time off']],
  // Same shape, lower stakes — missed by 049's scope.
  [
    'public.child_commitments',
    [
      'Parents can insert commitments',
      'Parents can update commitments',
      'Parents can delete commitments',
    ],
  ],
  [
    'public.household_closures',
    [
      'Parents can insert household closures',
      'Parents can update household closures',
      'Parents can delete household closures',
    ],
  ],
];

/** The SELECT policy each table keeps — unchanged, verbatim. */
const PRESERVED_SELECT_POLICIES: ReadonlyArray<readonly [string, string]> = [
  ['public.handoff_notes', 'Members can view handoff notes'],
  ['public.children', 'Members can view children'],
  ['public.carer_time_off', 'Read own or shared time off'],
  ['public.child_commitments', 'Members can view commitments'],
  ['public.household_closures', 'Members can view household closures'],
];

/** Tables 052 leaves fully select-only. `children` is deliberately not one. */
const SELECT_ONLY_AFTER = [
  'public.handoff_notes',
  'public.carer_time_off',
  'public.child_commitments',
  'public.household_closures',
] as const;

/**
 * `children` keeps INSERT and UPDATE by design — only the DELETE policy had a
 * documented invariant behind it. Pinned so the partial scope is visible and
 * cannot drift silently in either direction.
 */
const CHILDREN_REMAINING = [
  'Members can view children',
  'Parents can insert children',
  'Parents can update children',
] as const;

describe('052_lock_remaining_client_writes.sql — drops every named write policy', () => {
  for (const [table, names] of DROPPED_WRITE_POLICIES) {
    for (const name of names) {
      it(`drops "${name}" on ${table}`, () => {
        expect(executable).toContain(
          `drop policy if exists "${name}" on ${table}`.toLowerCase()
        );
      });
    }
  }

  it('drops nothing but those policies', () => {
    const expected = new Set(
      DROPPED_WRITE_POLICIES.flatMap(([table, names]) =>
        names.map(name => policyKey(table, name))
      )
    );

    const actual = statements
      .map(s =>
        s.match(
          /^\s*drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+([\w.]+)\s*$/i
        )
      )
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => policyKey(m[2] ?? '', m[1] ?? ''));

    expect(actual.filter(key => !expected.has(key))).toEqual([]);
    expect(new Set(actual).size).toBe(actual.length);
    expect(new Set(actual)).toEqual(expected);
  });

  it('uses the `if exists` form, the house idempotency pattern', () => {
    const drops = statements.filter(s => /^\s*drop\s+policy/i.test(s));
    expect(drops.length).toBeGreaterThan(0);
    for (const drop of drops) {
      expect(drop.toLowerCase()).toContain('drop policy if exists');
    }
  });
});

describe('052_lock_remaining_client_writes.sql — creates nothing, disables nothing', () => {
  it('creates no policy', () => {
    expect(executable).not.toContain('create policy');
  });

  it('creates no table, function, trigger or index', () => {
    expect(executable).not.toContain('create table');
    expect(executable).not.toContain('create or replace function');
    expect(executable).not.toContain('create trigger');
    expect(executable).not.toContain('create index');
  });

  // With RLS off, a table with zero policies is world-writable through
  // PostgREST — the exact inverse of this file's intent.
  it('never disables row level security', () => {
    expect(executable).not.toContain('disable row level security');
  });

  it('issues no grant or revoke, matching the 041/044 grant model', () => {
    expect(executable).not.toContain('grant ');
    expect(executable).not.toContain('revoke ');
  });

  it('alters no table beyond re-asserting RLS', () => {
    const alters = statements.filter(s => /^\s*alter\s+table/i.test(s));
    for (const alter of alters) {
      expect(alter.toLowerCase()).toContain('enable row level security');
    }
  });
});

describe('052_lock_remaining_client_writes.sql — end state after replaying all migrations', () => {
  const live = replayPolicies();

  for (const table of SELECT_ONLY_AFTER) {
    it(`leaves exactly one policy on ${table}`, () => {
      expect(policiesOn(live, table)).toHaveLength(1);
    });

    it(`leaves only a SELECT policy on ${table}`, () => {
      for (const name of policiesOn(live, table)) {
        const body = live.get(policyKey(table, name))?.body.toLowerCase() ?? '';
        expect(body).toContain('for select');
        expect(body).not.toContain('for all');
        expect(body).not.toContain('for insert');
        expect(body).not.toContain('for update');
        expect(body).not.toContain('for delete');
        expect(body).not.toContain('with check');
      }
    });
  }

  // The deliberate partial, pinned in both directions.
  it('leaves children with exactly its view, insert and update policies', () => {
    expect(policiesOn(live, 'public.children')).toEqual(
      [...CHILDREN_REMAINING].sort()
    );
  });

  it('leaves no DELETE policy on children — the soft-delete invariant', () => {
    for (const name of policiesOn(live, 'public.children')) {
      const body =
        live.get(policyKey('public.children', name))?.body.toLowerCase() ?? '';
      expect(body).not.toContain('for delete');
      expect(body).not.toContain('for all');
    }
  });

  // 049's eight tables must still be select-only — 052 must not regress them.
  it('leaves 049’s eight tables select-only', () => {
    const locked049 = [
      'public.households',
      'public.household_members',
      'public.household_invites',
      'public.schedule_patterns',
      'public.schedule_pattern_days',
      'public.schedule_pattern_day_children',
      'public.shifts',
      'public.shift_children',
    ];
    const broken = locked049.filter(table => {
      const names = policiesOn(live, table);
      if (names.length !== 1) return true;
      const body = live.get(policyKey(table, names[0] ?? ''))?.body ?? '';
      return !/^for select\b/i.test(body);
    });
    expect(broken).toEqual([]);
  });
});

describe('052_lock_remaining_client_writes.sql — every SELECT policy survives unchanged', () => {
  // Scoped to 052's own effect: the state it inherited vs the state it left.
  const before = replayPolicies({ file: MIGRATION, mode: 'before' });
  const after = replayPolicies({ file: MIGRATION, mode: 'through' });

  for (const [table, name] of PRESERVED_SELECT_POLICIES) {
    it(`keeps "${name}" on ${table}`, () => {
      expect(after.has(policyKey(table, name))).toBe(true);
    });

    it(`leaves "${name}" on ${table} byte-for-byte identical`, () => {
      const key = policyKey(table, name);
      expect(after.get(key)?.body).toBe(before.get(key)?.body);
      expect(after.get(key)?.source).toBe(before.get(key)?.source);
    });
  }

  it('changes no SELECT policy anywhere in the schema, not just on these tables', () => {
    const drift: string[] = [];
    for (const [key, state] of before) {
      if (!/^for select\b/i.test(state.body)) continue;
      const current = after.get(key);
      if (!current) drift.push(`${key} — removed`);
      else if (current.body !== state.body) drift.push(`${key} — rewritten`);
    }
    expect(drift).toEqual([]);
  });

  // carer_time_off is the one table where the surviving read policy is NOT a
  // household predicate — it is person-scoped, and a carer must keep seeing
  // her own leave. Dropping the wrong one of the pair would silently blind her.
  it('keeps carer_time_off readable by its owner and household co-members', () => {
    const body = after.get(
      policyKey('public.carer_time_off', 'Read own or shared time off')
    )?.body;
    expect(body).toContain('(select auth.uid()) = user_id');
    expect(body).toContain('private.shares_household_with(user_id)');
  });
});

describe('052_lock_remaining_client_writes.sql — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // Why deleting these is safe.
    'service_key',
    'supabase.from(',
    // 1 — the new S1 the original audit missed.
    'cross-tenant',
    'author_id',
    'with check',
    // 2 — the soft-delete invariant and what a hard delete destroys.
    'soft delete',
    'approved timesheet',
    // 3 — the ledger desync.
    'apply_pto_correction',
    'pto_ledger',
    // The shape being copied, and the one table that deliberately misses it.
    'select-only',
    'deliberate partial',
    // RLS must stay on for "no policy" to mean "deny".
    'world-writable',
    // Reads unchanged.
    'no select policy',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
