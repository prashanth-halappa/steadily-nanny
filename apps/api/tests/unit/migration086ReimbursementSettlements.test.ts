/**
 * @module tests/unit/migration086ReimbursementSettlements.test
 * Pattern A — migration contract for `086_reimbursement_settlements.sql`
 * (D-14, gap P7).
 *
 * Approved reimbursements are excluded from gross, from payable minutes and
 * from the payment ceiling by construction (`earningsService.ts` — the
 * `REIMBURSEMENTS` branch of the line fold) — and were then tracked nowhere as
 * repaid. Money owed and tracked nowhere becomes a dispute. D-14 gives them a
 * settlement record PARALLEL to payments, never merged into them.
 *
 * The thing this file is really guarding is the MERGE. A settled
 * reimbursement and a recorded payment look like the same shape, and "why are
 * there two tables for money going to the same person" is the question that
 * precedes someone folding one into the other — at which point reimbursements
 * enter the gross ceiling and the money engine is wrong. The assertions below
 * hold the separation structurally: its own table, no `timesheet_id`, and a
 * header that says why in words a future reader will hit before they type the
 * migration that merges them.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '086_reimbursement_settlements.sql';
const TABLE = 'public.reimbursement_settlements';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

const migrationSql = readMigration(MIGRATION);
/** Executable SQL only, whitespace-flattened and lowercased. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** Only the `--` comment lines — the documentation contract. */
const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('086 — the table', () => {
  it('creates reimbursement_settlements, not a column on payments', () => {
    expect(executable).toContain(`create table if not exists ${TABLE}`);
    expect(executable).not.toContain('alter table public.payments');
  });

  it('carries NO timesheet_id — a reimbursement is not settled against a week’s gross', () => {
    expect(executable).not.toContain('timesheet_id');
  });

  it('is keyed on the household-local week the claims fall in', () => {
    expect(executable).toContain('week_start date not null');
  });

  it('stores an integer minor amount with a sibling currency (docs/11-MONEY.md §1)', () => {
    expect(executable).toContain('amount_minor integer not null');
    expect(executable).toContain(
      'check (amount_minor >= 1 and amount_minor <= 99999999)'
    );
    expect(executable).toContain(
      "check (currency ~ '^[a-z]{3}$')".toLowerCase()
    );
  });

  it('records WHEN it was settled as a calendar day, like payments.paid_at', () => {
    expect(executable).toContain('settled_at date not null');
  });

  it('follows 033: household cascades, people SET NULL', () => {
    expect(executable).toContain(
      'household_id uuid not null references public.households(id) on delete cascade'
    );
    expect(executable).toContain(
      'carer_id uuid references public.user_profiles(user_id) on delete set null'
    );
    expect(executable).toContain(
      'recorded_by uuid references public.user_profiles(user_id) on delete set null'
    );
  });

  it('is append-only: no updated_at, no set_updated_at trigger', () => {
    expect(executable).not.toContain('updated_at');
    expect(executable).not.toContain('set_updated_at');
  });
});

describe('086 — one settlement per carer-week, enforced by the database', () => {
  it('has a UNIQUE index on (household, carer, week) — the double-tap guard', () => {
    expect(executable).toContain(
      'create unique index if not exists reimbursement_settlements_week_idx'
    );
    expect(executable).toContain(
      `on ${TABLE} (household_id, carer_id, week_start)`
    );
  });

  it('leaves the race to the constraint rather than a plpgsql lock', () => {
    // 077 needed a function because its invariant is a cross-row SUM against a
    // ceiling. This one is "at most one row", which is exactly what a unique
    // index is for — the repository translates 23505, the way
    // `expenseRepository.create` translates 051's.
    expect(executable).not.toContain('create or replace function');
    expect(executable).not.toContain('for update');
  });
});

describe('086 — RLS: the money read circle, 067/044 shape verbatim', () => {
  it('enables row level security', () => {
    expect(executable).toContain(
      `alter table ${TABLE} enable row level security`
    );
  });

  it('lets parents and the carer read, and nobody else — never can_read_household', () => {
    expect(executable).toContain(
      'private.can_write_household(household_id) or carer_id = (select auth.uid())'
    );
    expect(executable).not.toContain('can_read_household');
  });

  it('has no insert/update/delete policy — writes go through the service role', () => {
    expect(executable).not.toContain('for insert');
    expect(executable).not.toContain('for update');
    expect(executable).not.toContain('for delete');
  });
});

describe('086 — the header carries the D20 guard against the merge', () => {
  it('states that settlements are NOT payments', () => {
    expect(commentText).toContain('not payments');
  });

  it('names the three exclusions that must survive', () => {
    expect(commentText).toContain('gross');
    expect(commentText).toContain('payable minutes');
    expect(commentText).toContain('payment ceiling');
  });

  it('says do not merge the tables, in words', () => {
    expect(commentText).toContain('do not merge these tables');
  });

  it('records that no correction path is built here, and why (YAGNI, spec §4.2)', () => {
    expect(commentText).toContain('yagni');
  });
});
