/**
 * Timesheets (one per carer-week) and the time entries that roll up into them.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows have the same shape supabase-js
 * returned. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/timesheet
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { NOW } from './columns';
import { households } from './household';
import { shifts } from './shift';
import { userProfiles } from './user';

export const timesheets = sqliteTable(
  'timesheets',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    carer_id: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    week_start: text().notNull(),
    total_minutes: integer().default(0).notNull(),
    status: text().default('open').notNull(),
    approved_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    approved_at: text(),
    query_note: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    carer_display_name: text().notNull(),
    gross_minor: integer(),
    currency: text(),
    earnings: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    earnings_computed_at: text(),
    reopen_reason: text(),
    household_member_id: text(),
    parent_viewed_at: text(),
    hours_changed_after_payment_at: text(),
    previous_approval: text({ mode: 'json' }).$type<Record<string, unknown>>(),
  },
  t => [
    index('timesheets_carer_id_idx').on(t.carer_id),
    uniqueIndex('timesheets_household_carer_week_idx').on(
      t.household_id,
      t.carer_id,
      t.week_start
    ),
    check(
      'timesheets_approved_has_snapshot',
      sql`((status <> 'approved') OR ((gross_minor IS NOT NULL) AND (currency IS NOT NULL) AND (earnings IS NOT NULL) AND (earnings_computed_at IS NOT NULL)))`
    ),
    check('timesheets_currency_check', sql`(currency GLOB '[A-Z][A-Z][A-Z]')`),
    check('timesheets_gross_minor_check', sql`(gross_minor >= 0)`),
    check('timesheets_gross_minor_upper', sql`(gross_minor <= 99999999)`),
    check(
      'timesheets_status_check',
      sql`(status IN ('open', 'submitted', 'approved', 'queried'))`
    ),
  ]
);

// Exclusion constraint(s) time_entries_no_clock_overlap_per_carer, time_entries_no_overlap_per_household -> BEFORE INSERT/UPDATE triggers in migrations/0001_triggers.sql.
export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    carer_id: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    shift_id: text().references(() => shifts.id, { onDelete: 'set null' }),
    clock_in_at: text(),
    clock_out_at: text(),
    break_minutes: integer().default(0).notNull(),
    scheduled_minutes: integer(),
    kind: text().default('worked').notNull(),
    note: text(),
    clock_in_location_ok: integer({ mode: 'boolean' }),
    clock_out_location_ok: integer({ mode: 'boolean' }),
    status: text().default('running').notNull(),
    local_date: text().notNull(),
    timezone: text().notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    carer_display_name: text().notNull(),
    household_member_id: text(),
    observed_clock_in_at: text(),
    observed_clock_out_at: text(),
  },
  t => [
    index('time_entries_carer_date_idx').on(t.carer_id, t.local_date),
    index('time_entries_household_date_idx').on(t.household_id, t.local_date),
    uniqueIndex('time_entries_one_cancellation_paid_per_span')
      .on(t.shift_id, sql`quote(${t.clock_in_at})`)
      .where(sql`(kind = 'cancellation_paid') AND (shift_id IS NOT NULL)`),
    uniqueIndex('time_entries_one_running_per_carer')
      .on(t.carer_id)
      .where(sql`status = 'running'`),
    index('time_entries_shift_idx')
      .on(t.shift_id)
      .where(sql`shift_id IS NOT NULL`),
    check('time_entries_break_minutes_check', sql`(break_minutes >= 0)`),
    check(
      'time_entries_clock_order',
      sql`((clock_out_at IS NULL) OR (clock_in_at IS NULL) OR (julianday(clock_out_at) > julianday(clock_in_at)))`
    ),
    check(
      'time_entries_kind_check',
      sql`(kind IN ('worked', 'cancellation_paid', 'manual_adjustment'))`
    ),
    check(
      'time_entries_status_check',
      sql`(status IN ('running', 'submitted', 'approved', 'queried', 'voided'))`
    ),
  ]
);
