/**
 * @module tests/unit/migration054CancellationPayReconcileCron.test
 * Pattern A — migration contract for `054_cancellation_pay_reconcile_cron.sql`.
 *
 * Written BEFORE the migration existed, same discipline as 049/052/053.
 *
 * `cancellationPayReconcileJob` is the only thing that settles a carer who is
 * owed cancellation pay but has no payable entry — the accept path deliberately
 * leaves `shifts.cancellation_paid = true` standing as durable evidence and
 * relies on a sweeper. Until this migration the sweeper was reachable only by
 * a manual POST, so in production nothing ever repaired it.
 *
 * Unlike the 049/052/053 contracts this file does NOT split statements: the
 * migration is a single `DO $do$ ... $do$` block containing a nested `$cmd$`
 * dollar-quote, and the statement splitter those tests share only understands
 * bare `$$`. Splitting would cut the block at the first `;` inside it. The
 * whole-file assertions below are what this shape wants anyway.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '054_cancellation_pay_reconcile_cron.sql';
const JOB_NAME = 'cancellation-pay-reconcile';
/** Verified against `apps/api/src/routes/jobRoutes.ts`. */
const ENDPOINT = '/api/jobs/cancellation-pay-reconcile';
/** Hourly at :25 — offset from reminders-hourly (:05) and schedule-horizon (03:00). */
const SCHEDULE = '25 * * * *';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

const migrationSql = readMigration(MIGRATION);

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

describe('054 — schedules the reconcile job', () => {
  it(`registers the cron job as "${JOB_NAME}"`, () => {
    expect(executable).toContain(`cron.schedule( '${JOB_NAME}'`);
  });

  it(`runs on "${SCHEDULE}" — hourly, offset from the other two crons`, () => {
    expect(executable).toContain(`'${SCHEDULE}'`);
  });

  it('posts to the reconcile endpoint that actually exists', () => {
    expect(executable).toContain(`|| '${ENDPOINT}'`);
  });

  it('does not collide with an existing cron job name', () => {
    // 026/032 own `schedule-horizon`, 048 owns `reminders-hourly`; scheduling
    // under either name would silently unschedule someone else's job.
    expect(executable).not.toContain('schedule-horizon');
    expect(executable).not.toContain('reminders-hourly');
  });
});

describe('054 — authenticates, or the call 401s silently forever', () => {
  // `validateJobApiKey` reads `x-job-api-key` and compares against
  // JOB_API_KEY. A cron that omits it gets a 401 on every run, logs nothing
  // useful DB-side, and the carer stays unpaid exactly as before.
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

describe('054 — 032’s pg_net guard is preserved', () => {
  it('guards on pg_cron being installed and returns with a notice', () => {
    expect(executable).toContain("where extname = 'pg_cron'");
    expect(executable).toContain('raise notice');
    expect(executable).toContain('return;');
  });

  // THE 032 BUG, restated: 026 created the net extension BEFORE the DO block,
  // so on an environment missing pg_net the migration hard-failed before the
  // graceful-degradation guard was ever reached. It must come after.
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

describe('054 — idempotent re-registration', () => {
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

describe('054 — changes nothing else', () => {
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

  it('deletes no data', () => {
    expect(executable).not.toContain('delete from');
    expect(executable).not.toContain('truncate');
  });
});

describe('054 — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // Why this exists at all — the money consequence of it not existing.
    'never repaired',
    'unpaid',
    // The self-healing second case that needs a LATER run, not just any run.
    'clocked in',
    'clocks out',
    // The schedule justification.
    'hourly',
    '30-day',
    // The 032 lineage.
    '032',
    'inside',
    // Deployment ordering — 047/048 are in the repo but not yet in production.
    'not yet applied',
    // The one-time prerequisite.
    'vault',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
