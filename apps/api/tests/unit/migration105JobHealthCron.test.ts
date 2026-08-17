/**
 * @module tests/unit/migration105JobHealthCron.test
 * Pattern A — migration contract for `105_job_health_cron.sql` (J1-b,
 * closing S2). Same shape as `migration057IntegrityChecksCron.test.ts`:
 * comment-stripped executable text for the cron/function assertions, raw
 * comment text for the documentation-contract assertions.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '105_job_health_cron.sql';
const JOB_NAME = 'job-health';
/** Verified against `apps/api/src/routes/jobRoutes.ts`. */
const ENDPOINT = '/api/jobs/job-health';
/** Daily at 06:15 — after every other job's daily/hourly slot has fired. */
const SCHEDULE = '15 6 * * *';

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

describe('105 — creates the pg_net-failures function', () => {
  it('creates public.job_http_failures(interval) returning (status_code, count)', () => {
    expect(executable).toContain(
      'create or replace function public.job_http_failures(p_since interval)'
    );
    expect(executable).toContain(
      'returns table (status_code integer, count bigint)'
    );
  });

  it('is SECURITY DEFINER — net._http_response is not reachable as invoker', () => {
    expect(executable).toContain('security definer');
    expect(executable).not.toContain('security invoker');
  });

  it('is stable and reads only net._http_response, filtered to non-2xx/missing', () => {
    expect(executable).toContain('stable');
    expect(executable).toContain('from net._http_response');
    expect(executable).toContain('status_code is null or r.status_code >= 300');
  });

  it('is locked down to service_role only, like every other function grant in this schema', () => {
    expect(executable).toContain(
      'revoke all on function public.job_http_failures(interval) from public'
    );
    expect(executable).toContain(
      'revoke all on function public.job_http_failures(interval) from anon'
    );
    expect(executable).toContain(
      'revoke all on function public.job_http_failures(interval) from authenticated'
    );
    expect(executable).toContain(
      'grant execute on function public.job_http_failures(interval) to service_role'
    );
  });

  it('creates no table, policy, index or trigger', () => {
    for (const forbidden of [
      'create table',
      'alter table',
      'create policy',
      'drop policy',
      'create index',
      'create trigger',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });
});

describe('105 — schedules the job-health sweep', () => {
  it(`registers the cron job as "${JOB_NAME}"`, () => {
    expect(executable).toContain(`cron.schedule( '${JOB_NAME}'`);
  });

  it(`runs on "${SCHEDULE}" — daily, after every other job's slot`, () => {
    expect(executable).toContain(`'${SCHEDULE}'`);
  });

  it('posts to the endpoint that actually exists', () => {
    expect(executable).toContain(`|| '${ENDPOINT}'`);
  });

  it('does not collide with an existing cron job name', () => {
    expect(executable).not.toContain('schedule-horizon');
    expect(executable).not.toContain('reminders-hourly');
    expect(executable).not.toContain('cancellation-pay-reconcile');
    expect(executable).not.toContain('integrity-checks');
    expect(executable).not.toContain('no-show-sweep');
    expect(executable).not.toContain('uncovered-digest');
    expect(executable).not.toContain('cover-ask-expiry');
    expect(executable).not.toContain('shift-completion');
    expect(executable).not.toContain('no-show-digest');
  });
});

describe('105 — authenticates, or the call 401s silently forever', () => {
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

describe('105 — 032’s pg_net guard is preserved', () => {
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
});

describe('105 — idempotent re-registration', () => {
  it('unschedules any prior registration before scheduling', () => {
    expect(executable).toContain(`perform cron.unschedule('${JOB_NAME}')`);
    expect(executable.indexOf('cron.unschedule')).toBeLessThan(
      executable.lastIndexOf('cron.schedule')
    );
  });

  it('only unschedules when the job is already there', () => {
    expect(executable).toContain(
      `select 1 from cron.job where jobname = '${JOB_NAME}'`
    );
  });
});

describe('105 — documentation contract', () => {
  for (const phrase of [
    // Why daily, why definer, why net._http_response can't be reached
    // directly, and the ordering rationale relative to every other job.
    'daily',
    'security definer',
    'not reachable',
    'pg_net-owned',
    // The 032 lineage this migration's guard shape follows.
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
