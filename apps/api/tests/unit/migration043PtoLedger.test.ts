/**
 * @module tests/unit/migration043PtoLedger.test
 * Pattern A — migration contract for `043_pto_ledger.sql`.
 *
 * `pto_ledger` is the second money table (after `041_pay_arrangements.sql`)
 * and copies its precedent verbatim in every place the plan calls for that:
 *
 *   1. **Append-only.** No `updated_at` column and no update trigger.
 *      Corrections are new `adjustment` rows, never an edit to a `usage` or
 *      `accrual` row (TIER0-PLAN.md Phase 3, docs/11-MONEY.md §5).
 *   2. **Select-only RLS**, the SAME qual as 041 (docs/11-MONEY.md §8):
 *      `private.can_write_household(household_id) or carer_id = (select
 *      auth.uid())`. NOT `private.can_read_household` (every active member —
 *      would hand a helper or a second nanny another carer's balance), and
 *      the household helper is called BARE, never `(select
 *      private.can_write_household(...))` (040 trap 2). No insert/update/
 *      delete policy at all — writes are service-role only.
 *   3. **Two partial unique indexes**, the 039
 *      (`time_entries_one_cancellation_paid_per_shift`) pattern:
 *        - `(household_id, time_off_id) where kind = 'usage'` — one paid
 *          marking per time off per household, so two concurrent "mark
 *          paid" taps cannot double-pay (review finding 9).
 *        - `(household_id, carer_id, effective_date) where kind =
 *          'accrual'` — makes the lazy write-on-GET annual grant idempotent.
 *      Neither is a table-level UNIQUE constraint — both must allow
 *      unlimited rows of the OTHER kinds sharing the same key.
 *   4. **`carer_display_name` is a snapshot at insert** (review finding 7),
 *      same 033/041 discipline: the ledger stays legible after the carer's
 *      profile is gone (`carer_id` is nullable, `on delete set null`).
 *
 * The SQL parsing below is quote- and dollar-quote-aware, copied unchanged
 * from `migration041PayArrangements.test.ts` (itself adapted from
 * `migration040PolicyParity.test.ts` — the helpers are not exported, so they
 * are reproduced rather than imported).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '043_pto_ledger.sql';
const TABLE = 'public.pto_ledger';

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
// create table parsing
// ---------------------------------------------------------------------------

interface TableDefinition {
  /** Column definitions in declaration order, keyed by column name. */
  columns: Map<string, string>;
  /** Table-level constraint clauses (`constraint ...`, `unique (...)`, ...). */
  constraints: string[];
}

/** Split a parenthesised body on depth-zero commas. */
function splitTopLevel(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

const TABLE_LEVEL =
  /^(constraint|primary key|unique|check|foreign key|exclude)\b/i;

function parseCreateTable(table: string): TableDefinition {
  const pattern = new RegExp(
    `^create table (?:if not exists )?${table.replace('.', '\\.')} \\((.*)\\)$`,
    'i'
  );
  const statement = statements.find(s => pattern.test(s));
  if (!statement) throw new Error(`No create table statement for ${table}`);
  const body = statement.match(pattern)?.[1] ?? '';

  const columns = new Map<string, string>();
  const constraints: string[] = [];
  for (const item of splitTopLevel(body)) {
    if (TABLE_LEVEL.test(item)) {
      constraints.push(item);
      continue;
    }
    const [name, ...rest] = item.split(' ');
    columns.set((name ?? '').toLowerCase(), rest.join(' ').toLowerCase());
  }
  return { columns, constraints };
}

// ---------------------------------------------------------------------------
// The expected shape — TIER0-PLAN.md Phase 3's `043_pto_ledger` sketch, plus
// review findings 7 and 9. Order is the sketch's order; each entry is the
// fragments the definition must carry, not a verbatim string, so comment
// placement and spacing stay free.
// ---------------------------------------------------------------------------

const EXPECTED_COLUMNS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['id', ['uuid', 'primary key', 'default gen_random_uuid()']],
  [
    'household_id',
    [
      'uuid',
      'not null',
      'references public.households(id)',
      'on delete cascade',
    ],
  ],
  // 033 discipline: the ledger survives the carer deleting her own account.
  [
    'carer_id',
    ['uuid', 'references public.user_profiles(user_id)', 'on delete set null'],
  ],
  [
    'kind',
    ['text', 'not null', "check (kind in ('accrual', 'usage', 'adjustment'))"],
  ],
  // Signed: accrual positive, usage negative, adjustment either — never zero.
  ['minutes', ['integer', 'not null', 'check (minutes <> 0)']],
  ['effective_date', ['date', 'not null']],
  // Usage rows only; the one household-scoped -> cross-household FK.
  [
    'time_off_id',
    ['uuid', 'references public.carer_time_off(id)', 'on delete set null'],
  ],
  // Snapshot at insert (review finding 7).
  ['carer_display_name', ['text', 'not null']],
  ['note', ['text']],
  [
    'created_by',
    ['uuid', 'references public.user_profiles(user_id)', 'on delete set null'],
  ],
  ['created_at', ['timestamptz', 'not null', 'default now()']],
];

