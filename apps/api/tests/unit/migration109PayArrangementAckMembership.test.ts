/**
 * @module tests/unit/migration109PayArrangementAckMembership.test
 * Pattern A — migration contract for
 * `109_pay_arrangement_ack_membership.sql`.
 *
 * 081's ack/dissent INSERT policy checked only `carer_id = auth.uid()` and
 * that the arrangement belongs to her — no `status = 'active'` membership
 * check, unlike every other write policy in the schema (009's
 * `is_household_parent` / 040's `can_write_household` wrappers all carry
 * one). A carer removed from the household could still insert an ack via
 * PostgREST. This migration drops and recreates the policy with the missing
 * membership predicate, reusing `private.can_read_household` rather than
 * inlining a new EXISTS.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '109_pay_arrangement_ack_membership.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');
const priorSql = readFileSync(
  join(migrationsDir, '081_pay_arrangement_acks.sql'),
  'utf8'
);

const strip = (sql: string): string =>
  sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const executable = strip(migrationSql);

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('109 — drops and recreates the insert policy', () => {
  it('drops the existing policy by its exact 081 name', () => {
    expect(executable).toContain(
      'drop policy if exists "the carer can ack or dissent her own arrangement" on public.pay_arrangement_acks'
    );
  });

  it('recreates a policy of the same name, for insert', () => {
    expect(executable).toContain(
      'create policy "the carer can ack or dissent her own arrangement" on public.pay_arrangement_acks'
    );
    expect(executable).toContain('for insert with check');
  });

  it('081 itself had no membership predicate on the insert policy — that is the bug', () => {
    const priorInsertPolicy = strip(priorSql).split('for insert with check')[1];
    expect(priorInsertPolicy).toBeDefined();
    expect(priorInsertPolicy).not.toContain('can_read_household');
    expect(priorInsertPolicy).not.toContain('can_write_household');
    expect(priorInsertPolicy).not.toContain('is_household_member');
  });
});

describe('109 — the missing membership predicate', () => {
  it('reuses the existing helper rather than inlining a new EXISTS', () => {
    expect(executable).toContain('private.can_read_household(pa.household_id)');
  });

  it('still requires carer_id = auth.uid() on the row being inserted', () => {
    expect(executable).toContain('carer_id = (select auth.uid())');
  });

  it('still requires the arrangement to be hers', () => {
    expect(executable).toContain('pa.carer_id = (select auth.uid())');
  });
});

describe('109 — documentation contract', () => {
  for (const phrase of ['081', 'membership', 'removed']) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
