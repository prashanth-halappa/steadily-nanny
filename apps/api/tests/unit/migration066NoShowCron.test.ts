/**
 * @module tests/unit/migration066NoShowCron.test
 * Pattern A — migration contract for `066_no_show_cron.sql`.
 *
 * Same assertions as 057's contract, because it is the same shape and the same
 * two ways to get it wrong (a name collision silently unschedules someone
 * else's job; pg_net created outside the guard hard-fails the migration on a
 * database without it — the 032 bug). The one thing that is genuinely new here
 * is the cadence: a twenty-minute threshold polled hourly is not an alert, so
 * the schedule itself is part of the contract.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '066_no_show_cron.sql';
const JOB_NAME = 'no-show-sweep';
/** Verified against `apps/api/src/routes/jobRoutes.ts`. */
const ENDPOINT = '/api/jobs/no-show-sweep';
/** Every ten minutes — the 20-minute threshold makes hourly useless. */
const SCHEDULE = '*/10 * * * *';

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

describe('066 — schedules the no-show sweep', () => {
  it(`registers the cron job as "${JOB_NAME}"`, () => {
    expect(executable).toContain(`cron.schedule( '${JOB_NAME}'`);
  });

  it(`runs on "${SCHEDULE}" — hourly would miss the 20-minute threshold`, () => {
    expect(executable).toContain(`'${SCHEDULE}'`);
  });

  it('posts to the endpoint that actually exists', () => {
    expect(executable).toContain(`|| '${ENDPOINT}'`);
  });

  it('does not collide with an existing cron job name', () => {
    // Scheduling under a name someone else owns silently unschedules THEIR
    // job — 026/032 own `schedule-horizon`, 048 `reminders-hourly`, 054
    // `cancellation-pay-reconcile`, 057 `integrity-checks`.
    expect(executable).not.toContain('schedule-horizon');
    expect(executable).not.toContain('reminders-hourly');
    expect(executable).not.toContain('cancellation-pay-reconcile');
    expect(executable).not.toContain('integrity-checks');
  });
});

describe('066 — authenticates, or the call 401s silently forever', () => {
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

describe('066 — 032’s pg_net guard is preserved', () => {
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

describe('066 — idempotent re-registration', () => {
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

describe('066 — changes nothing else', () => {
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

describe('066 — documentation contract', () => {
  for (const phrase of [
    // Why ten minutes rather than the hourly cadence it was copied from.
    'ten',
    // Why firing six times an hour cannot spam: 047's ledger, 060's phase two.
    '047',
    '060',
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
