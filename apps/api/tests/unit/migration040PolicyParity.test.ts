/**
 * @module tests/unit/migration040PolicyParity.test
 * Pattern A — migration contract for `040_rls_semantic_predicates.sql`.
 *
 * 040 introduces the semantic wrapper predicates `private.can_read_household`
 * / `private.can_write_household` (pass-throughs over
 * `private.is_household_member` / `private.is_household_parent`) and repoints
 * every existing policy at them. It is a PURE REFACTOR: the only permitted
 * delta between a policy as written in its source migration and as recreated
 * in 040 is the helper's name.
 *
 * This test is the parity check that makes "zero behaviour change" checkable
 * without a live database. It parses the repo's own migration SQL, works out
 * the LATEST version of every policy that calls a household helper directly
 * (018 rewrote 017's `time_entries` / `timesheets` policies, so 018 — not 017
 * — is the source of truth for those two), and asserts 040 reproduces each one
 * verbatim modulo the rename.
 *
 * It also pins the three traps this repo has already paid for:
 *   - EXECUTE grants: a policy expression runs with the CALLER's privileges,
 *     so SECURITY DEFINER alone is not enough (009's grants section,
 *     012_fix_rls_helper_grants.sql, GOLDEN-FIXES.md #16).
 *   - `security definer` + `stable` + `set search_path = ''` (009 house style).
 *   - NO `(select ...)` around the helper calls. 018 deliberately left the
 *     household-helper calls bare — the initplan optimisation lives INSIDE the
 *     helpers, which take a per-row `household_id` and cannot be initplans.
 *     Wrapping them is a form that has never existed in this repo.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');

/**
 * Every migration that creates a policy calling a household helper directly,
 * oldest first. Order is load-bearing: a later file's rewrite of a policy
 * supersedes the earlier definition of the same (table, name).
 */
const SOURCE_MIGRATIONS = [
  '009_households.sql',
  '010_children.sql',
  '014_schedule_patterns.sql',
  '015_shifts.sql',
  '017_time_tracking.sql',
  '018_optimize_rls_initplan.sql',
  '021_handoff_notes.sql',
  '022_co_parent_approvals.sql',
  '035_household_closures.sql',
] as const;

const TARGET_MIGRATION = '040_rls_semantic_predicates.sql';

/** Policies calling a household helper, counted across SOURCE_MIGRATIONS. */
const EXPECTED_REPOINTED_POLICY_COUNT = 38;

const HELPER_CALL = /private\.is_household_(member|parent)\(/;

// ---------------------------------------------------------------------------
// SQL parsing — quote- and dollar-quote-aware, so a `;` inside a comment
// string (035) or a `$$ ... $$` function body (009, 040) does not split a
// statement in half.
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

interface PolicyStatement {
  /** Quoted policy name, e.g. `Members can view shifts`. */
  name: string;
  /** Schema-qualified table, e.g. `public.shifts`. */
  table: string;
  /** Everything after `on <table>`, normalised. */
  body: string;
  /** Migration file the definition came from. */
  source: string;
}

function policyKey(table: string, name: string): string {
  return `${table}::${name}`;
}

function parsePolicies(sql: string, source: string): PolicyStatement[] {
  const parsed: PolicyStatement[] = [];
  for (const statement of splitStatements(sql)) {
    const match = statement.match(
      /^\s*create\s+policy\s+"([^"]+)"\s+on\s+([\w.]+)([\s\S]*)$/i
    );
    if (!match) continue;
    parsed.push({
      name: match[1] ?? '',
      table: match[2] ?? '',
      body: normalise(match[3] ?? ''),
      source,
    });
  }
  return parsed;
}

function parseDroppedPolicies(sql: string): Set<string> {
  const dropped = new Set<string>();
  for (const statement of splitStatements(sql)) {
    const match = statement.match(
      /^\s*drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([\w.]+)\s*$/i
    );
    if (match) dropped.add(policyKey(match[2] ?? '', match[1] ?? ''));
  }
  return dropped;
}

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

/** The rename, and nothing else. */
function repoint(body: string): string {
  return body
    .replaceAll('private.is_household_member(', 'private.can_read_household(')
    .replaceAll('private.is_household_parent(', 'private.can_write_household(');
}

// ---------------------------------------------------------------------------
// The source of truth: latest definition wins.
// ---------------------------------------------------------------------------

function latestSourcePolicies(): PolicyStatement[] {
  const latest = new Map<string, PolicyStatement>();
  for (const file of SOURCE_MIGRATIONS) {
    for (const policy of parsePolicies(readMigration(file), file)) {
      latest.set(policyKey(policy.table, policy.name), policy);
    }
  }
  return [...latest.values()].filter(p => HELPER_CALL.test(p.body));
}

