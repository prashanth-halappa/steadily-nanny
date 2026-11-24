/**
 * User-owned rows: profile, devices, notification prefs, reminder log, beta overrides, email log.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows keep their
 * wire shape. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/user
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { NOW } from './columns';

export const userProfiles = sqliteTable(
  'user_profiles',
  {
    user_id: text()
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text(),
    city: text(),
    country: text(),
    preferred_locale: text(),
    additional_data: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    timezone: text(),
    week_starts_on: integer().default(1).notNull(),
    phone: text(),
  },
  _t => [
    check(
      'user_profiles_week_starts_on_check',
      sql`((week_starts_on >= 0) AND (week_starts_on <= 6))`
    ),
  ]
);

export const userDeviceInfo = sqliteTable(
  'user_device_info',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text()
      .notNull()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    device_id: text(),
    expo_push_token: text(),
    platform: text(),
    notification_permission: text().default('denied').notNull(),
    timezone: text(),
    app_version: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    unique('user_device_info_user_device_uq').on(t.user_id, t.device_id),
    index('idx_user_device_info_user_id').on(t.user_id),
    check(
      'user_device_info_notification_permission_check',
      sql`(notification_permission IN ('granted', 'provisional', 'denied'))`
    ),
  ]
);

export const notificationPrefs = sqliteTable(
  'notification_prefs',
  {
    user_id: text()
      .primaryKey()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    disabled_types: text({ mode: 'json' })
      .$type<string[]>()
      .default(sql`'[]'`)
      .notNull(),
    quiet_hours_enabled: integer({ mode: 'boolean' }).default(false).notNull(),
    quiet_hours_start: text(),
    quiet_hours_end: text(),
    timezone: text().default('UTC').notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  _t => [
    check(
      'notification_prefs_quiet_hours_pair_chk',
      sql`((quiet_hours_enabled = false) OR ((quiet_hours_start IS NOT NULL) AND (quiet_hours_end IS NOT NULL)))`
    ),
  ]
);

export const pushReminderLog = sqliteTable(
  'push_reminder_log',
  {
    user_id: text()
      .notNull()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    reminder_key: text().notNull(),
    sent_at: text().default(NOW).notNull(),
    confirmed_at: text(),
  },
  t => [
    primaryKey({
      name: 'push_reminder_log_pkey',
      columns: [t.user_id, t.reminder_key],
    }),
    index('idx_push_reminder_log_sent_at').on(t.sent_at),
  ]
);

export const userBetaOverrides = sqliteTable(
  'user_beta_overrides',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text().references(() => user.id, { onDelete: 'cascade' }),
    email: text(),
    beta_all_pro: integer({ mode: 'boolean' }).notNull(),
    note: text(),
    created_at: text().default(NOW).notNull(),
  },
  t => [
    uniqueIndex('user_beta_overrides_email_uidx')
      .on(sql`lower(email)`)
      .where(sql`email IS NOT NULL`),
    uniqueIndex('user_beta_overrides_user_id_uidx')
      .on(t.user_id)
      .where(sql`user_id IS NOT NULL`),
    check(
      'user_beta_overrides_user_or_email',
      sql`((user_id IS NOT NULL) OR (email IS NOT NULL))`
    ),
  ]
);
