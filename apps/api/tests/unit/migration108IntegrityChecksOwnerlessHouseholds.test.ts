/**
 * @module tests/unit/migration108IntegrityChecksOwnerlessHouseholds.test
 * Pattern A — migration contract for `108_integrity_checks_ownerless_households.sql`.
 *
 * A ninth check: households with at least one active member and ZERO active
 * members whose role is `owner` or `parent` — nobody left who can write to
 * it, invite anyone, or approve a schedule change. Nothing else in the
 * schema asks this question; it is also the only way to find a household
 * already stranded this way in production.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '108_integrity_checks_ownerless_households.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');
const priorSql = readFileSync(
  join(migrationsDir, '061_integrity_checks_departed_carers.sql'),
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

const CHECK_NAMES = [
  'timesheet_total_mismatch',
  'approved_snapshot_mismatch',
  'pto_net_negative',
  'expense_pending_dup',
  'cancellation_unsettled',
  'entry_overlap',
  'stuck_runner',
  'orphan_week',
  'household_ownerless',
] as const;

describe('108 — replaces the function in place', () => {
  it('is a CREATE OR REPLACE of the same function, same signature', () => {
    expect(executable).toContain(
      'create or replace function public.run_integrity_checks()'
    );
    expect(executable).toContain(
      'returns table (check_name text, entity_id uuid, details jsonb)'
    );
  });

  it('re-declares all nine checks — a replace drops anything it omits', () => {
    for (const name of CHECK_NAMES) {
      expect(executable).toContain(`'${name}'::text`);
    }
  });

  it('leaves 061 untouched', () => {
    expect(strip(priorSql)).not.toContain('household_ownerless');
    expect(executable).toContain('household_ownerless');
  });
});

describe('108 — the ninth check: ownerless households', () => {
  it('requires at least one active member', () => {
    expect(executable).toContain("hm.status = 'active'");
  });

  it('flags zero active owner/parent members', () => {
    expect(executable).toContain(
      "count(*) filter (where hm.role in ('owner', 'parent')) = 0"
    );
  });

  it('joins household_members to households', () => {
    expect(executable).toContain(
      'from public.households h join public.household_members hm on hm.household_id = h.id'
    );
  });
});

describe('108 — security block unchanged', () => {
  it('stays invoker-rights', () => {
    expect(executable).toContain('security invoker');
    expect(executable).not.toContain('security definer');
    expect(executable).toContain('set search_path = public');
  });

  it('stays service_role only', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(executable).toContain(
        `revoke all on function public.run_integrity_checks() from ${role}`
      );
    }
    expect(executable).toContain(
      'grant execute on function public.run_integrity_checks() to service_role'
    );
  });

  it('reads only', () => {
    for (const forbidden of [
      'insert into',
      'update public.',
      'delete from',
      'truncate',
      'alter table',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });
});

describe('108 — documentation contract', () => {
  for (const phrase of ['owner', 'parent', 'active']) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
