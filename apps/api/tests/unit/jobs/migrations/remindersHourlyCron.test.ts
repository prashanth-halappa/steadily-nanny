/**
 * @module tests/unit/jobs/migrations/remindersHourlyCron.test
 * Pattern A — pg_cron contract for reminders-hourly (048). One of S2's "three
 * missing cron-contract tests" (WP-J1/J2): schedule-horizon, integrity-checks
 * and no-show-digest already had one; reminders-hourly, cover-ask-expiry and
 * shift-completion did not.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { statementPrecedes } from '../../../helpers/sqlMigrationHelpers';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../supabase/migrations/048_reminders_cron.sql'
);

describe('048_reminders_cron.sql', () => {
  it('enables pg_net and schedules reminders-hourly via Vault-backed helpers inside a pg_cron guard', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toContain(
      'create extension if not exists pg_net'
    );
    expect(sql).toContain("'reminders-hourly'");
    expect(sql).toContain("'5 * * * *'");
    expect(sql).toContain('cron.schedule');
    expect(sql).toContain('net.http_post');
    expect(sql).toContain(
      "private.cron_api_base_url() || '/api/jobs/reminders'"
    );
    expect(sql).toContain("'X-Job-Api-Key', private.cron_job_api_key()");
    expect(sql.toLowerCase()).toContain(
      "pg_extension where extname = 'pg_cron'"
    );
    expect(sql.toLowerCase()).toContain('do $');
  });

  it('is idempotent — unschedules an existing job before re-scheduling', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain('cron.unschedule');
    expect(sql.toLowerCase()).toContain('cron.job');
    expect(sql).toContain("'reminders-hourly'");
    statementPrecedes(sql, 'cron.unschedule', 'PERFORM cron.schedule(');
  });

  it('does not hardcode API URLs or job API keys', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).not.toMatch(/https?:\/\//);
    expect(sql).not.toContain('vault.create_secret');
    expect(sql).not.toMatch(/'X-Job-Api-Key',\s*'[^']+'/);
  });

  it('creates pg_net only INSIDE the pg_cron guard, never before it', async () => {
    const sql = await Bun.file(migrationPath).text();

    statementPrecedes(sql, 'RETURN;', 'create extension if not exists pg_net');
    statementPrecedes(
      sql,
      'create extension if not exists pg_net',
      'cron.schedule'
    );
  });

  it('does not collide with an existing cron job name', async () => {
    // 026/032 own `schedule-horizon`, 054 `cancellation-pay-reconcile`, 057
    // `integrity-checks`.
    const sql = await Bun.file(migrationPath).text();
    expect(sql).not.toContain("'schedule-horizon'");
    expect(sql).not.toContain("'cancellation-pay-reconcile'");
    expect(sql).not.toContain("'integrity-checks'");
  });

  it('documents why hourly rather than a per-timezone scheduler', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toMatch(/why hourly/);
    expect(sql.toLowerCase()).toMatch(/local time/);
  });
});
