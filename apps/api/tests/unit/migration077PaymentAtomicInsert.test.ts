/**
 * @module tests/unit/migration077PaymentAtomicInsert.test
 * Pattern A — migration contract for `077_payment_atomic_insert.sql`.
 *
 * `paymentCommandService` used to sum the week's existing payments and THEN
 * insert, with nothing holding a lock in between: two parents tapping "Record
 * payment" in the same instant both read `sum = 0` and both commit, and the
 * week is paid twice over its frozen gross (067's header calls the service IS
 * the constraint, because a cross-row SUM cannot be a row CHECK).
 * `record_timesheet_payment` puts the sum and the insert in ONE body behind a
 * `FOR UPDATE` lock on the week's timesheet row — the same 050/051 shape.
 *
 * This test pins the SQL's half of that contract. It cannot execute Postgres,
 * so it reads the migration as source: the anchor lock, the ordering of the
 * over-payment refusal against the insert, and the fact that every
 * week-describing column on the inserted row is stamped from the LOCKED row
 * rather than from a caller argument. Behaviour under real concurrency is not
 * reachable from a unit test in this repo — this file is what stands in for it.
 *
 * The SQL parsing below is quote- and dollar-quote-aware, adapted from
 * `migration042TimesheetEarnings.test.ts` (the helpers are not exported there,
 * so they are reproduced rather than imported).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '077_payment_atomic_insert.sql';
const FUNCTION = 'public.record_timesheet_payment';
/** The exact type list every revoke/grant must name — D46's overload trap. */
const SIGNATURE = '(uuid, integer, date, text, uuid)';

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
// `;` inside the plpgsql body does not split the function in half.
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
const statements = splitStatements(migrationSql)
  .map(normalise)
  .filter(Boolean)
  .map(statement => statement.toLowerCase());
/** Executable SQL only — the header comment is deliberately excluded. */
const executable = statements.join('; ');

/** Only the `--` comment lines, lowercased — the documentation contract. */
const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** The one statement that defines the function, body and all. */
const definitions = statements.filter(statement =>
  statement.startsWith(`create or replace function ${FUNCTION}`)
);
const definition = definitions[0] ?? '';

/** Source offset of a fragment inside the function definition, or -1. */
function at(fragment: string): number {
  return definition.indexOf(fragment);
}

/**
 * The insert's column list zipped against its values list, so "which
 * expression fills `carer_id`" is a direct lookup rather than a substring
 * search that would pass on a merely-mentioned identifier.
 */
function parseInsertedValues(): Map<string, string> {
  const match =
    /insert into public\.payments\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/.exec(
      definition
    );
  const columns = (match?.[1] ?? '').split(',').map(part => part.trim());
  const values = (match?.[2] ?? '').split(',').map(part => part.trim());
  const pairs = new Map<string, string>();
  columns.forEach((column, index) => {
    if (column) pairs.set(column, values[index] ?? '');
  });
  return pairs;
}

describe('077_payment_atomic_insert.sql — the function it defines', () => {
  it('defines exactly one function, record_timesheet_payment', () => {
    expect(definitions).toHaveLength(1);
  });

  it('takes the five planned parameters, in order, and returns jsonb', () => {
    expect(definition).toContain(
      `create or replace function ${FUNCTION}(p_timesheet_id uuid, p_amount_minor integer, p_paid_at date, p_method_note text, p_recorded_by uuid) returns jsonb`
    );
  });

  it('is plpgsql, SECURITY INVOKER, with a pinned search_path (050/051 shape)', () => {
    expect(definition).toContain('language plpgsql');
    expect(definition).toContain('security invoker');
    expect(definition).toContain('set search_path = public');
    // security definer would run the insert as the function owner, which is
    // exactly the escalation 050's header refuses.
    expect(definition).not.toContain('security definer');
  });
});

