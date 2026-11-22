/**
 * Carer availability, time off, and external calendar sync.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows keep their
 * wire shape. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/availability
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
import { NOW } from './columns';
import { userProfiles } from './user';

export const carerAvailability = sqliteTable(
  'carer_availability',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text()
      .notNull()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    weekday: integer().notNull(),
    is_available: integer({ mode: 'boolean' }).default(false).notNull(),
    earliest_start: text(),
    latest_finish: text(),
    evening_mode: text().default('never').notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    uniqueIndex('carer_availability_user_weekday_idx').on(t.user_id, t.weekday),
    check(
      'carer_availability_evening_mode_check',
      sql`(evening_mode IN ('never', 'sometimes', 'always'))`
    ),
    check(
      'carer_availability_time_order',
      sql`((earliest_start IS NULL) OR (latest_finish IS NULL) OR (latest_finish > earliest_start))`
    ),
    check(
      'carer_availability_weekday_check',
      sql`((weekday >= 0) AND (weekday <= 6))`
    ),
  ]
);

export const carerTimeOff = sqliteTable(
  'carer_time_off',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text()
      .notNull()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    starts_at: text().notNull(),
    ends_at: text().notNull(),
    all_day: integer({ mode: 'boolean' }).default(true).notNull(),
    message: text(),
    status: text().default('confirmed').notNull(),
    ical_uid: text()
      .$defaultFn(() => crypto.randomUUID())
      .notNull(),
    sequence: integer().default(0).notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    kind: text().default('personal').notNull(),
  },
  t => [
    unique('carer_time_off_ical_uid_key').on(t.ical_uid),
    index('carer_time_off_user_range_idx')
      .on(t.user_id, t.starts_at, t.ends_at)
      .where(sql`status <> 'cancelled'`),
    check('carer_time_off_kind_check', sql`(kind IN ('personal', 'sick'))`),
    check(
      'carer_time_off_range',
      sql`(julianday(ends_at) > julianday(starts_at))`
    ),
    check(
      'carer_time_off_status_check',
      sql`(status IN ('requested', 'confirmed', 'cancelled'))`
    ),
  ]
);

export const calendarAccounts = sqliteTable(
  'calendar_accounts',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text()
      .notNull()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    account_identifier: text().notNull(),
    display_name: text(),
    sync_enabled: integer({ mode: 'boolean' }).default(true).notNull(),
    sync_direction: text().default('read').notNull(),
    default_calendar_id: text(),
    credentials_ref: text(),
    sync_token: text(),
    last_sync_at: text(),
    status: text().default('active').notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    uniqueIndex('calendar_accounts_user_provider_idx').on(
      t.user_id,
      t.provider,
      t.account_identifier
    ),
    check(
      'calendar_accounts_provider_check',
      sql`(provider IN ('google', 'apple', 'caldav'))`
    ),
    check(
      'calendar_accounts_status_check',
      sql`(status IN ('active', 'reauth_required', 'disabled'))`
    ),
    check(
      'calendar_accounts_sync_direction_check',
      sql`(sync_direction IN ('read', 'write', 'both'))`
    ),
  ]
);

export const calendarEventLinks = sqliteTable(
  'calendar_event_links',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    calendar_account_id: text()
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: 'cascade' }),
    entity_type: text().notNull(),
    entity_id: text().notNull(),
    external_event_id: text().notNull(),
    external_calendar_id: text(),
    etag: text(),
    last_pushed_sequence: integer().default(0).notNull(),
    last_synced_at: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    uniqueIndex('calendar_event_links_account_entity_idx').on(
      t.calendar_account_id,
      t.entity_type,
      t.entity_id
    ),
    index('calendar_event_links_entity_idx').on(t.entity_type, t.entity_id),
    check(
      'calendar_event_links_entity_type_check',
      sql`(entity_type IN ('shift', 'time_off', 'commitment'))`
    ),
  ]
);

export const externalBusyBlocks = sqliteTable(
  'external_busy_blocks',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text()
      .notNull()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    calendar_account_id: text().references(() => calendarAccounts.id, {
      onDelete: 'cascade',
    }),
    starts_at: text().notNull(),
    ends_at: text().notNull(),
    all_day: integer({ mode: 'boolean' }).default(false).notNull(),
    opacity: text().default('busy').notNull(),
    title: text(),
    source: text().default('calendar').notNull(),
    external_event_id: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    index('external_busy_blocks_user_range_idx')
      .on(t.user_id, t.starts_at, t.ends_at)
      .where(sql`opacity <> 'free'`),
    check(
      'external_busy_blocks_opacity_check',
      sql`(opacity IN ('busy', 'free', 'tentative'))`
    ),
    check(
      'external_busy_blocks_range',
      sql`(julianday(ends_at) > julianday(starts_at))`
    ),
  ]
);

/*
 * v_busy_blocks (Postgres view, 016; last redefined in 104) is NOT created in D1 — run it as a
 * repository query instead. Its definition:
 *
 *   SELECT s.carer_id AS user_id, s.starts_at, s.ends_at,
 *          'other_commitment' AS kind, s.ical_uid AS source_uid
 *     FROM shifts s
 *    WHERE s.carer_id IS NOT NULL AND s.status IN ('pending', 'confirmed')
 *   UNION ALL
 *   SELECT t.user_id, t.starts_at, t.ends_at, 'time_off' AS kind, t.ical_uid
 *     FROM carer_time_off t WHERE t.status <> 'cancelled'
 *   UNION ALL
 *   SELECT b.user_id, b.starts_at, b.ends_at, 'personal' AS kind, b.external_event_id
 *     FROM external_busy_blocks b WHERE b.opacity <> 'free'
 *
 * (security_invoker = on — RLS-scoped in Postgres; the caller now filters by
 * user_id itself.)
 */
