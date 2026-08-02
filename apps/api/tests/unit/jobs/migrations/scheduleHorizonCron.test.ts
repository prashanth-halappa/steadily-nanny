/**
 * @module tests/unit/jobs/migrations/scheduleHorizonCron.test
 * Pattern A — pg_cron contract for schedule-horizon (G3 / Wave 1C).
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../supabase/migrations/026_schedule_horizon_cron.sql'
);

describe('026_schedule_horizon_cron.sql', () => {
  it('enables pg_net and schedules schedule-horizon via Vault-backed helpers inside a pg_cron guard', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toContain(
      'create extension if not exists pg_net'
    );
    expect(sql).toContain("'schedule-horizon'");
    expect(sql).toContain("'0 3 * * *'");
    expect(sql).toContain('cron.schedule');
    expect(sql).toContain('net.http_post');
    expect(sql).toContain(
      "private.cron_api_base_url() || '/api/jobs/schedule-horizon'"
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
    expect(sql).toContain("'schedule-horizon'");
  });

  it('documents that 0 3 * * * uses the PostgreSQL server local timezone', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("'0 3 * * *'");
    expect(sql.toLowerCase()).toMatch(/server'?s local[\s\S]*timezone/);
  });

  it('does not hardcode API URLs or job API keys', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).not.toMatch(/https?:\/\//);
    expect(sql).not.toContain('vault.create_secret');
    expect(sql).not.toMatch(/'X-Job-Api-Key',\s*'[^']+'/);
  });
});
