/**
 * @module tests/unit/migration042TimesheetEarnings.test
 * Pattern A — migration contract for `042_timesheet_earnings.sql`.
 *
 * This migration is deliberately small: four nullable columns on the
 * already-existing `public.timesheets`, no new table, no new policy, no
 * trigger change. The behaviour that matters — compute live, freeze at
 * approval, clear on reopen (D1's exact surface) — lives in the service
 * layer (`earningsService.ts` / `timesheetCommandService.ts`), not here; this
 * test pins the migration's half of the contract: the columns exist, are all
 * nullable with no default, and the header documents WHY (TIER0-PLAN.md
 * "Design decisions locked" 4, Phase 2's migration section; docs/11-MONEY.md
 * §3).
 *
 * The SQL parsing below is quote- and dollar-quote-aware, adapted from
 * `migration041PayArrangements.test.ts` (unchanged there — the helpers are
 * not exported, so they are reproduced rather than imported). Unlike 041,
 * this migration alters an existing table rather than creating one, so the
 * table-shape parsing below targets `alter table ... add column` clauses
 * instead of a `create table` body.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '042_timesheet_earnings.sql';
const TABLE = 'public.timesheets';

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
// `alter table ... add column if not exists ...` parsing
// ---------------------------------------------------------------------------
// Collects every "add column if not exists <name> <definition>" clause across
// every `alter table public.timesheets` statement in the file, regardless of
// whether the migration groups them into one statement (comma-separated
// clauses) or writes one `alter table` per column (033's style) — either is a
// legal way to add four columns, and this migration's own house style is not
// the thing under test.

const ADD_COLUMN_TABLE_RE = new RegExp(
  `^alter table (?:only )?${TABLE.replace('.', '\\.')}\\b`,
  'i'
);
const ADD_COLUMN_CLAUSE_RE = /^add column (?:if not exists )?(\S+)\s+(.*)$/i;

function parseAddedColumns(): Map<string, string> {
  const columns = new Map<string, string>();
  for (const statement of statements) {
    if (!ADD_COLUMN_TABLE_RE.test(statement)) continue;
    const withoutPrefix = statement.replace(ADD_COLUMN_TABLE_RE, '').trim();
    for (const clause of splitTopLevel(withoutPrefix)) {
      const match = ADD_COLUMN_CLAUSE_RE.exec(clause);
      if (!match) continue;
      const [, name, definition] = match;
      columns.set((name ?? '').toLowerCase(), (definition ?? '').toLowerCase());
    }
  }
  return columns;
}

// ---------------------------------------------------------------------------
// The expected shape — TIER0-PLAN.md Phase 2's migration sketch, docs/11-MONEY
// §3. Fragments, not verbatim strings, so comment placement and spacing stay
// free — same convention as 041's test.
// ---------------------------------------------------------------------------

const EXPECTED_COLUMNS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['gross_minor', ['integer', 'check (gross_minor >= 0)']],
  // Nullable and NO DEFAULT — deliberately unlike pay_arrangements.currency,
  // which defaults to 'GBP'. A null snapshot has no currency: there is
  // nothing to default to before a week is ever approved.
  ['currency', ['char(3)', "check (currency ~ '^[a-z]{3}$')"]],
  ['earnings', ['jsonb']],
  ['earnings_computed_at', ['timestamptz']],
];

const ALL_COLUMN_NAMES = EXPECTED_COLUMNS.map(([name]) => name);

describe('042_timesheet_earnings.sql — adds exactly the four snapshot columns', () => {
  it('adds gross_minor, currency, earnings and earnings_computed_at to public.timesheets', () => {
    const columns = parseAddedColumns();
    expect([...columns.keys()].sort()).toEqual([...ALL_COLUMN_NAMES].sort());
  });

  for (const [name, fragments] of EXPECTED_COLUMNS) {
    it(`declares ${name} with its planned type and constraints`, () => {
      const columns = parseAddedColumns();
      const definition = columns.get(name);
      expect(definition).toBeDefined();
      for (const fragment of fragments) {
        expect(definition).toContain(fragment.toLowerCase());
      }
    });
  }

  // All four are null while a week is open, populated only at approval,
  // cleared on reopen — behaviour lives in the service layer, but the columns
  // themselves must never coerce a missing snapshot into a fake value.
  for (const name of ALL_COLUMN_NAMES) {
    it(`leaves ${name} nullable (no NOT NULL)`, () => {
      const columns = parseAddedColumns();
      expect(columns.get(name)).not.toContain('not null');
    });

    it(`gives ${name} no DEFAULT`, () => {
      const columns = parseAddedColumns();
      expect(columns.get(name)).not.toContain('default');
    });
  }

  it('stores money as an integer minor unit with an ISO-4217 sibling, docs/11-MONEY.md §1', () => {
    const columns = parseAddedColumns();
    expect(columns.get('gross_minor')).toContain('integer');
    expect(columns.get('currency')).toContain('char(3)');
  });

  // The parsed column map is lowercased so that layout and keyword case stay
  // free, which would let `~ '^[a-z]{3}$'` pass the fragment check above — the
  // exact opposite constraint. The character class is therefore pinned
  // against the RAW SQL, same discipline as 041's test.
  it('pins the currency check to UPPERCASE letters, verbatim in the raw SQL', () => {
    expect(migrationSql).toContain("check (currency ~ '^[A-Z]{3}$')");
  });
});

describe('042_timesheet_earnings.sql — touches nothing else', () => {
  it('creates no new table', () => {
    expect(executable).not.toContain('create table');
  });

  it('creates no new policy — the existing timesheets SELECT policy already covers reads', () => {
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
  });

  it('changes no trigger — no updated_at behaviour change on timesheets', () => {
    expect(executable).not.toContain('create trigger');
    expect(executable).not.toContain('drop trigger');
  });

  it('creates no index', () => {
    expect(executable).not.toContain('create index');
  });
});

describe('042_timesheet_earnings.sql — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // The freeze-at-approval contract (TIER0-PLAN.md "Design decisions
    // locked" 4, docs/11-MONEY.md §3): computed live while open, snapshotted
    // at approval.
    'freeze-at-approval contract',
    // D1's exact surface, reused for the snapshot: the reopen path must null
    // out these four columns or the frozen number becomes a stale lie.
    'reopen clears the snapshot',
    // The legacy arm (review finding 5): a week approved before this
    // migration has a NULL snapshot forever.
    'approved before this migration renders hours-only; never backfilled',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }

  it('documents that all four columns are null while the week is open', () => {
    expect(commentText).toContain('null while');
  });

  it('documents that a null currency has no default, unlike pay_arrangements', () => {
    expect(commentText).toContain('no default');
  });
});
