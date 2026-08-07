/**
 * @module tests/unit/migration063MoneyUpperBounds.test
 * Pattern A — migration contract for `063_money_upper_bounds.sql`.
 *
 * Written BEFORE the migration existed, same discipline as 055/059.
 *
 * WHAT THIS CLOSES: audit finding F-B2-6 — money columns had a floor
 * (`>= 0`, 041/044) but no ceiling. Nothing in the schema disagreed with a
 * pay rate or expense of a billion pounds; only client-side validation did,
 * and client-side validation is not a backstop against a direct write.
 *
 * THE BOUND: 99_999_999 minor units (£999,999.99), matching mobile's
 * `parseMajorToMinor` cap and the Zod schema caps landing in the same wave.
 *
 * THE NULL TRAP: `bill_rate_minor`, `mileage_rate_per_mile_minor`,
 * `expenses.amount_minor` and `timesheets.gross_minor` are all nullable
 * columns with real null meanings (see 041/042/044's headers) — a plain
 * `col <= 99999999` CHECK passes NULL by SQL semantics (a CHECK only fails
 * when the expression evaluates to FALSE; NULL is not FALSE), so no
 * `is null or` guard is needed, and adding one would be new width doing
 * nothing that plain form doesn't already do.
 *
 * THE PRODUCT class the fifth constraint closes (adversarial review REOPEN):
 * capping each INPUT does not cap what they MULTIPLY into. 40h at the
 * schema-legal max rate is 3_999_999_960 — past int4, so an approve used to
 * die on a raw Postgres "out of range". `timesheets.gross_minor` is a
 * COMPUTED column, so it needs its own ceiling, and the service-layer guards
 * in `timesheetCommandService.approve` / `expenseCommandService.review` turn
 * hitting it into a typed 400 instead of a database error mid-approval.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '063_money_upper_bounds.sql';
const CAP = '99999999';

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
// `;` inside a comment or a string does not split a statement in half. Copied
// from `migration059ExtraShiftDedupe.test.ts`, the local convention.
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
const executable = statements.join('; ').toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** Statements that add the constraint named `name` (drop-then-add pair). */
function constraintStatements(name: string): {
  drops: string[];
  adds: string[];
} {
  const drops = statements.filter(s =>
    new RegExp(`drop\\s+constraint\\s+if\\s+exists\\s+${name}\\b`, 'i').test(s)
  );
  const adds = statements.filter(s =>
    new RegExp(`add\\s+constraint\\s+${name}\\b`, 'i').test(s)
  );
  return { drops, adds };
}

const CONSTRAINTS: { table: string; column: string; name: string }[] = [
  {
    table: 'pay_arrangements',
    column: 'rate_minor',
    name: 'pay_arrangements_rate_minor_upper',
  },
  {
    table: 'pay_arrangements',
    column: 'bill_rate_minor',
    name: 'pay_arrangements_bill_rate_minor_upper',
  },
  {
    table: 'pay_arrangements',
    column: 'mileage_rate_per_mile_minor',
    name: 'pay_arrangements_mileage_rate_per_mile_minor_upper',
  },
  {
    table: 'expenses',
    column: 'amount_minor',
    name: 'expenses_amount_minor_upper',
  },
  // The COMPUTED one. Every constraint above bounds an INPUT; this bounds a
  // product of them, which nothing above can. Nullable on an unapproved (or
  // unpriceable) week — 042 adds it as bare `integer`, never NOT NULL — so
  // the same plain, NULL-tolerant form applies.
  {
    table: 'timesheets',
    column: 'gross_minor',
    name: 'timesheets_gross_minor_upper',
  },
];

describe('063 — an upper bound on every money column', () => {
  for (const { table, column, name } of CONSTRAINTS) {
    describe(`public.${table}.${column}`, () => {
      it(`drops "${name}" before adding it (idempotent re-run)`, () => {
        const { drops, adds } = constraintStatements(name);
        expect(drops).toHaveLength(1);
        expect(adds).toHaveLength(1);
        // drop-before-add: the drop statement must precede the add statement
        // in file order, same convention as 055's exclusion constraints.
        const dropIndex = statements.indexOf(drops[0] ?? '');
        const addIndex = statements.indexOf(adds[0] ?? '');
        expect(dropIndex).toBeGreaterThanOrEqual(0);
        expect(dropIndex).toBeLessThan(addIndex);
      });

      it(`is scoped to public.${table}`, () => {
        const alters = statements.filter(
          s =>
            new RegExp(`add\\s+constraint\\s+${name}\\b`, 'i').test(s) &&
            s.toLowerCase().includes(`alter table public.${table}`)
        );
        expect(alters).toHaveLength(1);
      });

      it(`caps ${column} at ${CAP} (£999,999.99) in plain, NULL-tolerant form`, () => {
        const { adds } = constraintStatements(name);
        const statement = (adds[0] ?? '').toLowerCase();
        // Plain `col <= cap` — a CHECK only fails on FALSE, and
        // `null <= 99999999` evaluates to NULL, not FALSE, so this form
        // already tolerates the column's null meaning with no extra guard.
        expect(statement).toContain(`check (${column} <= ${CAP})`);
        // Pinned as an explicit absence: wrapping in a null-guard or
        // NOT NULL form would be unrequested width, not correctness.
        expect(statement).not.toContain('is null');
        expect(statement).not.toContain('not null');
      });
    });
  }

  it('touches only these five columns, nothing else', () => {
    for (const { name } of CONSTRAINTS) {
      expect(executable).toContain(name.toLowerCase());
    }
    expect(executable).not.toContain('create table');
    expect(executable).not.toContain('drop table');
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
    expect(executable).not.toContain('delete from');
    expect(executable).not.toContain('truncate');
  });

  it('references the audit finding it closes', () => {
    expect(commentText).toContain('f-b2-6');
  });

  it('gives the computed column its own pre-deploy check query', () => {
    // Every other constraint has one in the header; the computed one needs it
    // most — a pre-existing over-cap gross is the row most likely to already
    // exist, because nothing ever bounded it.
    expect(commentText).toContain('from public.timesheets');
    expect(commentText).toContain('gross_minor > 99999999');
  });

  it('records the open product question about RATE caps for the owner', () => {
    // The per-hour and per-mile rate caps reuse the TOTAL-amount cap, which is
    // why a legal rate can still multiply past a legal total. Materially
    // tighter domain caps would make the overflow unreachable rather than
    // merely cleanly-failing — deliberately an owner decision, and it has to
    // stay written down or it is not a decision, just an omission.
    expect(commentText).toMatch(/rate cap|per-hour|per-mile/);
    expect(commentText).toContain('owner decision');
  });

  it('documents that a pre-existing over-cap row fails the ALTER loudly, by design', () => {
    // Same discipline as 059's "warns that existing duplicates block the
    // create" — the fix is a real gate, not a no-op if data already violates
    // it, and whoever applies this needs to know before running it.
    expect(commentText).toMatch(
      /existing row|pre-existing|fails? loudly|fails? the alter/
    );
  });
});
