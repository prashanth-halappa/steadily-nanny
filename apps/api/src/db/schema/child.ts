/**
 * Children and their recurring commitments (care hours, docs/12-NEED-COVERAGE.md).
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows have the same shape supabase-js
 * returned. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/child
 */
import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { NOW } from './columns';
import { households } from './household';

export const children = sqliteTable(
  'children',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    birth_date: text(),
    colour: text(),
    avatar_initial: text(),
    routine_notes: text(),
    archived_at: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    index('children_household_idx')
      .on(t.household_id)
      .where(sql`archived_at IS NULL`),
  ]
);

export const childCommitments = sqliteTable(
  'child_commitments',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    child_id: text()
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    kind: text().default('other').notNull(),
    label: text(),
    rrule: text().notNull(),
    start_time: text().notNull(),
    end_time: text().notNull(),
    starts_on: text(),
    ends_on: text(),
    exdates: text({ mode: 'json' })
      .$type<string[]>()
      .default(sql`'[]'`)
      .notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    index('child_commitments_child_idx').on(t.child_id),
    index('child_commitments_household_idx').on(t.household_id),
    check(
      'child_commitments_kind_check',
      sql`(kind IN ('preschool', 'school', 'activity', 'nap', 'other'))`
    ),
    check('child_commitments_time_order', sql`(end_time > start_time)`),
  ]
);
