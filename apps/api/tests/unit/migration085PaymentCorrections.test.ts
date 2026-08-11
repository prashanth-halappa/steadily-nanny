/**
 * @module tests/unit/migration085PaymentCorrections.test
 * Pattern A — migration contract for `085_payment_corrections.sql` (D-20, P3).
 *
 * 067 made `payments` append-only and forbade the offsetting row with
 * `amount_minor >= 1`, while `PaymentDetailSheet` told the parent "a correction
 * is recorded as another payment". D-20 makes that sentence true: a
 * `correction`-kind row carrying a NEGATIVE amount and pointing at the payment
 * it corrects. The original is never touched.
 *
 * SIGNED STORAGE IS THE WHOLE DESIGN, and this file pins it. Because a
 * correction row's `amount_minor` is negative, `sum(amount_minor)` over a
 * week's rows IS paid-to-date-with-corrections — the same expression 077's
 * over-gross gate already computes. The trap is a future reader "tidying" that
 * sum with `where kind = 'payment'`, which would refuse valid payments after a
 * downward correction; 085 re-issues the function with that warning at the
 * emit site, and the tests below hold both halves.
 *
 * It cannot execute Postgres, so it reads the migration as source, with the
 * same quote-/dollar-quote-aware parser `migration077PaymentAtomicInsert.test`
 * uses (the helpers are not exported there, so they are reproduced).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '085_payment_corrections.sql';
const RECORD_PAYMENT = 'public.record_timesheet_payment';
const RECORD_CORRECTION = 'public.record_payment_correction';
/** The exact type lists every revoke/grant must name — D46's overload trap. */
const RECORD_PAYMENT_SIGNATURE = '(uuid, integer, date, text, uuid)';
const RECORD_CORRECTION_SIGNATURE = '(uuid, uuid, integer, date, text, uuid)';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

// ---------------------------------------------------------------------------
// SQL parsing — `--` comments stripped, `'...'` and `$$ ... $$` respected.
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
const executable = statements.join('; ');

/** Only the `--` comment lines, lowercased — the documentation contract. */
const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

function definitionOf(fn: string): string {
  return (
    statements.find(statement =>
      statement.startsWith(`create or replace function ${fn}`)
    ) ?? ''
  );
}

const correction = definitionOf(RECORD_CORRECTION);
const payment = definitionOf(RECORD_PAYMENT);

/** Source offset of a fragment inside a function definition, or -1. */
function at(definition: string, fragment: string): number {
  return definition.indexOf(fragment);
}

