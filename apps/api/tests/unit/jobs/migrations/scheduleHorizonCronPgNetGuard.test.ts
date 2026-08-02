/**
 * @module tests/unit/jobs/migrations/scheduleHorizonCronPgNetGuard.test
 * Pattern A — 026's `create extension if not exists pg_net` runs BEFORE the
 * `DO` block that checks for pg_cron and RETURNs if it's missing (see
 * 026_schedule_horizon_cron.sql:15-23), so on an environment where pg_net
 * itself is unavailable the migration hard-fails before graceful degradation
 * is ever reached — even though the header claims that degradation.
 *
 * 026 is already applied to the live project, so it cannot be edited (would
 * desync from what actually ran there). 032 is a new migration that redoes
 * the schedule-horizon cron registration with the extension creation moved
 * INSIDE the guard, mirroring 007_pg_cron_vault_and_example_cron.sql's
 * pattern of only creating pg_net next to the schedule that needs it.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { statementPrecedes } from '../../../helpers/sqlMigrationHelpers';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../supabase/migrations/032_fix_schedule_horizon_cron_pg_net_guard.sql'
);

describe('032_fix_schedule_horizon_cron_pg_net_guard.sql', () => {
  it('creates pg_net only AFTER the pg_cron guard would have returned', async () => {
    const sql = await Bun.file(migrationPath).text();

    // Structural, not just presence: the guard's RETURN must precede the
    // pg_net extension creation, so an environment missing pg_cron never
    // reaches (and therefore never fails on) pg_net.
    statementPrecedes(sql, 'RETURN;', 'create extension if not exists pg_net');
  });

  it('still schedules schedule-horizon via cron.schedule after creating pg_net', async () => {
    const sql = await Bun.file(migrationPath).text();

    statementPrecedes(
      sql,
      'create extension if not exists pg_net',
      'cron.schedule'
    );
  });

  it('re-registers the schedule-horizon job with the Vault-backed helpers', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("'schedule-horizon'");
    expect(sql).toContain("'0 3 * * *'");
    expect(sql).toContain('net.http_post');
    expect(sql).toContain(
      "private.cron_api_base_url() || '/api/jobs/schedule-horizon'"
    );
    expect(sql).toContain("'X-Job-Api-Key', private.cron_job_api_key()");
    expect(sql.toLowerCase()).toContain(
      "pg_extension where extname = 'pg_cron'"
    );
  });

  it('is idempotent — unschedules any existing job before re-scheduling', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain('cron.unschedule');
    expect(sql.toLowerCase()).toContain('cron.job');
    expect(sql).toContain("'schedule-horizon'");
  });

  it('does not hardcode API URLs or job API keys', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).not.toMatch(/https?:\/\//);
    expect(sql).not.toContain('vault.create_secret');
    expect(sql).not.toMatch(/'X-Job-Api-Key',\s*'[^']+'/);
  });
});
