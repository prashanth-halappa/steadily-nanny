/**
 * @module tests/unit/migration097TermsDeclined.test
 * Pattern A — migration contract for `097_terms_declined.sql` (B4).
 *
 * B4: a counterparty had no way to refuse a terms proposal — `withdraw` in
 * `termsProposalCommandService` only lets the AUTHOR close a round. This
 * migration widens the lifecycle with a real `declined` status, distinct from
 * `withdrawn`: one is the author taking her own ask back, the other is the
 * other side saying no. Same discipline as `069_time_entry_void.sql`'s status
 * widening — a CHECK cannot be extended in place, so this drops and re-adds
 * the constraint under its ORIGINAL auto-generated name
 * (`terms_proposals_status_check`, unnamed inline check ⇒ `<table>_<column>_check`,
 * confirmed against every other status-check migration in this repo — see
 * e.g. 069's `time_entries_status_check`, 068's `carer_time_off_kind_check`).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '097_terms_declined.sql';
const PRIOR = '092_terms_proposals.sql';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

function executableOf(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function commentTextOf(sql: string): string {
  return sql
    .split('\n')
    .filter(line => line.trimStart().startsWith('--'))
    .map(line => line.trimStart().replace(/^--\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const migrationSql = readMigration(MIGRATION);
const executable = executableOf(migrationSql);
const commentText = commentTextOf(migrationSql);
const priorExecutable = executableOf(readMigration(PRIOR));

describe('097 — widens the lifecycle with declined', () => {
  it('drops the ORIGINAL unnamed status check by its auto-generated name', () => {
    expect(executable).toContain(
      'alter table public.terms_proposals drop constraint if exists terms_proposals_status_check'
    );
  });

  it('re-adds the check with all five state words, under the same name', () => {
    expect(executable).toContain(
      "alter table public.terms_proposals add constraint terms_proposals_status_check check (status in ('proposed', 'countered', 'accepted', 'withdrawn', 'declined'))"
    );
  });

  it('does not touch withdrawn — declined is a distinct fact, not an overload', () => {
    expect(commentText).toContain('declined');
    expect(commentText).toContain('withdrawn');
  });
});

describe('097 — the partial open-proposal index needs no change', () => {
  // GOLDEN-FIXES #31-adjacent: verify the claim against 092 itself rather than
  // asserting it blind — a `declined` row leaves `status = 'proposed'` exactly
  // like every other terminal status, so the partial index
  // (`where status = 'proposed'`) already frees the slot for a new round.
  it('092’s open-proposal index is scoped to proposed and needs no migration here', () => {
    expect(priorExecutable).toContain(
      "create unique index if not exists terms_proposals_open_unique_idx on public.terms_proposals (household_id, carer_id) where status = 'proposed'"
    );
  });

  it('097 itself creates or drops no index — the partial index is untouched', () => {
    expect(executable).not.toContain('index');
  });
});

describe('097 — documents the declined vs withdrawn distinction', () => {
  it('comments on the status column explaining the new state', () => {
    expect(executable).toContain(
      'comment on column public.terms_proposals.status'
    );
  });
});
