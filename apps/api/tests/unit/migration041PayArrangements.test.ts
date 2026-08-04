/**
 * @module tests/unit/migration041PayArrangements.test
 * Pattern A — migration contract for `041_pay_arrangements.sql`.
 *
 * `pay_arrangements` is the first money table in the schema, so it sets the
 * precedent every later one copies (`042` earnings, `043` pto_ledger, `044`
 * expenses). Four properties of that precedent are load-bearing and silent when
 * broken, so they are pinned here rather than left to review:
 *
 *   1. **Append-only.** No `updated_at` column and no update trigger. A
 *      correction is a new row; pay history is evidence in exactly the dispute
 *      this product exists to prevent (TIER0-PLAN "Design decisions" 3,
 *      docs/11-MONEY.md §2).
 *   2. **No unique constraint on (household_id, carer_id, valid_from)** —
 *      dropped in the independent review (finding 2): combined with append-only
 *      and no-future-dating it would make a same-day rate typo permanently
 *      uncorrectable. A plain index on (household_id, carer_id, valid_from
 *      desc) serves `effectiveOn` instead. This test exists so it cannot be
 *      "helpfully" re-added.
 *   3. **Select-only RLS** (review finding 3, docs/11-MONEY.md §8): one SELECT
 *      policy, no insert/update/delete policy at all. A client-exercisable
 *      write policy would let a caller bypass every service-enforced rule —
 *      no-future-dating, the D12-class membership assertion — with nothing more
 *      than the anon key and her own JWT.
 *   4. **The 040 semantic predicate, bare.** `private.can_read_household(...)`,
 *      never `private.is_household_member(...)` (the whole point of 040) and
 *      never wrapped in a sub-select (040's trap 2 — the initplan optimisation
 *      lives inside the helper, which takes a per-row `household_id`).
 *
 * The SQL parsing below is quote- and dollar-quote-aware, adapted from
 * `migration040PolicyParity.test.ts` (unchanged there — the helpers are not
 * exported, so they are reproduced rather than imported).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '041_pay_arrangements.sql';
const TABLE = 'public.pay_arrangements';

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
// The expected shape — TIER0-PLAN.md, Phase 1's `041_pay_arrangements` sketch.
// Order is the sketch's order; each entry is the fragments the definition must
// carry, not a verbatim string, so comment placement and spacing stay free.
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
  // 033 discipline: payroll history survives the carer deleting her account.
  [
    'carer_id',
    ['uuid', 'references public.user_profiles(user_id)', 'on delete set null'],
  ],
  ['rate_minor', ['integer', 'not null', 'check (rate_minor >= 0)']],
  // Dormant until agency invoicing, but still an amount: every other
  // `_minor` column here carries the same non-negative floor, and a dormant
  // column with no floor is a trap for whoever wakes it (argued deviation
  // from the plan sketch, which spells out no check for this one column).
  ['bill_rate_minor', ['integer', 'check (bill_rate_minor >= 0)']],
  ['currency', ['char(3)', 'not null', "default 'gbp'"]],
  [
    'overtime_threshold_minutes',
    ['integer', 'check (overtime_threshold_minutes > 0)'],
  ],
  [
    'overtime_multiplier',
    [
      'numeric(3, 2)',
      'not null',
      'default 1.50',
      'check (overtime_multiplier >= 1)',
    ],
  ],
  [
    'guaranteed_minutes_per_week',
    ['integer', 'check (guaranteed_minutes_per_week >= 0)'],
  ],
  [
    'pto_entitlement_minutes_per_year',
    ['integer', 'check (pto_entitlement_minutes_per_year >= 0)'],
  ],
  [
    'mileage_rate_per_mile_minor',
    ['integer', 'check (mileage_rate_per_mile_minor >= 0)'],
  ],
  [
    'cancellation_paid_within_hours',
    ['integer', 'check (cancellation_paid_within_hours > 0)'],
  ],
  ['valid_from', ['date', 'not null']],
  // Snapshot at insert (033 discipline, review finding 7).
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
  'bill_rate_minor',
  'overtime_threshold_minutes',
  'guaranteed_minutes_per_week',
  'pto_entitlement_minutes_per_year',
  'mileage_rate_per_mile_minor',
  'cancellation_paid_within_hours',
  'note',
  'created_by',
] as const;

describe('041_pay_arrangements.sql — table shape', () => {
  it('creates public.pay_arrangements with exactly the planned columns, in order', () => {
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

  it('stores money as integer minor units with an ISO-4217 sibling', () => {
    const { columns } = parseCreateTable(TABLE);
    for (const name of [
      'rate_minor',
      'bill_rate_minor',
      'mileage_rate_per_mile_minor',
    ]) {
      // docs/11-MONEY.md §1: never a float, never a bare numeric.
      expect(columns.get(name)).toContain('integer');
    }
    expect(columns.get('currency')).toContain('char(3)');
  });
});

describe('041_pay_arrangements.sql — append-only', () => {
  it('has no updated_at column', () => {
    const { columns } = parseCreateTable(TABLE);
    expect(columns.has('updated_at')).toBe(false);
  });

  it('creates no trigger at all — in particular no set_updated_at', () => {
    expect(executable).not.toContain('create trigger');
    expect(executable).not.toContain('set_updated_at');
  });
});

describe('041_pay_arrangements.sql — indexes and the absent unique constraint', () => {
  it('declares no table-level unique or primary-key constraint beyond the id column', () => {
    const { constraints } = parseCreateTable(TABLE);
    for (const constraint of constraints) {
      expect(constraint.toLowerCase()).not.toContain('unique');
    }
  });

  it('creates no unique index — review finding 2, a same-day typo must stay correctable', () => {
    expect(executable).not.toContain('create unique index');
  });

  it('creates the non-unique lookup index effectiveOn resolves against', () => {
    const index = statements.find(
      s =>
        /^create index/i.test(s) &&
        s.toLowerCase().includes('public.pay_arrangements')
    );
    expect(index).toBeDefined();
    expect(index?.toLowerCase()).toContain(
      '(household_id, carer_id, valid_from desc)'
    );
  });
});

describe('041_pay_arrangements.sql — RLS is select-only', () => {
  function policyStatements(): string[] {
    return statements.filter(s => /^create policy/i.test(s));
  }

  it('enables row level security on the table', () => {
    expect(executable).toContain(
      'alter table public.pay_arrangements enable row level security'
    );
  });

  it('creates exactly one policy', () => {
    expect(policyStatements()).toHaveLength(1);
  });

  it('makes that policy a SELECT policy on can_read_household(household_id)', () => {
    const [policy] = policyStatements();
    expect(policy?.toLowerCase()).toContain('on public.pay_arrangements');
    expect(policy?.toLowerCase()).toContain(
      'for select using (private.can_read_household(household_id))'
    );
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

  it('does not wrap the predicate in a sub-select (040 trap 2)', () => {
    expect(executable).not.toContain('(select private.can_read_household');
  });
});

describe('041_pay_arrangements.sql — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // The arrangement concept and the append-only discipline.
    'append-only',
    'one row per',
    // The effectiveOn resolution rule, verbatim from TIER0-PLAN.md.
    'greatest valid_from <= date',
    'ties broken by created_at desc',
    // Why there is no unique constraint (review finding 2).
    'permanently uncorrectable',
    // Why RLS is select-only (review finding 3).
    'service role',
    'no-future-dates',
    // cancellation_paid_within_hours null semantics (owner decision 5).
    'null means no cancellation pay',
    'households.cancellation_paid_within_hours',
    // bill_rate_minor is deliberately dormant.
    'bill_rate_minor',
    'invoicing',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
