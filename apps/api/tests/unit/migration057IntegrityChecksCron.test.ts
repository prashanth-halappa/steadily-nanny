/**
 * @module tests/unit/migration057IntegrityChecksCron.test
 * Pattern A — migration contract for `057_integrity_checks_cron.sql`.
 *
 * 056 answers the eight questions; nothing asks them. An unscheduled sweep is
 * exactly the state `cancellationPayReconcileJob` was in before 054 — a
 * correct mechanism reachable only by a manual POST, which in production means
 * never. Same assertions as 054's contract, because it is the same shape and
 * the same two ways to get it wrong (a name collision silently unschedules
 * someone else's job; pg_net created outside the guard hard-fails the
 * migration on a database without it — the 032 bug).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '057_integrity_checks_cron.sql';
const JOB_NAME = 'integrity-checks';
/** Verified against `apps/api/src/routes/jobRoutes.ts`. */
const ENDPOINT = '/api/jobs/integrity-checks';
/** Daily at 04:10 — clear of 03:00 horizon, :05 reminders and :25 reconcile. */
const SCHEDULE = '10 4 * * *';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

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

describe('057 — schedules the integrity sweep', () => {
  it(`registers the cron job as "${JOB_NAME}"`, () => {
    expect(executable).toContain(`cron.schedule( '${JOB_NAME}'`);
  });

  it(`runs on "${SCHEDULE}" — daily, offset from every other cron`, () => {
    expect(executable).toContain(`'${SCHEDULE}'`);
  });

  it('posts to the endpoint that actually exists', () => {
    expect(executable).toContain(`|| '${ENDPOINT}'`);
  });

  it('does not collide with an existing cron job name', () => {
    // Scheduling under a name someone else owns silently unschedules THEIR
    // job — 026/032 own `schedule-horizon`, 048 `reminders-hourly`, 054
    // `cancellation-pay-reconcile`.
    expect(executable).not.toContain('schedule-horizon');
    expect(executable).not.toContain('reminders-hourly');
    expect(executable).not.toContain('cancellation-pay-reconcile');
  });
});

describe('057 — authenticates, or the call 401s silently forever', () => {
  it('sends the X-Job-Api-Key header', () => {
    expect(executable).toContain("'x-job-api-key', private.cron_job_api_key()");
  });

  it('reads the base URL from the vault helper, never a literal host', () => {
    expect(executable).toContain('private.cron_api_base_url()');
    expect(executable).not.toContain('http://');
    expect(executable).not.toContain('https://');
  });

  it('sends a JSON content type and an empty body', () => {
    expect(executable).toContain("'content-type', 'application/json'");
    expect(executable).toContain("body := '{}'::jsonb");
  });
});

describe('057 — 032’s pg_net guard is preserved', () => {
  it('guards on pg_cron being installed and returns with a notice', () => {
    expect(executable).toContain("where extname = 'pg_cron'");
    expect(executable).toContain('raise notice');
    expect(executable).toContain('return;');
  });

  it('creates pg_net INSIDE the guard, not before it', () => {
    const guard = executable.indexOf("extname = 'pg_cron'");
    const net = executable.indexOf('create extension if not exists pg_net');
    expect(guard).toBeGreaterThan(-1);
    expect(net).toBeGreaterThan(-1);
    expect(net).toBeGreaterThan(guard);
  });

  it('creates no extension before the DO block', () => {
    const doBlock = executable.indexOf('do $do$');
    expect(doBlock).toBeGreaterThan(-1);
    expect(executable.slice(0, doBlock)).not.toContain('create extension');
  });
});

describe('057 — idempotent re-registration', () => {
  it('unschedules any prior registration before scheduling', () => {
    expect(executable).toContain(`perform cron.unschedule('${JOB_NAME}')`);
    expect(executable.indexOf('cron.unschedule')).toBeLessThan(
      executable.indexOf('cron.schedule')
    );
  });

  it('only unschedules when the job is already there', () => {
    expect(executable).toContain(
      `select 1 from cron.job where jobname = '${JOB_NAME}'`
    );
  });
});

describe('057 — changes nothing else', () => {
  it('creates no table, policy, index, trigger or function', () => {
    for (const forbidden of [
      'create table',
      'alter table',
      'create policy',
      'drop policy',
      'create index',
      'create trigger',
      'create or replace function',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });

  it('deletes no data', () => {
    expect(executable).not.toContain('delete from');
    expect(executable).not.toContain('truncate');
  });
});

describe('057 — documentation contract', () => {
  for (const phrase of [
    // Why daily rather than hourly.
    'daily',
    // The 054 lesson: an unscheduled job is an absent one.
    'manual',
    // The 032 lineage.
    '032',
    'inside',
    // The one-time prerequisite.
    'vault',
  ]) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
