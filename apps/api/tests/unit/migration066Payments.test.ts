/**
 * @module tests/unit/migration066Payments.test
 * Pattern A — migration contract for `066_payments.sql`, written BEFORE the
 * migration existed (055/059/063 discipline).
 *
 * The missing half of the pay loop: the app freezes what a week is WORTH at
 * approval (042) but has nowhere to record that it was PAID. "Have I paid
 * week 12?" is unanswerable, for the parent who paid it and the carer who was
 * paid. This table is the settlement ledger — one row per real-world payment
 * against an approved week's frozen gross, partial payments allowed.
 *
 * Append-only, like 041/043: a payment is a fact about money that moved
 * outside the app, not app state. There is no updated_at and no trigger; a
 * mistaken row is corrected by the service refusing over-payment, never by
 * mutating history.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '066_payments.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

/** Executable SQL only — `--` comment lines dropped, whitespace collapsed. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('066 — payments table shape', () => {
  it('creates public.payments idempotently', () => {
    expect(executable).toContain('create table if not exists public.payments');
  });

  it('cascades from the timesheet but SET NULLs people — 033 discipline', () => {
    // The payment record belongs to the household's money history: deleting a
    // timesheet takes its payments with it, but a person deleting their
    // account must never delete the household's record of being paid.
    expect(executable).toContain(
      'references public.timesheets(id) on delete cascade'
    );
    const carerRef =
      /carer_id\s+uuid\s+references public\.user_profiles\(user_id\)\s+on delete set null/;
    const recorderRef =
      /recorded_by\s+uuid\s+references public\.user_profiles\(user_id\)\s+on delete set null/;
    expect(carerRef.test(executable)).toBe(true);
    expect(recorderRef.test(executable)).toBe(true);
  });

  it('bounds amount_minor above zero and at the shared money ceiling', () => {
    // Same figure as 063 pins everywhere else: entry form, wire, and table
    // agree on 99_999_999. A floor alone is half a bound.
    expect(executable).toContain('amount_minor >= 1');
    expect(executable).toContain('amount_minor <= 99999999');
  });

  it('pins the ISO-4217 currency shape 041 uses', () => {
    expect(executable).toContain("currency ~ '^[a-z]{3}$'");
  });

  it('records the settlement day as a date, not an instant', () => {
    expect(/paid_at\s+date\s+not null/.test(executable)).toBe(true);
  });

  it('is append-only: no updated_at, no trigger', () => {
    // 041/043's contract, not 044's: nothing ever mutates a payment row.
    expect(executable).not.toContain('updated_at');
    expect(executable).not.toContain('create trigger');
  });

  it('indexes the per-timesheet and per-household read paths', () => {
    expect(executable).toContain('on public.payments (timesheet_id)');
    expect(executable).toContain('on public.payments (household_id, paid_at)');
  });
});

describe('066 — RLS: select-only, money-table read circle', () => {
  it('enables RLS', () => {
    expect(executable).toContain(
      'alter table public.payments enable row level security'
    );
  });

  it('lets parents and the paid carer read, nobody else — 041/043/044 shape', () => {
    // NOT can_read_household: a helper or second nanny must never see
    // someone else's money. can_write_household bare, carer self-arm wrapped
    // (040 trap 2 / 018 initplan discipline).
    expect(executable).toContain('private.can_write_household(household_id)');
    expect(executable).toContain('carer_id = (select auth.uid())');
  });

  it('grants no client write path of any kind', () => {
    expect(executable).not.toContain('for insert');
    expect(executable).not.toContain('for update');
    expect(executable).not.toContain('for delete');
    expect(executable).not.toContain('for all');
  });
});

describe('066 — documentation contract', () => {
  for (const phrase of [
    // What this closes.
    'settlement',
    // The number payments are validated against, and where it froze.
    'frozen',
    // Why rows never mutate.
    'append-only',
    // The over-payment guard lives in the service, not a CHECK — a
    // cross-row SUM cannot be a row CHECK, and the reader must know where
    // the real gate is.
    'service',
  ]) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
