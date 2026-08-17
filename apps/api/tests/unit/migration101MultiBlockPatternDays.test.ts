/**
 * @module tests/unit/migration101MultiBlockPatternDays.test
 * Pattern A — migration contract for `101_schedule_pattern_multi_block_days.sql`,
 * written BEFORE the migration existed (045/079/092 discipline).
 *
 * WHY THIS MIGRATION EXISTS. A weekday needs to hold MULTIPLE time blocks,
 * e.g. Monday 07:00-13:00 AND Monday 15:00-17:00. The previous unique index
 * `schedule_pattern_days_pattern_weekday_idx` on `(pattern_id, weekday)`
 * limited a "usual week" to one time block per weekday.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '101_schedule_pattern_multi_block_days.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

/** Executable SQL only — `--` comment lines dropped, whitespace collapsed. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('101 — multi-block pattern days', () => {
  it('drops the old index', () => {
    expect(executable).toContain(
      'drop index if exists public.schedule_pattern_days_pattern_weekday_idx'
    );
  });

  it('creates a unique index on (pattern_id, weekday, start_time) on public.schedule_pattern_days', () => {
    expect(executable).toContain(
      'create unique index if not exists schedule_pattern_days_pattern_weekday_start_idx on public.schedule_pattern_days (pattern_id, weekday, start_time)'
    );
  });

  it('no migration restricts to just weekday - the new index text includes start_time', () => {
    expect(executable).toContain('(pattern_id, weekday, start_time)');
  });

  it('header records the prod apply state and carries a rollback note', () => {
    // Applied to prod 2026-08-17. The header must say so — a stale "NOT YET
    // APPLIED" line is exactly the drift that made 099/100 need commit
    // baf53b7, and it is what someone reads before deciding whether to run
    // `apply_migration` again.
    expect(migrationSql).toContain('Applied to prod 2026-08-17');
    expect(migrationSql).not.toContain('NOT YET APPLIED TO PROD');
    expect(migrationSql.toLowerCase()).toContain('rollback');
  });
});