/** Columns the plan deliberately leaves nullable. */
const NULLABLE_COLUMNS = [
  'carer_id',
  'time_off_id',
  'note',
  'created_by',
] as const;

describe('043_pto_ledger.sql — table shape', () => {
  it('creates public.pto_ledger with exactly the planned columns, in order', () => {
    const { columns } = parseCreateTable(TABLE);
    expect([...columns.keys()]).toEqual(EXPECTED_COLUMNS.map(([name]) => name));
  });

  for (const [name, fragments] of EXPECTED_COLUMNS) {
    it(`declares ${name} with its planned type and constraints`, () => {
      const { columns } = parseCreateTable(TABLE);
      const definition = columns.get(name);
      expect(definition).toBeDefined();
      for (const fragment of fragments) {
        expect(definition).toContain(fragment.toLowerCase());
      }
    });
  }

  for (const name of NULLABLE_COLUMNS) {
    it(`leaves ${name} nullable`, () => {
      const { columns } = parseCreateTable(TABLE);
      expect(columns.get(name)).not.toContain('not null');
    });
  }

  it('makes household_id, kind, minutes, effective_date, carer_display_name and created_at not-null', () => {
    const { columns } = parseCreateTable(TABLE);
    for (const name of [
      'household_id',
      'kind',
      'minutes',
      'effective_date',
      'carer_display_name',
      'created_at',
    ]) {
      expect(columns.get(name)).toContain('not null');
    }
  });
});

describe('043_pto_ledger.sql — append-only', () => {
  it('has no updated_at column', () => {
    const { columns } = parseCreateTable(TABLE);
    expect(columns.has('updated_at')).toBe(false);
  });

  it('creates no trigger at all — in particular no set_updated_at', () => {
    expect(executable).not.toContain('create trigger');
    expect(executable).not.toContain('set_updated_at');
  });
});

describe('043_pto_ledger.sql — indexes', () => {
  it('declares no table-level unique or primary-key constraint beyond the id column', () => {
    const { constraints } = parseCreateTable(TABLE);
    for (const constraint of constraints) {
      expect(constraint.toLowerCase()).not.toContain('unique');
    }
  });

  it('creates exactly two unique indexes', () => {
    const uniqueIndexes = statements.filter(
      s =>
        /^create unique index/i.test(s) &&
        s.toLowerCase().includes('public.pto_ledger')
    );
    expect(uniqueIndexes).toHaveLength(2);
  });

  it('creates a partial unique index on (household_id, time_off_id) where kind = usage (review finding 9, the 039 pattern)', () => {
    const index = statements.find(
      s =>
        /^create unique index/i.test(s) &&
        s.toLowerCase().includes('public.pto_ledger') &&
        s.toLowerCase().includes('(household_id, time_off_id)')
    );
    expect(index).toBeDefined();
    expect(index?.toLowerCase()).toContain("where kind = 'usage'");
  });

  it('creates a partial unique index on (household_id, carer_id, effective_date) where kind = accrual, making the lazy grant idempotent', () => {
    const index = statements.find(
      s =>
        /^create unique index/i.test(s) &&
        s.toLowerCase().includes('public.pto_ledger') &&
        s.toLowerCase().includes('(household_id, carer_id, effective_date)')
    );
    expect(index).toBeDefined();
    expect(index?.toLowerCase()).toContain("where kind = 'accrual'");
  });

  it('creates a plain lookup index on (household_id, carer_id) for balance reads, unqualified by kind', () => {
    const index = statements.find(
      s =>
        /^create index/i.test(s) &&
        s.toLowerCase().includes('public.pto_ledger') &&
        s.toLowerCase().includes('(household_id, carer_id)') &&
        !s.toLowerCase().includes('(household_id, carer_id, effective_date)')
    );
    expect(index).toBeDefined();
    expect(index?.toLowerCase()).not.toContain('where');
  });
});

