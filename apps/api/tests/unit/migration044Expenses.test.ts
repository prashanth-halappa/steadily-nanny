/**
 * @module tests/unit/migration044Expenses.test
 * Pattern A — migration contract for `044_expenses.sql`.
 *
 * `expenses` is the third money table (after `041_pay_arrangements` and
 * `043_pto_ledger`) and the first one that is MUTABLE — review moves a row
 * `pending` -> `approved`/`rejected` — and the first one a carer actually
 * writes to (her own claim), even though she never gets a client-exercisable
 * write path (select-only RLS, same as 041/043). Four properties are
 * load-bearing and silent when broken, so they are pinned here rather than
 * left to review:
 *
 *   1. **The three CHECK constraints are IMPLICATIONS, never equivalences**
 *      (independent review, finding 1 — a ship-blocker). An equivalence
 *      `(kind = 'expense') = (amount_minor is not null)` would also forbid a
 *      `kind = 'mileage'` row from ever holding a non-null `amount_minor` —
 *      exactly what the mileage-approval write does — so every mileage
 *      approval would violate its own row's constraint and 500. This test
 *      pins the three implications verbatim and asserts the equivalence form
 *      is absent.
 *   2. **Unlike 041/043, this table keeps `updated_at` + the
 *      `set_updated_at` trigger** — it is genuinely mutated by review, so the
 *      append-only "no trigger" contract those tables pin is the wrong shape
 *      here, and it's easy to copy-paste that shape by mistake.
 *   3. **Select-only RLS, the 041 read rule again** — one SELECT policy,
 *      `private.can_write_household(household_id) or carer_id = (select
 *      auth.uid())`, NO insert/update/delete policy at all. The independent
 *      review's motivating example for this whole stance (finding 3) is this
 *      exact table: a carer-self insert policy would let a nanny insert
 *      `status = 'approved'` with an arbitrary `amount_minor`, self-approving
 *      her own money with no parent involved.
 *   4. **The documentation contract** — reimbursements are not wages, mileage
 *      is priced at approval and frozen, why implications not equivalences,
 *      why select-only despite this being the one Tier 0 table a carer
 *      writes, and pending-editable/reviewed-immutable — must be written
 *      down in the header, because 044 is itself the pattern the next money
 *      table copies.
 *
 * SQL parsing below is quote- and dollar-quote-aware, adapted from
 * `migration041PayArrangements.test.ts` (unchanged there — copied, not
 * imported, since the helpers are not exported).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '044_expenses.sql';
const TABLE = 'public.expenses';

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
// The expected shape — TIER0-PLAN.md Phase 4's `044_expenses` sketch, as
// tightened by the task brief (kind/status enums, implication checks). Order
// is the sketch's order; each entry is the fragments the definition must
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
  // 033 discipline: expense history survives the carer deleting her account.
  [
    'carer_id',
    ['uuid', 'references public.user_profiles(user_id)', 'on delete set null'],
  ],
  ['local_date', ['date', 'not null']],
  ['kind', ['text', 'not null', "check (kind in ('expense', 'mileage'))"]],
  ['description', ['text', 'not null']],
  // Nullable at the column level; the implication checks below enforce it
  // conditionally on `kind` and `status`, never unconditionally.
  ['amount_minor', ['integer', 'check (amount_minor >= 0)']],
  ['miles', ['numeric(6,1)', 'check (miles > 0)']],
  [
    'currency',
    ['char(3)', 'not null', "default 'gbp'", "check (currency ~ '^[a-z]{3}$')"],
  ],
  [
    'status',
    [
      'text',
      'not null',
      "default 'pending'",
      "check (status in ('pending', 'approved', 'rejected'))",
    ],
  ],
  [
    'reviewed_by',
    ['uuid', 'references public.user_profiles(user_id)', 'on delete set null'],
  ],
  ['reviewed_at', ['timestamptz']],
  ['review_note', ['text']],
  // Snapshot at insert (033 discipline, review finding 7) — same as 041/043.
  ['carer_display_name', ['text', 'not null']],
  ['created_at', ['timestamptz', 'not null', 'default now()']],
  // UNLIKE 041/043: this table is genuinely mutated by review, so it keeps
  // updated_at (and, below, the set_updated_at trigger).
  ['updated_at', ['timestamptz', 'not null', 'default now()']],
];

/** Columns the spec deliberately leaves nullable. */
const NULLABLE_COLUMNS = [
  'carer_id',
  'amount_minor',
  'miles',
  'reviewed_by',
  'reviewed_at',
  'review_note',
] as const;

