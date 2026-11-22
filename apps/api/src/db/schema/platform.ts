/**
 * Platform singletons and bookkeeping: app_config (one row, id = 1) and job_runs.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows have the same shape supabase-js
 * returned. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/platform
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { NOW } from './columns';

export const appConfig = sqliteTable(
  'app_config',
  {
    id: integer().primaryKey().default(1),
    min_supported_version: text(),
    latest_version: text(),
    ios_store_url: text(),
    android_store_url: text(),
    status: text().default('ok').notNull(),
    maintenance_message: text({ mode: 'json' }).$type<
      Record<string, unknown>
    >(),
    announcements: text({ mode: 'json' })
      .$type<unknown[]>()
      .default(sql`'[]'`)
      .notNull(),
    beta_all_pro: integer({ mode: 'boolean' }).default(false).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  _t => [
    check('app_config_id_check', sql`(id = 1)`),
    check(
      'app_config_status_check',
      sql`(status IN ('ok', 'maintenance', 'killed'))`
    ),
  ]
);

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    job_name: text().notNull(),
    started_at: text().default(NOW).notNull(),
    completed_at: text(),
    duration_ms: integer(),
    status: text().default('running').notNull(),
    total_processed: integer().default(0).notNull(),
    success_count: integer().default(0).notNull(),
    error_count: integer().default(0).notNull(),
    skipped_count: integer().default(0).notNull(),
    peak_memory_mb: real(),
    db_query_count: integer().default(0).notNull(),
    summary: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    error_message: text(),
    error_details: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    created_at: text().default(NOW).notNull(),
    idempotency_key: text(),
  },
  t => [
    unique('job_runs_idempotency_key_key').on(t.idempotency_key),
    index('idx_job_runs_name_started').on(
      t.job_name,
      sql`${t.started_at} desc`
    ),
    check(
      'job_runs_status_check',
      sql`(status IN ('running', 'success', 'failed', 'partial'))`
    ),
  ]
);
