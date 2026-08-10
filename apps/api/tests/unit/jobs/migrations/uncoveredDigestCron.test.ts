/**
 * @module tests/unit/jobs/migrations/uncoveredDigestCron.test
 * Pattern A — pg_cron contract for uncovered-digest (Uncovered-care digest,
 * Unit D). Retargeted from `scheduleHorizonCron.test.ts`, folding in the
 * pg_net-inside-the-guard assertion from `scheduleHorizonCronPgNetGuard.test.ts`
 * and one asserting the partial index on `shift_events`.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { statementPrecedes } from '../../../helpers/sqlMigrationHelpers';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../supabase/migrations/073_uncovered_digest_cron.sql'
);

describe('073_uncovered_digest_cron.sql', () => {
  it('enables pg_net and schedules uncovered-digest via Vault-backed helpers inside a pg_cron guard', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toContain(
      'create extension if not exists pg_net'
    );
    expect(sql).toContain("'uncovered-digest'");
    expect(sql).toContain("'35 * * * *'");
    expect(sql).toContain('cron.schedule');
    expect(sql).toContain('net.http_post');
    expect(sql).toContain(
      "private.cron_api_base_url() || '/api/jobs/uncovered-digest'"
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
    expect(sql).toContain("'uncovered-digest'");
  });

  it('documents why hourly rather than daily, and why repeated ticks are safe', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("'35 * * * *'");
    // Hourly-not-daily: the send-hour gate is household-local, so a fixed
    // UTC hour would land in someone's night.
    expect(sql.toLowerCase()).toMatch(/household[-\s]local/);
    expect(sql.toLowerCase()).toMatch(/quiet hours/);
    // Repeated-ticks-safe: the date-segmented ledger key claims once per
    // local day.
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

    // Structural, not just presence: the guard's RETURN must precede the
    // pg_net extension creation, so an environment missing pg_cron never
    // reaches (and therefore never fails on) pg_net. Migration 032 exists
    // solely to undo the bug of putting this outside the guard.
    statementPrecedes(sql, 'RETURN;', 'create extension if not exists pg_net');
    statementPrecedes(
      sql,
      'create extension if not exists pg_net',
      'cron.schedule'
    );
  });

  it('creates a partial index on shift_events for the digest candidate query', async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql.toLowerCase()).toContain(
      'create index if not exists shift_events_uncovered_digest_idx'
    );
    expect(sql.toLowerCase()).toContain('on public.shift_events (created_at)');
    expect(sql.toLowerCase()).toContain("where event_type = 'uncovered_care'");
    // The index must exist before the DO block, not inside it — it applies
    // regardless of whether pg_cron is installed.
    const idxIdx = sql
      .toLowerCase()
      .indexOf('create index if not exists shift_events_uncovered_digest_idx');
    const doIdx = sql.toLowerCase().indexOf('do $');
    expect(idxIdx).toBeGreaterThanOrEqual(0);
    expect(doIdx).toBeGreaterThan(idxIdx);
  });
});
