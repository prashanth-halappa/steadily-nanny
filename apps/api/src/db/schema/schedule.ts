/**
 * Recurring schedule patterns and their per-weekday blocks.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows have the same shape supabase-js
 * returned. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/schedule
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { children } from './child';
import { NOW } from './columns';
import { households } from './household';
import { userProfiles } from './user';

export const schedulePatterns = sqliteTable(
  'schedule_patterns',
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
    status: text().default('draft').notNull(),
    rrule: text().notNull(),
    dtstart: text().notNull(),
    until: text(),
    exdates: text({ mode: 'json' })
      .$type<string[]>()
      .default(sql`'[]'`)
      .notNull(),
    pause_ranges: text({ mode: 'json' })
      .$type<unknown[]>()
      .default(sql`'[]'`)
      .notNull(),
    timezone: text().notNull(),
    note: text(),
    created_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    sent_at: text(),
    responded_at: text(),
    ical_uid: text()
      .$defaultFn(() => crypto.randomUUID())
      .notNull(),
    sequence: integer().default(0).notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    decline_message: text(),
  },
  t => [
    unique('schedule_patterns_ical_uid_key').on(t.ical_uid),
    index('schedule_patterns_carer_idx')
      .on(t.carer_id, t.status)
      .where(sql`carer_id IS NOT NULL`),
    index('schedule_patterns_household_status_idx').on(
      t.household_id,
      t.status
    ),
    uniqueIndex('schedule_patterns_one_accepted_idx')
      .on(t.household_id, t.carer_id)
      .where(sql`(status = 'accepted') AND (carer_id IS NOT NULL)`),
    check(
      'schedule_patterns_date_order',
      sql`((until IS NULL) OR (until >= dtstart))`
    ),
    check(
      'schedule_patterns_status_check',
      sql`(status IN ('draft', 'pending', 'accepted', 'declined', 'withdrawn', 'ended'))`
    ),
  ]
);

export const schedulePatternDays = sqliteTable(
  'schedule_pattern_days',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pattern_id: text()
      .notNull()
      .references(() => schedulePatterns.id, { onDelete: 'cascade' }),
    weekday: integer().notNull(),
    start_time: text().notNull(),
    end_time: text().notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    uniqueIndex('schedule_pattern_days_pattern_weekday_start_idx').on(
      t.pattern_id,
      t.weekday,
      t.start_time
    ),
    check('schedule_pattern_days_time_order', sql`(end_time > start_time)`),
    check(
      'schedule_pattern_days_weekday_check',
      sql`((weekday >= 0) AND (weekday <= 6))`
    ),
  ]
);

export const schedulePatternDayChildren = sqliteTable(
  'schedule_pattern_day_children',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pattern_day_id: text()
      .notNull()
      .references(() => schedulePatternDays.id, { onDelete: 'cascade' }),
    child_id: text()
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    start_time: text(),
    end_time: text(),
    created_at: text().default(NOW).notNull(),
  },
  t => [
    index('schedule_pattern_day_children_child_idx').on(t.child_id),
    index('schedule_pattern_day_children_day_idx').on(t.pattern_day_id),
    check(
      'schedule_pattern_day_children_time_order',
      sql`((start_time IS NULL) OR (end_time IS NULL) OR (end_time > start_time))`
    ),
    check(
      'schedule_pattern_day_children_time_pairing',
      sql`((start_time IS NULL) = (end_time IS NULL))`
    ),
  ]
);