/** Zip an insert's column list against its values list. */
function parseInsertedValues(definition: string): Map<string, string> {
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

describe('085 — the correction columns on payments', () => {
  it('adds kind, defaulting to payment so every 067 row stays a payment', () => {
    expect(executable).toContain('add column if not exists kind text');
    expect(executable).toContain("default 'payment'");
  });

  it('constrains kind to exactly the two values the wire knows', () => {
    expect(executable).toContain("kind in ('payment', 'correction')");
  });

  it('adds corrects_payment_id as a self-FK on payments', () => {
    expect(executable).toContain(
      'add column if not exists corrects_payment_id uuid references public.payments(id) on delete cascade'
    );
  });

  it('adds correction_reason — a reversal with no reason is unreadable a year later', () => {
    expect(executable).toContain(
      'add column if not exists correction_reason text'
    );
  });

  it('indexes the back-reference, so summing a payment’s reversals is not a scan', () => {
    expect(executable).toContain('create index if not exists');
    expect(executable).toContain('public.payments (corrects_payment_id)');
  });
});

describe('085 — the amount check relaxes to SIGNED, not to anything', () => {
  it('drops 067’s amount_minor >= 1 check by its exact auto-generated name', () => {
    expect(executable).toContain(
      'drop constraint if exists payments_amount_minor_check'
    );
  });

  it('keeps 063’s ceiling on BOTH sides of zero and still forbids zero', () => {
    expect(executable).toContain('amount_minor <> 0');
    expect(executable).toContain('amount_minor >= -99999999');
    expect(executable).toContain('amount_minor <= 99999999');
  });

  it('ties sign, reason and back-reference to the kind in ONE shape check', () => {
    expect(executable).toContain('payments_kind_shape_chk');
    // A payment: positive, standalone, no reason.
    expect(executable).toContain(
      "kind = 'payment' and corrects_payment_id is null and correction_reason is null and amount_minor >= 1"
    );
    // A correction: negative, pointed at a row, reason required.
    expect(executable).toContain(
      "kind = 'correction' and corrects_payment_id is not null and correction_reason is not null and amount_minor <= -1"
    );
  });
});

describe('085 — record_payment_correction, the atomic correction path', () => {
  it('defines the function with its six parameters, in order, returning jsonb', () => {
    expect(correction).toContain(
      `create or replace function ${RECORD_CORRECTION}(p_timesheet_id uuid, p_corrects_payment_id uuid, p_amount_minor integer, p_paid_at date, p_reason text, p_recorded_by uuid) returns jsonb`
    );
  });

  it('is plpgsql, SECURITY INVOKER, pinned search_path (050/051/077 shape)', () => {
    expect(correction).toContain('language plpgsql');
    expect(correction).toContain('security invoker');
    expect(correction).toContain('set search_path = public');
    expect(correction).not.toContain('security definer');
  });

  it('anchors on the week’s timesheet row FOR UPDATE, exactly as 077 does', () => {
    expect(correction).toContain('from public.timesheets');
    expect(correction).toContain('where id = p_timesheet_id');
    expect(at(correction, 'for update')).toBeGreaterThan(-1);
  });

  it('takes the anchor lock BEFORE it sums the original’s reversals', () => {
    expect(at(correction, 'coalesce(sum(amount_minor), 0)')).toBeGreaterThan(
      at(correction, 'for update')
    );
  });

  it('loads the original from the SAME timesheet — a payment cannot be corrected from another week', () => {
    expect(correction).toContain('where id = p_corrects_payment_id');
    expect(correction).toContain('timesheet_id = p_timesheet_id');
  });

  it('refuses a chain: only a payment-kind row is correctable', () => {
    expect(correction).toContain("v_original.kind <> 'payment'");
    expect(correction).toContain("'not_correctable'");
  });

  it('bounds the reversal by what is LEFT of the original, and refuses over it', () => {
    expect(correction).toContain("'exceeds_original'");
    expect(correction).toContain('remaining_minor');
    expect(at(correction, "'exceeds_original'")).toBeLessThan(
      at(correction, 'insert into public.payments')
    );
  });

  it('refuses, never clamps — no least()/greatest() trimming the reversal', () => {
    expect(correction).not.toContain('least(');
    expect(correction).not.toContain('greatest(');
  });

  it('does NOT require an approved week — a reopened week is still correctable (spec §4.1, P16)', () => {
    expect(correction).not.toContain("v_timesheet.status <> 'approved'");
  });

  const STAMPED_FROM_ORIGINAL: ReadonlyArray<readonly [string, string]> = [
    ['timesheet_id', 'v_original.timesheet_id'],
    ['household_id', 'v_original.household_id'],
    ['carer_id', 'v_original.carer_id'],
    ['currency', 'v_original.currency'],
  ];

  for (const [column, expression] of STAMPED_FROM_ORIGINAL) {
    it(`fills ${column} from ${expression}, never from a caller argument`, () => {
      const value = parseInsertedValues(correction).get(column);
      expect(value).toBe(expression);
      expect(value).not.toContain('p_');
    });
  }

  it('writes the correction kind as a literal, never from the caller', () => {
    expect(parseInsertedValues(correction).get('kind')).toBe("'correction'");
  });

  it('returns the inserted row alongside the recorded outcome', () => {
    expect(correction).toContain("'recorded'");
    expect(correction).toContain('to_jsonb(v_correction)');
  });
});

describe('085 — record_timesheet_payment is re-issued, correction-aware', () => {
  it('re-issues the function with the IDENTICAL argument list (D46: a true replace, no drop needed)', () => {
    expect(payment).toContain(
      `create or replace function ${RECORD_PAYMENT}(p_timesheet_id uuid, p_amount_minor integer, p_paid_at date, p_method_note text, p_recorded_by uuid) returns jsonb`
    );
  });

  it('does not drop record_timesheet_payment — the arg list is unchanged, so there is no overload to strand', () => {
    expect(executable).not.toContain(
      `drop function if exists ${RECORD_PAYMENT}`
    );
  });

  it('still sums the WHOLE week — the where clause is the timesheet filter and NOTHING else', () => {
    expect(payment).toContain('coalesce(sum(amount_minor), 0)');
    // Asserted as the whole predicate, not a substring: `and kind = 'payment'`
    // is the tidy-up that breaks the gate, and a `toContain` on the timesheet
    // filter alone would still pass with it appended.
    const sumWhere =
      /into v_already_paid_minor from public\.payments where ([^;]*);/.exec(
        payment
      )?.[1] ?? '';
    expect(sumWhere.trim()).toBe('timesheet_id = p_timesheet_id');
  });

  it('names the trap in the body, where the tidy-up would be typed', () => {
    expect(migrationSql.toLowerCase()).toContain(
      'do not add a kind filter to this sum'
    );
  });

  it('still refuses over-gross before the insert, and still never clamps', () => {
    expect(at(payment, "'exceeds_gross'")).toBeLessThan(
      at(payment, 'insert into public.payments')
    );
    expect(payment).not.toContain('least(');
    expect(payment).not.toContain('greatest(');
  });

  it('stamps the payment kind explicitly rather than leaning on the column default', () => {
    expect(parseInsertedValues(payment).get('kind')).toBe("'payment'");
  });
});

describe('085 — grants (GOLDEN #16) and the D46 signature discipline', () => {
  for (const [fn, signature] of [
    [RECORD_PAYMENT, RECORD_PAYMENT_SIGNATURE],
    [RECORD_CORRECTION, RECORD_CORRECTION_SIGNATURE],
  ] as const) {
    it(`revokes ${fn} from public, anon and authenticated by its exact signature`, () => {
      for (const role of ['public', 'anon', 'authenticated']) {
        expect(executable).toContain(
          `revoke all on function ${fn}${signature} from ${role}`
        );
      }
    });

    it(`grants execute on ${fn} to service_role only`, () => {
      expect(executable).toContain(
        `grant execute on function ${fn}${signature} to service_role`
      );
    });
  }
});

describe('085 — the header carries the decisions, not just the DDL', () => {
  it('explains why the original row is never edited (append-only preserved)', () => {
    expect(commentText).toContain('append-only');
  });

  it('records the D46 judgement in prose, so the next change re-derives it', () => {
    expect(commentText).toContain('d46');
  });

  it('states that paid-to-date is the SIGNED sum', () => {
    expect(commentText).toContain('signed');
  });
});
