/**
 * @module tests/unit/migration100TimesheetParentViewed.test
 * Pattern A — migration contract for `100_timesheet_parent_viewed.sql`,
 * written BEFORE the migration existed (045/079/092 discipline).
 *
 * WHY THIS MIGRATION EXISTS. The nanny can already see whether a family
 * opened the terms she sent (`terms_proposals.viewed_at`, 092). She cannot
 * see whether anyone opened THE HOURS HER RENT DEPENDS ON: her week just
 * reads "With the family" whether that has been five minutes or five days.
 * `parent_viewed_at` is that receipt — WHETHER a parent opened this week in
 * the app, never how many times. One-way: set once, never cleared. Mirrors
 * `terms_proposals.viewed_at`.
 *
 * WHY ITS OWN TRIGGER, NOT THE SHARED ONE. `approveSubmittedWithEarnings`
 * compare-and-swaps on `updated_at`. The shared `public.set_updated_at()`
 * (001, used by 16 tables) stamps `now()` on EVERY update. A viewed-only
 * write would bump the version, invalidate an in-flight approve, and the
 * parent's approval would fail. Timesheets therefore get
 * `set_timesheets_updated_at`, which preserves `OLD.updated_at` when the
 * ONLY changed column is `parent_viewed_at`, and still bumps in every other
 * case — including a roll-up that rewrites identical values
 * (`timesheetRepository.ts:218-221`). NEVER edit the shared function.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractFunctionBody } from '../helpers/sqlMigrationHelpers';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '100_timesheet_parent_viewed.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

/** Executable SQL only — `--` comment lines dropped, whitespace collapsed. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('100 — parent_viewed_at receipt on timesheets', () => {
  it('adds a nullable parent_viewed_at timestamptz with no default', () => {
    expect(executable).toContain(
      'alter table public.timesheets add column if not exists parent_viewed_at timestamptz'
    );
    expect(executable).not.toContain('parent_viewed_at timestamptz not null');
    expect(executable).not.toContain('parent_viewed_at timestamptz default');
  });

  it('gives timesheets its own updated_at trigger function that preserves OLD.updated_at for a viewed-only write', () => {
    const body = extractFunctionBody(
      migrationSql,
      'set_timesheets_updated_at'
    ).toLowerCase();
    expect(body).toContain('parent_viewed_at');
    expect(body).toContain('old.updated_at');
  });

  it('still installs the trigger BEFORE UPDATE FOR EACH ROW on public.timesheets', () => {
    expect(executable).toContain(
      'create trigger set_timesheets_updated_at before update on public.timesheets for each row execute function public.set_timesheets_updated_at()'
    );
  });

  it('never redefines the shared public.set_updated_at function', () => {
    expect(executable).not.toContain('function public.set_updated_at');
  });
});