describe('044_expenses.sql — table shape', () => {
  it('creates public.expenses with exactly the planned columns, in order', () => {
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

  it('stores money as an integer minor-unit amount with an ISO-4217 sibling', () => {
    const { columns } = parseCreateTable(TABLE);
    // docs/11-MONEY.md §1: never a float, never a bare numeric.
    expect(columns.get('amount_minor')).toContain('integer');
    expect(columns.get('currency')).toContain('char(3)');
  });

  it('stores miles as numeric(6,1), never money', () => {
    const { columns } = parseCreateTable(TABLE);
    expect(columns.get('miles')).toContain('numeric(6,1)');
  });

  // The parsed column map is lowercased so that layout and keyword case stay
  // free, which would let `~ '^[a-z]{3}$'` pass the fragment check above —
  // the exact opposite constraint, accepting only lowercase codes no client
  // sends. The character class is therefore pinned against the RAW SQL.
  it('pins the currency check to UPPERCASE letters, verbatim in the raw SQL', () => {
    expect(migrationSql).toContain("check (currency ~ '^[A-Z]{3}$')");
  });
});

describe('044_expenses.sql — the three implication checks (review finding 1)', () => {
  // Pinned against the RAW migration text: these are the load-bearing clauses
  // the whole migration exists to get right, so they are asserted verbatim,
  // not by fragment, and not through the lowercased/normalised pipeline.
  it('constrains an expense row to always carry an amount', () => {
    expect(migrationSql).toContain(
      "check (kind <> 'expense' or amount_minor is not null)"
    );
  });

  it('constrains a mileage row to always carry miles', () => {
    expect(migrationSql).toContain(
      "check (kind <> 'mileage' or miles is not null)"
    );
  });

  it('forbids an indicative amount on a mileage row before approval', () => {
    expect(migrationSql).toContain(
      "check (kind <> 'mileage' or status = 'approved' or amount_minor is null)"
    );
  });

  it('declares exactly these three checks as table-level constraints', () => {
    const { constraints } = parseCreateTable(TABLE);
    const checkConstraints = constraints.filter(c => /\bcheck\b/i.test(c));
    expect(checkConstraints).toHaveLength(3);
  });

  // The bug the review caught: an EQUIVALENCE (kind = 'expense') = (amount_minor
  // is not null) forbids a mileage row from EVER holding a non-null
  // amount_minor — which is exactly what approval writes. None of the three
  // implications may be phrased as a two-directional equivalence.
  it('never phrases a check as an equivalence between kind and amount_minor', () => {
    expect(executable).not.toContain(
      "(kind = 'expense') = (amount_minor is not null)"
    );
    expect(executable).not.toContain(
      "(kind = 'mileage') = (amount_minor is not null)"
    );
    expect(executable).not.toContain(
      "(kind = 'mileage') = (miles is not null)"
    );
  });

  it('never makes amount_minor unconditionally not null', () => {
    const { columns } = parseCreateTable(TABLE);
    // The column itself must stay nullable — see the "leaves nullable" test
    // above — but re-assert it here beside the checks that make it
    // CONDITIONALLY required, so the two can never silently drift apart.
    expect(columns.get('amount_minor')).not.toContain('not null');
  });
});

describe('044_expenses.sql — mutable: keeps updated_at + its trigger (unlike 041/043)', () => {
  it('has an updated_at column', () => {
    const { columns } = parseCreateTable(TABLE);
    expect(columns.has('updated_at')).toBe(true);
  });

  it('attaches the set_updated_at trigger before update', () => {
    expect(executable).toContain('create trigger');
    expect(executable).toContain('set_updated_at');
    const triggerStatement = statements.find(
      s =>
        /^create trigger/i.test(s) &&
        s.toLowerCase().includes('public.expenses')
    );
    expect(triggerStatement).toBeDefined();
    expect(triggerStatement?.toLowerCase()).toContain(
      'before update on public.expenses'
    );
    expect(triggerStatement?.toLowerCase()).toContain(
      'execute function public.set_updated_at()'
    );
  });

  it('drops the trigger before creating it, the house idempotency pattern', () => {
    expect(executable).toContain('drop trigger if exists');
  });
});

describe('044_expenses.sql — RLS is select-only, the 041 read rule again', () => {
  function policyStatements(): string[] {
    return statements.filter(s => /^create policy/i.test(s));
  }

  it('enables row level security on the table', () => {
    expect(executable).toContain(
      'alter table public.expenses enable row level security'
    );
  });

  it('creates exactly one policy', () => {
    expect(policyStatements()).toHaveLength(1);
  });

  // Pinned verbatim, same qual as 041/043: this is the product rule, chosen
  // against a specific person who must not see another carer's money
  // (Phase 1 review finding 2). A fragment check would pass a policy that
  // quietly gained a `can_read_household` third arm.
  it('makes that policy a SELECT policy for parents plus the carer’s own rows', () => {
    const [policy] = policyStatements();
    expect(policy?.toLowerCase()).toContain('on public.expenses');
    expect(policy?.toLowerCase()).toContain(
      'for select using (private.can_write_household(household_id) or carer_id = (select auth.uid()))'
    );
  });

  it('does not grant read to every member via can_read_household', () => {
    expect(executable).not.toContain('can_read_household');
  });

  // The independent review's motivating example for select-only RLS (finding
  // 3) IS this table: a carer-self insert policy would let a nanny insert
  // status='approved' with an arbitrary amount_minor, self-approving money.
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

  // 040's trap 2 applies to the HELPER call only: it must stay bare because
  // the initplan optimisation lives inside the helper.
  it('does not wrap the household helper in a sub-select (040 trap 2)', () => {
    expect(executable).not.toContain('(select private.can_write_household');
    expect(executable).not.toContain('(select private.can_read_household');
  });

  it('uses 018’s (select auth.uid()) form for the carer self-arm', () => {
    const [policy] = policyStatements();
    expect(policy?.toLowerCase()).toContain('(select auth.uid())');
    // The bare form 018 exists to remove: `carer_id = auth.uid()`.
    expect(policy?.toLowerCase()).not.toContain('= auth.uid()');
    expect(policy?.toLowerCase()).not.toContain('auth.uid() =');
  });
});

describe('044_expenses.sql — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // Reimbursements are not wages (docs/11-MONEY.md §6).
    'not wages',
    'excluded from gross pay',
    // Mileage priced at approval, frozen (spec §10.6 / the task brief).
    'computed at approval',
    'frozen into amount_minor',
    // Why implications, not equivalences (review finding 1).
    'implications, never equivalences',
    'finding 1',
    // Why select-only RLS despite the carer being the writer here.
    'select-only',
    'one tier 0 money table a carer',
    // Pending-editable / reviewed-immutable (review finding 18).
    'editable',
    'withdrawable',
    'immutable',
    'manual_adjustment',
    // The third check's rationale, pinned in the plan's own words.
    'no indicative amount before approval',
    // Who may read — same denial as 041/043.
    'helpers and other carers',
    'her own rows',
    // 033 discipline / snapshot.
    '033 discipline',
    'snapshot at insert',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
