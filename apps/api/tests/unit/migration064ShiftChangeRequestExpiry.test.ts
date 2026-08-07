/**
 * @module tests/unit/migration064ShiftChangeRequestExpiry.test
 * Pattern A — migration contract for `064_shift_change_request_expiry.sql`.
 *
 * F-B5-5. `shift_change_requests` had no clock. A pending row sat pending
 * forever: the nanny never answered, nobody withdrew it, and it stayed in the
 * family's "waiting on them" list until the shift itself was long past. The
 * 7-day sweep in `scheduleHorizonJob` needs somewhere to put those rows, and
 * the 015 status CHECK — (pending|accepted|declined|withdrawn|superseded) —
 * has no slot for "nobody ever answered".
 *
 * The alternative was to reuse `withdrawn`, and it was rejected: withdrawn
 * means the REQUESTER acted. Writing that about someone who did nothing makes
 * an audit-adjacent table lie to the family reading it back.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '064_shift_change_request_expiry.sql';

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

describe('064 — widens shift_change_requests.status to admit expired', () => {
  it('drops the 015 status check before adding one, so the migration is re-runnable', () => {
    // House pattern (053, 055, 063): drop-if-exists then add. A bare ADD dies
    // on the second run and takes the whole `db reset` with it.
    expect(executable).toContain(
      'drop constraint if exists shift_change_requests_status_check'
    );
    const dropAt = executable.indexOf(
      'drop constraint if exists shift_change_requests_status_check'
    );
    const addAt = executable.indexOf(
      'add constraint shift_change_requests_status_check'
    );
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(addAt).toBeGreaterThan(dropAt);
  });

  it('admits expired alongside every status 015 already allowed', () => {
    // Widening only. Dropping any of the five would orphan live rows and fail
    // the ADD on any database that has one.
    for (const status of [
      'pending',
      'accepted',
      'declined',
      'withdrawn',
      'superseded',
      'expired',
    ]) {
      expect(executable).toContain(`'${status}'`);
    }
    expect(executable).toContain('check (status in (');
  });

  it('touches only shift_change_requests', () => {
    expect(executable).toContain('alter table public.shift_change_requests');
    expect(executable).not.toContain('alter table public.shifts');
  });

  it('changes no data and drops nothing else', () => {
    // A widening CHECK must not rewrite rows: expiry is the job's decision,
    // made against `created_at` at sweep time, not a backfill's.
    for (const forbidden of [
      'drop table',
      'drop column',
      'drop index',
      'create policy',
      'drop policy',
      'delete from',
      'truncate',
      'update public.shift_change_requests',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });
});

describe('064 — documentation contract', () => {
  for (const phrase of [
    // The finding this closes.
    'f-b5-5',
    // The product default the sweep keys off, and who may change it.
    '7 day',
    // Why this is not `withdrawn`.
    'withdrawn',
    // What the table is to the family that reads it.
    'audit',
  ]) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