describe('040_rls_semantic_predicates.sql — policy parity', () => {
  it('finds every helper-scoped policy in the migration history', () => {
    const policies = latestSourcePolicies();
    expect(policies.length).toBe(EXPECTED_REPOINTED_POLICY_COUNT);
  });

  it('takes 018, not 017, as the source of truth for the rewritten policies', () => {
    const byKey = new Map(
      latestSourcePolicies().map(p => [policyKey(p.table, p.name), p])
    );

    const timeEntries = byKey.get(
      policyKey('public.time_entries', 'Members can view time entries')
    );
    const timesheets = byKey.get(
      policyKey('public.timesheets', 'Members can view timesheets')
    );

    expect(timeEntries?.source).toBe('018_optimize_rls_initplan.sql');
    expect(timesheets?.source).toBe('018_optimize_rls_initplan.sql');
    // 018's distinguishing feature: the carer OR-arm is an initplan.
    expect(timeEntries?.body).toContain('(select auth.uid()) = carer_id');
    expect(timesheets?.body).toContain('(select auth.uid()) = carer_id');
  });

  it('drops and recreates every helper-scoped policy', () => {
    const target = readMigration(TARGET_MIGRATION);
    const recreated = new Map(
      parsePolicies(target, TARGET_MIGRATION).map(p => [
        policyKey(p.table, p.name),
        p,
      ])
    );
    const dropped = parseDroppedPolicies(target);

    const missingCreate: string[] = [];
    const missingDrop: string[] = [];
    for (const policy of latestSourcePolicies()) {
      const key = policyKey(policy.table, policy.name);
      if (!recreated.has(key)) missingCreate.push(`${key} (${policy.source})`);
      if (!dropped.has(key)) missingDrop.push(`${key} (${policy.source})`);
    }

    expect(missingCreate).toEqual([]);
    expect(missingDrop).toEqual([]);
  });

  it('recreates each policy verbatim apart from the helper name', () => {
    const recreated = new Map(
      parsePolicies(readMigration(TARGET_MIGRATION), TARGET_MIGRATION).map(
        p => [policyKey(p.table, p.name), p]
      )
    );

    const drift: string[] = [];
    for (const policy of latestSourcePolicies()) {
      const key = policyKey(policy.table, policy.name);
      const actual = recreated.get(key);
      if (!actual) continue;
      const expected = repoint(policy.body);
      if (actual.body !== expected) {
        drift.push(
          `${key}\n  expected: ${expected}\n  actual:   ${actual.body}`
        );
      }
    }

    expect(drift).toEqual([]);
  });

  it('adds no policy that was not already in the migration history', () => {
    const sourceKeys = new Set(
      latestSourcePolicies().map(p => policyKey(p.table, p.name))
    );
    const extra = parsePolicies(
      readMigration(TARGET_MIGRATION),
      TARGET_MIGRATION
    )
      .map(p => policyKey(p.table, p.name))
      .filter(key => !sourceKeys.has(key));

    expect(extra).toEqual([]);
  });

  it('leaves no policy calling the old helper names directly', () => {
    const stillDirect = parsePolicies(
      readMigration(TARGET_MIGRATION),
      TARGET_MIGRATION
    )
      .filter(p => HELPER_CALL.test(p.body))
      .map(p => policyKey(p.table, p.name));

    expect(stillDirect).toEqual([]);
  });
});

describe('040_rls_semantic_predicates.sql — wrapper functions', () => {
  const WRAPPERS = [
    {
      wrapper: 'can_read_household',
      delegate: 'is_household_member',
    },
    {
      wrapper: 'can_write_household',
      delegate: 'is_household_parent',
    },
  ] as const;

  function extractFunction(sql: string, wrapper: string): string {
    const match = sql.match(
      new RegExp(
        `create or replace function private\\.${wrapper}\\s*\\(hid uuid\\)[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$`,
        'i'
      )
    );
    if (!match) throw new Error(`No definition for private.${wrapper}`);
    return normalise(match[0]);
  }

  for (const { wrapper, delegate } of WRAPPERS) {
    it(`defines private.${wrapper} in 009's house style`, () => {
      const definition = extractFunction(
        readMigration(TARGET_MIGRATION),
        wrapper
      );

      expect(definition).toContain('returns boolean');
      expect(definition).toContain('language sql');
      expect(definition).toContain('stable');
      expect(definition).toContain('security definer');
      expect(definition).toContain("set search_path = ''");
      // Pure pass-through, schema-qualified body.
      expect(definition).toContain(`select private.${delegate}(hid)`);
    });

    it(`documents private.${wrapper} with a comment on function`, () => {
      const target = normalise(readMigration(TARGET_MIGRATION));
      expect(target).toContain(
        `comment on function private.${wrapper}(uuid) is`
      );
    });

    it(`revokes private.${wrapper} from PUBLIC before granting it back`, () => {
      const target = normalise(readMigration(TARGET_MIGRATION));

      const revoke = `revoke all on function private.${wrapper}(uuid) from public;`;
      const grant = `grant execute on function private.${wrapper}(uuid) to anon, authenticated, service_role;`;

      expect(target).toContain(revoke);
      expect(target).toContain(grant);
      // Order matters: granting first and revoking after would leave nothing.
      expect(target.indexOf(revoke)).toBeLessThan(target.indexOf(grant));
    });
  }

  it('does not wrap the new predicates in a sub-select', () => {
    // Executable SQL only — splitStatements drops `--` comments, so the
    // header is free to quote the forbidden form as the counter-example it is.
    const executable = normalise(
      splitStatements(readMigration(TARGET_MIGRATION)).join(';')
    );

    // 018's "WHY THE HOUSEHOLD-SCOPED TABLES ARE NOT IN THIS FILE": the
    // initplan optimisation lives inside the helper, which takes a per-row
    // household_id and therefore cannot be an initplan itself.
    expect(executable).not.toContain('(select private.can_read_household');
    expect(executable).not.toContain('(select private.can_write_household');
  });
});