describe('077_payment_atomic_insert.sql — the anchor lock', () => {
  it('locks the week’s timesheet row FOR UPDATE', () => {
    expect(definition).toContain('from public.timesheets');
    expect(definition).toContain('where id = p_timesheet_id');
    expect(definition).toContain('for update');
  });

  it('takes the lock BEFORE it sums anything — the whole point of the migration', () => {
    expect(at('for update')).toBeGreaterThan(-1);
    expect(at('sum(amount_minor)')).toBeGreaterThan(at('for update'));
  });

  it('re-checks approved + a frozen gross UNDER the lock, not just before it', () => {
    // A reopen can land between the service's read and this lock, so the
    // status and the two snapshot columns are re-read from the locked row.
    expect(at("v_timesheet.status <> 'approved'")).toBeGreaterThan(
      at('for update')
    );
    expect(definition).toContain('v_timesheet.gross_minor is null');
    expect(definition).toContain('v_timesheet.currency is null');
    expect(definition).toContain("'not_payable'");
  });
});

describe('077_payment_atomic_insert.sql — sum and insert in ONE body', () => {
  it('sums the week’s existing payments in the same statement that inserts', () => {
    expect(definition).toContain('coalesce(sum(amount_minor), 0)');
    expect(definition).toContain('from public.payments');
    expect(definition).toContain('where timesheet_id = p_timesheet_id');
    expect(definition).toContain('insert into public.payments');
  });

  it('has no insert into payments anywhere OUTSIDE the function body', () => {
    const outside = statements.filter(
      statement => statement !== definition && statement.includes('insert into')
    );
    expect(outside).toEqual([]);
  });

  it('refuses over-gross BEFORE the insert, and reports both figures', () => {
    expect(at("'exceeds_gross'")).toBeGreaterThan(-1);
    expect(at("'exceeds_gross'")).toBeLessThan(
      at('insert into public.payments')
    );
    expect(definition).toContain('already_paid_minor');
    expect(definition).toContain('gross_minor');
  });

  it('refuses, never clamps — no least()/greatest() trimming the amount', () => {
    expect(definition).not.toContain('least(');
    expect(definition).not.toContain('greatest(');
  });
});

describe('077_payment_atomic_insert.sql — the row is stamped from the LOCKED week', () => {
  const STAMPED_FROM_TIMESHEET: ReadonlyArray<readonly [string, string]> = [
    ['timesheet_id', 'v_timesheet.id'],
    ['household_id', 'v_timesheet.household_id'],
    ['carer_id', 'v_timesheet.carer_id'],
    ['currency', 'v_timesheet.currency'],
  ];

  const FROM_CALLER: ReadonlyArray<readonly [string, string]> = [
    ['amount_minor', 'p_amount_minor'],
    ['paid_at', 'p_paid_at'],
    ['method_note', 'p_method_note'],
    ['recorded_by', 'p_recorded_by'],
  ];

  for (const [column, expression] of STAMPED_FROM_TIMESHEET) {
    it(`fills ${column} from ${expression}, never from a caller argument`, () => {
      const value = parseInsertedValues().get(column);
      expect(value).toBe(expression);
      expect(value).not.toContain('p_');
    });
  }

  for (const [column, expression] of FROM_CALLER) {
    it(`fills ${column} from ${expression} — the caller's own half of the row`, () => {
      expect(parseInsertedValues().get(column)).toBe(expression);
    });
  }

  it('returns the inserted row alongside the recorded outcome', () => {
    expect(definition).toContain("'recorded'");
    expect(definition).toContain('to_jsonb(v_payment)');
  });
});

describe('077_payment_atomic_insert.sql — grants name the exact signature (D46)', () => {
  for (const role of ['public', 'anon', 'authenticated']) {
    it(`revokes all from ${role}`, () => {
      expect(executable).toContain(
        `revoke all on function ${FUNCTION}${SIGNATURE} from ${role}`
      );
    });
  }

  it('grants execute to service_role only', () => {
    expect(executable).toContain(
      `grant execute on function ${FUNCTION}${SIGNATURE} to service_role`
    );
    expect(executable).not.toContain('to authenticated');
    expect(executable).not.toContain('to anon');
  });
});

describe('077_payment_atomic_insert.sql — documentation contract', () => {
  it('records the D46 overload trap: a future signature change drops the exact old signature first', () => {
    expect(commentText).toContain('d46');
    expect(commentText).toContain('drop function');
  });

  it('records that there is no 23505 path today, and what would add one', () => {
    expect(commentText).toContain('23505');
    expect(commentText).toContain('unique_violation');
  });

  it('records why the lock anchors on the timesheet row rather than an advisory lock', () => {
    expect(commentText).toContain('advisory');
  });
});