describe('043_pto_ledger.sql — RLS is select-only, 041’s exact qual', () => {
  function policyStatements(): string[] {
    return statements.filter(s => /^create policy/i.test(s));
  }

  it('enables row level security on the table', () => {
    expect(executable).toContain(
      'alter table public.pto_ledger enable row level security'
    );
  });

  it('creates exactly one policy', () => {
    expect(policyStatements()).toHaveLength(1);
  });

  // Pinned verbatim, the SAME qual 041 uses — copied character for character,
  // not re-derived, so 043 cannot quietly drift from the product rule.
  it('makes that policy a SELECT policy with 041’s exact qual', () => {
    const [policy] = policyStatements();
    expect(policy?.toLowerCase()).toContain('on public.pto_ledger');
    expect(policy?.toLowerCase()).toContain(
      'for select using (private.can_write_household(household_id) or carer_id = (select auth.uid()))'
    );
  });

  it('does not grant read to every member via can_read_household', () => {
    expect(executable).not.toContain('can_read_household');
  });

  it('creates no insert, update, delete or ALL policy — writes are service-role only', () => {
    for (const policy of policyStatements()) {
      const lower = policy.toLowerCase();
      expect(lower).not.toContain('for insert');
      expect(lower).not.toContain('for update');
      expect(lower).not.toContain('for delete');
      expect(lower).not.toContain('for all');
      expect(lower).not.toContain('with check');
    }
  });

  it('drops the policy before creating it, the house idempotency pattern', () => {
    expect(executable).toContain('drop policy if exists');
  });

  it('uses the 040 semantic predicate, not the 009 membership helper', () => {
    expect(executable).not.toContain('private.is_household_member');
    expect(executable).not.toContain('private.is_household_parent');
  });

  // 040's trap 2 applies to the HELPER call only. `(select auth.uid())` in
  // the self-arm is the opposite: 018's house form, and the one place the
  // sub-select wrapper is correct (auth.uid() takes no per-row argument, so
  // it hoists into an initplan).
  it('does not wrap the household helper in a sub-select (040 trap 2)', () => {
    expect(executable).not.toContain('(select private.can_write_household');
    expect(executable).not.toContain('(select private.can_read_household');
  });

  it('uses 018’s (select auth.uid()) form for the carer self-arm, never bare = auth.uid()', () => {
    const [policy] = policyStatements();
    expect(policy?.toLowerCase()).toContain('(select auth.uid())');
    expect(policy?.toLowerCase()).not.toContain('= auth.uid()');
    expect(policy?.toLowerCase()).not.toContain('auth.uid() =');
  });
});

describe('043_pto_ledger.sql — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // The ledger concept: append-only rows, balance is a derived sum.
    'balance = sum(minutes)',
    'append-only',
    // Why paid PTO can never be a flag on carer_time_off.
    'no household reference',
    'paid by whom',
    // The anonymity analysis for the time_off_id FK itself.
    'impact counts',
    "reveals nothing about the carer's other households",
    // The v1 grant model.
    'calendar year',
    'lazily',
    'write-on-get',
    'no pro-rating',
    'does not retro-adjust',
    'adjustment row',
    // Why each unique index exists.
    'double-pay',
    'idempotent',
    // The RLS stance, copied from 041 (docs/11-MONEY.md §8).
    'service role',
    'helpers and other carers',
    'her own rows',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
