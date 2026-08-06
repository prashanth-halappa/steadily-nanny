/**
 * @module tests/unit/migration051ExpensePendingDedupe.test
 * Pattern A — migration contract for `051_expense_pending_dedupe.sql`.
 *
 * Written BEFORE the migration exists (TDD red-first), like 043/044/045's.
 *
 * TWO defects, one migration, because both live in the same write path.
 *
 * F-B4-1 — APPROVING AN EXPENSE RACES THE TIMESHEET FREEZE.
 * `expenseCommandService.review` pre-checked "is this week's timesheet already
 * approved?" with a plain read, then wrote with a CAS whose WHERE clause knew
 * nothing about timesheets. Interleave the two and the expense commits
 * `approved` a moment after the week's earnings snapshot froze without it:
 * a reimbursement that is owed, on a row, appearing on no statement anyone
 * reads (`docs/11-MONEY.md` §3 — approved weeks never recompute).
 * `expenseRepository`'s own header states the rule the pre-check broke: "the
 * guard lives in the WHERE clause of the write itself, not just in a
 * pre-check". `review_pending_expense` puts it there — it locks the week's
 * timesheet row FOR UPDATE first (024's anchor-row pattern), so the two
 * writes can no longer interleave at all, and then TOUCHES that row's
 * `updated_at` on success so the OTHER direction closes too: an in-flight
 * timesheet approve, whose CAS pins `updated_at`, loses and recomputes with
 * the reimbursement in it rather than freezing a statement without it.
 *
 * F-B4-6 — A DOUBLE-TAPPED POST CREATED TWO PAYABLE ROWS.
 * `create` had no idempotency key and no dedupe, so a retry on a flaky
 * network filed the claim twice; a parent approving both doubled
 * `reimbursements_minor` at freeze. The partial unique index makes the second
 * insert a 23505 the repository translates, the same shape 039/043/045 use.
 * PARTIAL on `status = 'pending'` deliberately: once the first claim is
 * reviewed the identity is free again, so a carer who really does file the
 * same £4 parking fee twice is only ever asked to differentiate it while both
 * are still unreviewed.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractFunctionBody,
  extractFunctionGrantBlock,
  statementPrecedes,
} from '../helpers/sqlMigrationHelpers';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '051_expense_pending_dedupe.sql';
const INDEX = 'expenses_one_pending_claim_idx';
const FN = 'review_pending_expense';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

/** Executable SQL: `--` comment lines stripped, whitespace flattened. */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
    .toLowerCase();
}

/** Only the `--` comment lines — the documentation contract. */
function commentText(sql: string): string {
  return sql
    .split('\n')
    .filter(line => line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const migrationSql = readMigration(MIGRATION);
const executable = executableSql(migrationSql);
const comments = commentText(migrationSql);
const body = extractFunctionBody(migrationSql, FN).toLowerCase();

// ---------------------------------------------------------------------------
// F-B4-6 — the pending-claim dedupe index
// ---------------------------------------------------------------------------

describe('051 — expenses_one_pending_claim_idx', () => {
  it('creates the dedupe index idempotently', () => {
    expect(executable).toContain(
      `create unique index if not exists ${INDEX} on public.expenses`
    );
  });

  it('is PARTIAL on pending — a reviewed claim frees the identity again', () => {
    const clause = executable.slice(executable.indexOf(INDEX));
    expect(clause).toContain("where status = 'pending'");
  });

  it('keys on the full claim identity, not just (carer, date, amount)', () => {
    const clause = executable.slice(
      executable.indexOf(INDEX),
      executable.indexOf("where status = 'pending'")
    );
    for (const column of [
      'household_id',
      'carer_id',
      'local_date',
      'kind',
      'description',
      'currency',
    ]) {
      expect(clause).toContain(column);
    }
  });

  it('coalesces the two kind-conditional money columns so NULLs compare', () => {
    // `amount_minor` is null on an unapproved mileage row and `miles` is null
    // on every expense row; NULLs are DISTINCT in a unique index, so without
    // coalesce the index would never fire for either kind.
    const clause = executable.slice(executable.indexOf(INDEX));
    expect(clause).toContain('coalesce(amount_minor, -1)');
    expect(clause).toContain('coalesce(miles, -1)');
  });
});

// ---------------------------------------------------------------------------
// F-B4-1 — review_pending_expense
// ---------------------------------------------------------------------------

describe('051 — review_pending_expense, the freeze guard in the write', () => {
  it('is plpgsql, security invoker, with a pinned search_path', () => {
    expect(executable).toContain(`create or replace function public.${FN}`);
    expect(executable).toContain('language plpgsql');
    expect(executable).toContain('security invoker');
    expect(executable).toContain('set search_path = public');
  });

  it('returns an outcome jsonb rather than raising', () => {
    expect(executable).toContain('returns jsonb');
    expect(body).toContain("'outcome', 'reviewed'");
    expect(body).toContain("'outcome', 'not_pending'");
    expect(body).toContain("'outcome', 'week_locked'");
    expect(body).not.toContain('raise exception');
  });

  it('LOCKS the week’s timesheet row before it touches the expense', () => {
    expect(body).toContain('from public.timesheets');
    expect(body).toContain('for update');
    statementPrecedes(body, 'for update', 'update public.expenses');
  });

  it('refuses when the locked timesheet is already approved', () => {
    const locked = body.slice(0, body.indexOf('update public.expenses'));
    expect(locked).toContain("v_timesheet.status = 'approved'");
  });

  it('keeps the status CAS in the expense UPDATE’s own WHERE clause', () => {
    const update = body.slice(body.indexOf('update public.expenses'));
    expect(update).toContain('where id = p_expense_id');
    expect(update).toContain('and household_id = p_household_id');
    expect(update).toContain("and status = 'pending'");
  });

  it('only sets amount_minor when the caller computed one', () => {
    // A rejection, and an ordinary expense approval, must not blank the
    // amount the row already carries.
    expect(body).toContain('coalesce(p_amount_minor, amount_minor)');
  });

  it('TOUCHES the timesheet so an in-flight approve’s updated_at CAS loses', () => {
    // The other half of the race: `approveSubmittedWithEarnings` pins
    // `updated_at`, and nothing about approving an expense used to bump it.
    const after = body.slice(body.indexOf('update public.expenses') + 1);
    expect(after).toContain('update public.timesheets');
    expect(after).toContain('updated_at = now()');
  });

  it('is service_role only', () => {
    const grants = extractFunctionGrantBlock(migrationSql, FN).toLowerCase();
    expect(grants).toContain('from public');
    expect(grants).toContain('from anon');
    expect(grants).toContain('from authenticated');
    expect(grants).toContain('to service_role');
  });

  it('carries a comment on the function', () => {
    expect(executable).toContain(`comment on function public.${FN}`);
  });
});

// ---------------------------------------------------------------------------
// Additive
// ---------------------------------------------------------------------------

describe('051 — additive and non-destructive', () => {
  it('drops no table and no column', () => {
    expect(executable).not.toContain('drop table');
    expect(executable).not.toContain('drop column');
  });

  it('rewrites no existing rows', () => {
    expect(executable).not.toMatch(/\b(insert into|delete from)\b/);
  });

  it('touches no RLS policy — 044 already settled that stance', () => {
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
  });
});

describe('051 — documentation contract', () => {
  const phrases = [
    'f-b4-1',
    'f-b4-6',
    'anchor row',
    'double-tap',
    'partial',
    'updated_at',
  ];
  for (const phrase of phrases) {
    it(`documents "${phrase}" in the header`, () => {
      expect(comments).toContain(phrase);
    });
  }
});
