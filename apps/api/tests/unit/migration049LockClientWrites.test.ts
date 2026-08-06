/**
 * @module tests/unit/migration049LockClientWrites.test
 * Pattern A — migration contract for `049_lock_client_writes.sql`.
 *
 * Written BEFORE the migration existed (the convention `migration045
 * PtoUsagePerDay.test.ts` states in its own header): this file was run RED
 * against a missing `049_lock_client_writes.sql` first, and only then was the
 * migration written to turn it green.
 *
 * 049 closes a privilege-escalation hole (audit F-B3-1, S0) and the direct
 * schedule-write hole beside it (F-B3-2, S1). Both exist because the
 * client-facing WRITE policies on the household and schedule tables are pure
 * attack surface: the API holds `SUPABASE_SERVICE_KEY`
 * (`apps/api/src/config/supabase.ts`), so RLS never applies to the API path
 * and every one of those policies is reachable ONLY by someone driving
 * PostgREST directly with the bundled anon key and their own JWT. `apps/mobile`
 * has zero `supabase.from(` calls — its only Supabase client is consumed by
 * `src/store/auth.ts` for `supabase.auth.*` alone — so removing them is a
 * deletion, not a redesign.
 *
 * What that surface bought an attacker, and why this is S0 rather than S1:
 * `"Parents can manage members"` was an unqualified `for update` on
 * `household_members` — no column list, no column-level revoke, no transition
 * CHECK, no trigger. A parent could PATCH `role` and promote a nanny to
 * parent; the API then trusts that column (`householdMemberRepository
 * .findActiveMembership` returns it verbatim, `timesheetCommandService
 * .assertWriteMember` gates on it), so the promoted carer approves her own
 * timesheet and freezes her own `gross_minor`.
 *
 * Three properties are pinned here:
 *
 *   1. **Every write policy on the eight tables is gone**, asserted not by
 *      reading 049 in isolation but by REPLAYING the whole migration history
 *      in order — every `create policy` sets, every `drop policy` clears — and
 *      checking the resulting end state. A test that only read 049's drop
 *      statements would pass while a policy this file forgot to name sat
 *      untouched in 015; the replay cannot miss one.
 *   2. **Every SELECT policy survives byte-for-byte.** These tables are read
 *      through PostgREST by nothing today, but the read model is not what is
 *      being changed and a silent narrowing here would be a regression with no
 *      failing test anywhere else. The replay compares each survivor's body
 *      against its pre-049 definition.
 *   3. **049 creates nothing and disables nothing.** The target shape is
 *      `041_pay_arrangements.sql` / `044_expenses.sql`: RLS enabled, exactly
 *      one `for select` policy, no write policy at all. RLS staying ON is what
 *      makes "no policy" mean "deny", so a stray `disable row level security`
 *      would inverse the entire migration.
 *
 * SQL parsing below is quote- and dollar-quote-aware, copied from
 * `migration044Expenses.test.ts` rather than imported — the helpers are not
 * exported there, and that file's own header records the copy as deliberate.
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '049_lock_client_writes.sql';

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
 * (the state 049 inherited), `'through'` includes it (the state 049 left
 * behind). Both are needed because the SELECT-drift check must attribute
 * changes to 049 SPECIFICALLY — comparing against today's end state instead
 * would fail this file whenever an unrelated later migration legitimately
 * touched some other table's read policy. Omit `bound` for the true end state,
 * which is what the select-only assertions want: a later migration handing a
 * write policy back to one of these eight tables SHOULD fail here.
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
// The contract: what 049 takes away, and what it must leave alone.
// ---------------------------------------------------------------------------

/**
 * The client-facing write policies, per table. `for all` counts as a write
 * policy — it covers INSERT/UPDATE/DELETE as well as SELECT, which is exactly
 * why `015_shifts.sql`'s header could claim "writes go through the API under
 * the service role" while the policy underneath it said otherwise.
 */
const DROPPED_WRITE_POLICIES: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  // F-B3-1 (S0) — the escalation path itself.
  ['public.household_members', ['Parents can manage members']],
  // Same open `for update` shape, widened in on re-verification.
  ['public.households', ['Parents can update their household']],
  // A parent could rewrite a pending invite's `role` before it was redeemed.
  ['public.household_invites', ['Parents can manage invites']],
  // F-B3-2 (S1) — direct schedule writes, bypassing shiftCommandService and
  // the co-parent approval gate.
  [
    'public.schedule_patterns',
    [
      'Parents can insert patterns',
      'Parents can update patterns',
      'Parents can delete patterns',
    ],
  ],
  ['public.schedule_pattern_days', ['Parents can write pattern days']],
  [
    'public.schedule_pattern_day_children',
    ['Parents can write pattern day children'],
  ],
  ['public.shifts', ['Parents can write shifts']],
  ['public.shift_children', ['Parents can write shift children']],
];

