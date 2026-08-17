/**
 * @module tests/unit/jobs/migrations/shiftCompletionCron.test
 * Pattern A — pg_cron contract for shift-completion (089, S2/D-24). One of
 * S2's "three missing cron-contract tests" (WP-J1/J2).
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { statementPrecedes } from '../../../helpers/sqlMigrationHelpers';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../supabase/migrations/089_shift_completion_cron.sql'
);

describe('089_shift_completion_cron.sql', () => {
  it('enables pg_net and schedules shift-completion via Vault-backed helpers inside a pg_cron guard', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toContain(
      'create extension if not exists pg_net'
    );
    expect(sql).toContain("'shift-completion'");
    expect(sql).toContain("'40 3 * * *'");
    expect(sql).toContain('cron.schedule');
    expect(sql).toContain('net.http_post');
    expect(sql).toContain(
      "private.cron_api_base_url() || '/api/jobs/shift-completion'"
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
    expect(sql).toContain("'shift-completion'");
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
    const sql = await Bun.file(migrationPath).text();
    // 026/032 `schedule-horizon`, 048 `reminders-hourly`, 057
    // `integrity-checks`, 088 `cover-ask-expiry`.
    expect(sql).not.toContain("'schedule-horizon'");
    expect(sql).not.toContain("'reminders-hourly'");
    expect(sql).not.toContain("'integrity-checks'");
    expect(sql).not.toContain("'cover-ask-expiry'");
  });

  it('documents why nightly rather than hourly, and no push is ever sent', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toMatch(/why nightly and not hourly/);
    expect(sql.toLowerCase()).toMatch(/no push, ever/);
  });

  it('documents that this migration is applied to prod and must not be re-applied', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toMatch(/applied to prod/);
    expect(sql.toLowerCase()).toMatch(/do not re-apply/);
    expect(sql.toLowerCase()).toMatch(/never `supabase db push`/);
  });
});
