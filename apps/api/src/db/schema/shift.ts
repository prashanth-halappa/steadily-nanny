/**
 * Shifts and everything hung off one: children, change requests, events, co-parent approvals, handoff notes.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows have the same shape supabase-js
 * returned. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/shift
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
import { schedulePatterns } from './schedule';
import { userProfiles } from './user';

// Exclusion constraint(s) shifts_carer_window_excl -> BEFORE INSERT/UPDATE triggers in migrations/0001_triggers.sql.
export const shifts = sqliteTable(
  'shifts',
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
    starts_at: text().notNull(),
    ends_at: text().notNull(),
    timezone: text().notNull(),
    local_date: text().notNull(),
    kind: text().default('recurring').notNull(),
    status: text().default('draft').notNull(),
    source_pattern_id: text().references(() => schedulePatterns.id, {
      onDelete: 'set null',
    }),
    origin: text().default('system_generated').notNull(),
    is_short_notice: integer({ mode: 'boolean' }).default(false).notNull(),
    note: text(),
    reason: text(),
    cancelled_at: text(),
    cancelled_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    cancellation_paid: integer({ mode: 'boolean' }).default(false).notNull(),
    cancellation_message: text(),
    ical_uid: text()
      .$defaultFn(() => crypto.randomUUID())
      .notNull(),
    sequence: integer().default(0).notNull(),
    created_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    cover_ask_expires_at: text(),
  },
  t => [
    unique('shifts_ical_uid_key').on(t.ical_uid),
    index('shifts_carer_starts_idx')
      .on(t.carer_id, t.starts_at)
      .where(sql`carer_id IS NOT NULL`),
    index('shifts_cover_ask_expiry_idx')
      .on(t.cover_ask_expires_at)
      .where(sql`(status = 'pending') AND (cover_ask_expires_at IS NOT NULL)`),
    // Postgres had NULLS NOT DISTINCT on these four window indexes (an open
    // shift, carer_id NULL, still dedupes). SQLite has no such clause, so the
    // nullable column is indexed as `quote(carer_id)` — NULL becomes the text
    // 'NULL', equal to every other NULL. A comma-free expression on purpose:
    // drizzle-kit 0.31 mangles index expressions that contain a comma.
    uniqueIndex('shifts_cover_window_unique')
      .on(t.household_id, sql`quote(${t.carer_id})`, t.starts_at, t.ends_at)
      .where(sql`(kind = 'cover') AND (status <> 'cancelled')`),
    uniqueIndex('shifts_extra_window_unique')
      .on(t.household_id, sql`quote(${t.carer_id})`, t.starts_at, t.ends_at)
      .where(sql`(kind = 'extra') AND (status <> 'cancelled')`),
    index('shifts_household_local_date_idx').on(t.household_id, t.local_date),
    index('shifts_household_starts_idx').on(t.household_id, t.starts_at),
    uniqueIndex('shifts_parent_cover_window_unique')
      .on(t.household_id, sql`quote(${t.carer_id})`, t.starts_at, t.ends_at)
      .where(sql`(kind = 'parent_cover') AND (status <> 'cancelled')`),
    index('shifts_pattern_idx')
      .on(t.source_pattern_id)
      .where(sql`source_pattern_id IS NOT NULL`),
    uniqueIndex('shifts_recurring_window_unique')
      .on(t.household_id, sql`quote(${t.carer_id})`, t.starts_at, t.ends_at)
      .where(sql`(kind = 'recurring') AND (status <> 'cancelled')`),
    check(
      'shifts_kind_check',
      sql`(kind IN ('recurring', 'extra', 'cover', 'parent_cover'))`
    ),
    check(
      'shifts_origin_check',
      sql`(origin IN ('system_generated', 'parent_proposed', 'nanny_countered', 'parent_cover'))`
    ),
    check(
      'shifts_status_check',
      sql`(status IN ('draft', 'pending', 'confirmed', 'declined', 'cancelled', 'completed'))`
    ),
    check(
      'shifts_time_order',
      sql`(julianday(ends_at) > julianday(starts_at))`
    ),
  ]
);

export const shiftChildren = sqliteTable(
  'shift_children',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    shift_id: text()
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    child_id: text()
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    starts_at: text(),
    ends_at: text(),
    created_at: text().default(NOW).notNull(),
  },
  t => [
    index('shift_children_child_idx').on(t.child_id),
    index('shift_children_shift_idx').on(t.shift_id),
    check(
      'shift_children_time_order',
      sql`((starts_at IS NULL) OR (ends_at IS NULL) OR (julianday(ends_at) > julianday(starts_at)))`
    ),
    check(
      'shift_children_time_pairing',
      sql`((starts_at IS NULL) = (ends_at IS NULL))`
    ),
  ]
);

export const shiftChangeRequests = sqliteTable(
  'shift_change_requests',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    shift_id: text()
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    requested_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    kind: text().notNull(),
    proposed_starts_at: text(),
    proposed_ends_at: text(),
    message: text(),
    status: text().default('pending').notNull(),
    responded_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    responded_at: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    response_message: text(),
  },
  t => [
    index('shift_change_requests_pending_idx')
      .on(t.shift_id)
      .where(sql`status = 'pending'`),
    index('shift_change_requests_shift_idx').on(
      t.shift_id,
      sql`${t.created_at} desc`
    ),
    check(
      'shift_change_requests_kind_check',
      sql`(kind IN ('time_change', 'cancel', 'counter_offer', 'split', 'handover'))`
    ),
    check(
      'shift_change_requests_status_check',
      sql`(status IN ('pending', 'accepted', 'declined', 'withdrawn', 'superseded', 'expired'))`
    ),
    check(
      'shift_change_requests_time_order',
      sql`((proposed_starts_at IS NULL) OR (proposed_ends_at IS NULL) OR (julianday(proposed_ends_at) > julianday(proposed_starts_at)))`
    ),
  ]
);

export const shiftEvents = sqliteTable(
  'shift_events',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    shift_id: text().references(() => shifts.id, { onDelete: 'cascade' }),
    local_date: text().notNull(),
    actor_id: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    event_type: text().notNull(),
    payload: text({ mode: 'json' })
      .$type<Record<string, unknown>>()
      .default(sql`'{}'`)
      .notNull(),
    created_at: text().default(NOW).notNull(),
  },
  t => [
    index('shift_events_household_date_idx').on(
      t.household_id,
      t.local_date,
      t.created_at
    ),
    uniqueIndex('shift_events_keyed_unique_idx')
      .on(
        t.household_id,
        t.local_date,
        t.event_type,
        sql`(payload ->> '$.key')`
      )
      .where(sql`(payload ->> '$.key') IS NOT NULL`),
    index('shift_events_shift_idx')
      .on(t.shift_id, t.created_at)
      .where(sql`shift_id IS NOT NULL`),
    index('shift_events_uncovered_digest_idx')
      .on(t.created_at)
      .where(sql`event_type = 'uncovered_care'`),
  ]
);

export const coParentApprovals = sqliteTable(
  'co_parent_approvals',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    requested_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    action: text().notNull(),
    payload: text({ mode: 'json' })
      .$type<Record<string, unknown>>()
      .default(sql`'{}'`)
      .notNull(),
    status: text().default('pending').notNull(),
    timeout_at: text().notNull(),
    responded_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    responded_at: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    index('co_parent_approvals_household_pending_idx')
      .on(t.household_id, sql`${t.created_at} desc`)
      .where(sql`status = 'pending'`),
    index('co_parent_approvals_timeout_idx')
      .on(t.timeout_at)
      .where(sql`status = 'pending'`),
    check(
      'co_parent_approvals_action_check',
      sql`(action IN ('short_notice_change', 'cancel', 'extra_shift', 'other'))`
    ),
    check(
      'co_parent_approvals_status_check',
      sql`(status IN ('pending', 'approved', 'declined', 'timed_out', 'withdrawn'))`
    ),
  ]
);

export const handoffNotes = sqliteTable(
  'handoff_notes',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    local_date: text().notNull(),
    author_id: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    phase: text().notNull(),
    chips: text({ mode: 'json' })
      .$type<unknown[]>()
      .default(sql`'[]'`)
      .notNull(),
    body: text(),
    moment_saved_at: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    index('handoff_notes_household_date_idx').on(
      t.household_id,
      t.local_date,
      t.phase
    ),
    check('handoff_notes_phase_check', sql`(phase IN ('morning', 'evening'))`),
  ]
);