/** The one SELECT policy each locked table keeps — unchanged, verbatim. */
const PRESERVED_SELECT_POLICIES: ReadonlyArray<readonly [string, string]> = [
  ['public.households', 'Members can view their households'],
  ['public.household_members', 'Members can view co-members'],
  ['public.household_invites', 'Parents can view invites'],
  ['public.schedule_patterns', 'Members can view patterns'],
  ['public.schedule_pattern_days', 'Members can view pattern days'],
  [
    'public.schedule_pattern_day_children',
    'Members can view pattern day children',
  ],
  ['public.shifts', 'Members can view shifts'],
  ['public.shift_children', 'Members can view shift children'],
];

const LOCKED_TABLES = DROPPED_WRITE_POLICIES.map(([table]) => table);

describe('049_lock_client_writes.sql — drops every client write policy', () => {
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
    // Every named policy is accounted for, and none is dropped twice.
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

describe('049_lock_client_writes.sql — creates nothing, disables nothing', () => {
  // The whole migration is a deletion. Anything else in here is a redesign
  // nobody asked for, and a `create policy` would be a new attack surface
  // landing in the file whose job is to remove attack surface.
  it('creates no policy', () => {
    expect(executable).not.toContain('create policy');
  });

  it('creates no table, function, trigger or index', () => {
    expect(executable).not.toContain('create table');
    expect(executable).not.toContain('create or replace function');
    expect(executable).not.toContain('create trigger');
    expect(executable).not.toContain('create index');
  });

  // RLS staying ON is what makes "no policy" mean "deny". With RLS off, a
  // table with zero policies is WORLD-WRITABLE through PostgREST — the exact
  // inverse of this migration's intent.
  it('never disables row level security', () => {
    expect(executable).not.toContain('disable row level security');
  });

  // The repo controls PostgREST access through policies alone and relies on
  // Supabase's stock grants (041's grant note). 041 and 044 — the shape being
  // copied — issue no grant or revoke, so neither does this.
  it('issues no grant or revoke, matching the 041/044 grant model', () => {
    expect(executable).not.toContain('grant ');
    expect(executable).not.toContain('revoke ');
  });

  it('alters no table, so no column or constraint moves', () => {
    // `alter table ... enable row level security` would be harmless but
    // redundant (009/014/015 already enabled it on all eight); any OTHER
    // alter table in a lockdown migration is out of scope by construction.
    const alters = statements.filter(s => /^\s*alter\s+table/i.test(s));
    for (const alter of alters) {
      expect(alter.toLowerCase()).toContain('enable row level security');
    }
  });
});

describe('049_lock_client_writes.sql — end state after replaying all migrations', () => {
  // The load-bearing assertions. Reading 049's drop list proves only that 049
  // says what this test says; replaying the history proves the TABLES are
  // actually select-only afterwards, including any write policy this file
  // failed to name.
  const live = replayPolicies();

  for (const table of LOCKED_TABLES) {
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
        // A SELECT policy has no `with check` clause to give — its presence
        // would mean the policy was never really select-only.
        expect(body).not.toContain('with check');
      }
    });
  }

  it('leaves the eight tables in the same shape as 041/044: select-only', () => {
    const notSelectOnly = LOCKED_TABLES.filter(table => {
      const names = policiesOn(live, table);
      if (names.length !== 1) return true;
      const body = live.get(policyKey(table, names[0] ?? ''))?.body ?? '';
      return !/^for select\b/i.test(body);
    });
    expect(notSelectOnly).toEqual([]);
  });
});

describe('049_lock_client_writes.sql — every SELECT policy survives unchanged', () => {
  // Scoped to 049's own effect: the state it inherited vs the state it left.
  const before = replayPolicies({ file: MIGRATION, mode: 'before' });
  const after = replayPolicies({ file: MIGRATION, mode: 'through' });

  for (const [table, name] of PRESERVED_SELECT_POLICIES) {
    it(`keeps "${name}" on ${table}`, () => {
      expect(after.has(policyKey(table, name))).toBe(true);
    });

    it(`leaves "${name}" on ${table} byte-for-byte identical`, () => {
      const key = policyKey(table, name);
      expect(after.get(key)?.body).toBe(before.get(key)?.body);
      // Its definition still comes from where it always did — 049 did not
      // quietly recreate it under the same name with a different qual.
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
});

describe('049_lock_client_writes.sql — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // Why this is safe to delete outright.
    'service_key',
    'rls never applies to the api path',
    'supabase.from(',
    // The audit findings this closes, so the file is greppable from the audit.
    'f-b3-1',
    'f-b3-2',
    // The escalation itself, in concrete terms.
    'promote a nanny to parent',
    'approve her own',
    // `for all` is not a read policy — the trap that hid this in plain sight.
    'for all',
    // The shape being copied.
    'select-only',
    '041_pay_arrangements',
    '044_expenses',
    // What is deliberately NOT touched.
    'no select policy',
    // RLS must stay on for "no policy" to mean "deny".
    'world-writable',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
