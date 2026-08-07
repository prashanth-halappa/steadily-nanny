/**
 * @module tests/unit/migration067TimeOffSickKind.test
 * Pattern A — migration contract for `067_time_off_sick_kind.sql`, written
 * BEFORE the migration existed (055/059/063 discipline).
 *
 * "I'm ill at 6:30am" had no first-class object: the only shapes were a
 * planned time-off request or silently not turning up. A sick day IS time
 * off — same table, same conflict push, same busy-block privacy — it just
 * needs a discriminator so same-day absence renders and notifies as
 * sickness, not as a holiday request. One new column, no new table.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '067_time_off_sick_kind.sql';

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

describe('067 — adds carer_time_off.kind', () => {
  it('adds the column idempotently with a personal default', () => {
    // Every pre-067 row was a personal request; the default makes the
    // backfill implicit and keeps existing inserts working unchanged.
    expect(executable).toContain(
      'alter table public.carer_time_off add column if not exists kind'
    );
    expect(executable).toContain("default 'personal'");
    expect(/kind\s+text\s+not null/.test(executable)).toBe(true);
  });

  it('constrains kind to personal|sick, drop-then-add for re-runnability', () => {
    // House pattern (053/055/063/064): drop-if-exists then add.
    expect(executable).toContain(
      'drop constraint if exists carer_time_off_kind_check'
    );
    const dropAt = executable.indexOf(
      'drop constraint if exists carer_time_off_kind_check'
    );
    const addAt = executable.indexOf(
      'add constraint carer_time_off_kind_check'
    );
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(addAt).toBeGreaterThan(dropAt);
    expect(executable).toContain("kind in ('personal', 'sick')");
  });

  it('touches only carer_time_off and changes no data', () => {
    expect(executable).toContain('alter table public.carer_time_off');
    for (const forbidden of [
      'drop table',
      'drop column',
      'create policy',
      'drop policy',
      'delete from',
      'truncate',
      'update public.carer_time_off',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });

  it('does not touch the busy-block view — sickness must not leak to other households', () => {
    // v_busy_blocks (016) exposes exactly starts_at/ends_at/kind, where kind
    // is the anonymised BLOCK kind ('time_off'), not this column. A sick day
    // reads as plain time_off to every other family.
    expect(executable).not.toContain('v_busy_blocks');
    expect(executable).not.toContain('create or replace view');
  });
});

describe('067 — documentation contract', () => {
  for (const phrase of [
    // The persona moment this exists for.
    'sick',
    // Why the default is safe for existing rows.
    'personal',
    // The privacy line that must not move.
    'busy',
  ]) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
