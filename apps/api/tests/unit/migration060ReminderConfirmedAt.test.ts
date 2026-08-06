/**
 * @module tests/unit/migration060ReminderConfirmedAt.test
 * Pattern A — migration contract for `060_reminder_confirmed_at.sql`.
 *
 * C3. `reminderJob` claims a `push_reminder_log` row BEFORE sending, so that
 * two overlapping hourly runs cannot both deliver. The job releases the claim
 * when the send fails or reaches nobody — but a hard process kill between the
 * claim COMMIT and the send returning leaves a claim standing for a reminder
 * that never went out, and that reminder is then suppressed forever.
 *
 * `confirmed_at` is the second phase: the claim is a reservation until the
 * send confirms it, and an unconfirmed reservation older than the sweep
 * horizon is garbage from a crashed run, not evidence of a delivery.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '060_reminder_confirmed_at.sql';

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

describe('060 — adds the confirmation timestamp', () => {
  it('adds confirmed_at to push_reminder_log', () => {
    expect(executable).toContain(
      'alter table public.push_reminder_log add column if not exists confirmed_at timestamptz'
    );
  });

  it('leaves the column nullable with no default', () => {
    // NULL is the whole signal: "claimed, not yet known to have been sent".
    // A default of now() would confirm every claim at insert time and make
    // the sweep a no-op; NOT NULL would reject the claim insert outright.
    expect(executable).not.toContain('confirmed_at timestamptz not null');
    expect(executable).not.toContain('confirmed_at timestamptz default');
  });

  it('backfills existing rows as confirmed, not as sweepable garbage', () => {
    // Every row written before this migration was written by the old
    // claim-then-send path, which released on failure — so a surviving row
    // means a send that did land. Leaving them NULL would make the first
    // sweep delete the entire dedupe ledger and re-send everything in it.
    expect(executable).toContain('update public.push_reminder_log');
    expect(executable).toContain('set confirmed_at = sent_at');
    expect(executable).toContain('where confirmed_at is null');
  });

  it('changes nothing else', () => {
    for (const forbidden of [
      'drop table',
      'drop column',
      'create policy',
      'drop policy',
      'delete from',
      'truncate',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });
});

describe('060 — documentation contract', () => {
  for (const phrase of [
    // The crash window this exists to close.
    'crash',
    // Why the backfill is not optional.
    'backfill',
    // The sweep that consumes the column.
    'sweep',
  ]) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
