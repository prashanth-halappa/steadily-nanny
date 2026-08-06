/**
 * @module tests/unit/migration061IntegrityChecksDepartedCarers.test
 * Pattern A — migration contract for `061_integrity_checks_departed_carers.sql`.
 *
 * 056 had to exclude `carer_id is null` rows: after 033 a departed carer's
 * entries AND timesheets both go null, leaving display name as the only join
 * key, and two carers called Emma would report as a permanent false mismatch.
 * 058 added `household_member_id` — identity that survives the deletion — but
 * 056 runs BEFORE 058, so its body cannot name a column that does not exist
 * yet. Hence a separate migration rather than an edit to 056.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '061_integrity_checks_departed_carers.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');
const priorSql = readFileSync(
  join(migrationsDir, '056_integrity_checks.sql'),
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
] as const;

describe('061 — replaces the function in place', () => {
  it('is a CREATE OR REPLACE of the same function, same signature', () => {
    expect(executable).toContain(
      'create or replace function public.run_integrity_checks()'
    );
    expect(executable).toContain(
      'returns table (check_name text, entity_id uuid, details jsonb)'
    );
  });

  it('re-declares all eight checks — a replace drops anything it omits', () => {
    for (const name of CHECK_NAMES) {
      expect(executable).toContain(`'${name}'::text`);
    }
  });

  it('leaves 056 untouched', () => {
    // 056 must keep parsing on a database where 058 has not run yet, so the
    // new column may appear ONLY here.
    expect(strip(priorSql)).not.toContain('household_member_id');
    expect(executable).toContain('household_member_id');
  });
});

describe('061 — the carer key now survives deletion', () => {
  it('keys entries on carer_id, falling back to household_member_id', () => {
    expect(executable).toContain(
      'coalesce(te.carer_id::text, te.household_member_id::text)'
    );
  });

  it('keys timesheets the same way, or the join silently matches nothing', () => {
    expect(executable).toContain(
      'coalesce(ts.carer_id::text, ts.household_member_id::text)'
    );
  });

  it('drops the carer_id-not-null filter the coalesce replaces', () => {
    expect(executable).not.toContain('where te.carer_id is not null');
    expect(executable).not.toContain('and ts.carer_id is not null');
  });

  it('still excludes rows with neither key — pre-058 departed data', () => {
    // Those rows have no stampable identity at all (their memberships are
    // gone), so they can only be grouped by display name. Excluded, not
    // guessed at.
    expect(executable).toContain(
      'te.carer_id is not null or te.household_member_id is not null'
    );
    expect(executable).toContain(
      'ts.carer_id is not null or ts.household_member_id is not null'
    );
  });
});

describe('061 — a negative scheduled_minutes cannot go negative', () => {
  // 017 declares `scheduled_minutes integer` with no non-negative CHECK, and
  // the TS twin clamps with Math.max(0, …). Unclamped here, one bad stored
  // value fires timesheet_total_mismatch forever.
  it('clamps the cancellation branch', () => {
    expect(executable).toContain('greatest(0, coalesce(te.scheduled_minutes');
  });

  it('clamps outside the coalesce, or the span fallback dies', () => {
    // GREATEST ignores nulls, so greatest(0, null) is 0 — wrapping the column
    // itself would return 0 for a legacy null instead of the span.
    expect(executable).not.toContain(
      'coalesce(greatest(0, te.scheduled_minutes'
    );
  });
});

describe('061 — security block unchanged', () => {
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

describe('061 — documentation contract', () => {
  for (const phrase of ['058', 'departed', 'display name']) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
