/**
 * @module tests/unit/jobs/migrations/noShowDigestCron.test
 * Pattern A — pg_cron contract for no-show-digest (A1/D-26, matrix row N11).
 * Retargeted from `uncoveredDigestCron.test.ts`.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { statementPrecedes } from '../../../helpers/sqlMigrationHelpers';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../supabase/migrations/090_no_show_digest_cron.sql'
);

describe('090_no_show_digest_cron.sql', () => {
  it('enables pg_net and schedules no-show-digest via Vault-backed helpers inside a pg_cron guard', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toContain(
      'create extension if not exists pg_net'
    );
    expect(sql).toContain("'no-show-digest'");
    expect(sql).toContain("'50 * * * *'");
    expect(sql).toContain('cron.schedule');
    expect(sql).toContain('net.http_post');
    expect(sql).toContain(
      "private.cron_api_base_url() || '/api/jobs/no-show-digest'"
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
    expect(sql).toContain("'no-show-digest'");
  });

  it('documents why hourly rather than daily, and why repeated ticks are safe', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toMatch(/household[-\s]local/);
    expect(sql.toLowerCase()).toMatch(/date-segmented/);
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

  // Was "repo file only — never applied as part of 3-N" until Phase 6 applied
  // it (620d247 rewrote this header and left the assertion behind, which is
  // why `bun run qc` came off that commit red). The header is the source of
  // truth about a migration's own application state, so the test follows it:
  // what must stay documented now is that it IS applied, and how — the two
  // facts that stop someone re-running it or reaching for `db push`.
  it('documents that this migration is applied to prod and must not be re-applied', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toMatch(/applied to prod/);
    expect(sql.toLowerCase()).toMatch(/do not re-apply/);
    expect(sql.toLowerCase()).toMatch(/never `supabase db push`/);
  });
});
