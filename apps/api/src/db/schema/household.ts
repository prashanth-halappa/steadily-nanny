/**
 * Households and membership: members, invites, closures, holiday choices.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows keep their
 * wire shape. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/household
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
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { NOW } from './columns';
import { userProfiles } from './user';

export const households = sqliteTable(
  'households',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text(),
    timezone: text().default('Europe/London').notNull(),
    address_line: text(),
    latitude: real(),
    longitude: real(),
    approval_mode: text().default('either').notNull(),
    approval_scope: text().default('short_notice_and_cancellations').notNull(),
    short_notice_hours: integer().default(24).notNull(),
    cancellation_paid_within_hours: integer().default(24).notNull(),
    created_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    currency: text().default('USD').notNull(),
    jurisdiction: text(),
    week_starts_on: integer().default(1).notNull(),
    state: text().default('live').notNull(),
    emergency_contact_name: text(),
    emergency_contact_phone: text(),
    emergency_contact_relationship: text(),
    country: text().default('US').notNull(),
  },
  t => [
    index('households_state_idx').on(t.state).where(sql`state = 'draft'`),
    check(
      'households_approval_mode_check',
      sql`(approval_mode IN ('either', 'owner_only'))`
    ),
    check(
      'households_approval_scope_check',
      sql`(approval_scope IN ('all', 'short_notice_and_cancellations'))`
    ),
    check(
      'households_cancellation_paid_within_hours_check',
      sql`((cancellation_paid_within_hours >= 0) AND (cancellation_paid_within_hours <= 336))`
    ),
    check('households_country_check', sql`(country GLOB '[A-Z][A-Z]')`),
    check('households_currency_check', sql`(currency GLOB '[A-Z][A-Z][A-Z]')`),
    check(
      'households_jurisdiction_check',
      sql`((jurisdiction IS NULL) OR (jurisdiction GLOB '[A-Z][A-Z]'))`
    ),
    check(
      'households_live_has_name',
      sql`((state = 'draft') OR ((name IS NOT NULL) AND (length(name) > 0)))`
    ),
    check(
      'households_short_notice_hours_check',
      sql`((short_notice_hours >= 0) AND (short_notice_hours <= 336))`
    ),
    check('households_state_valid', sql`(state IN ('draft', 'live'))`),
    check(
      'households_week_starts_on_check',
      sql`((week_starts_on >= 0) AND (week_starts_on <= 6))`
    ),
  ]
);

export const householdMembers = sqliteTable(
  'household_members',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    user_id: text()
      .notNull()
      .references(() => userProfiles.user_id, { onDelete: 'cascade' }),
    role: text().notNull(),
    can_edit: integer({ mode: 'boolean' }).default(false).notNull(),
    status: text().default('active').notNull(),
    display_name_override: text(),
    colour: text(),
    joined_at: text().default(NOW).notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    ended_reason: text(),
    ended_at: text(),
    ended_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
  },
  t => [
    index('household_members_household_status_idx')
      .on(t.household_id, t.status)
      .where(sql`status = 'active'`),
    uniqueIndex('household_members_user_household_idx').on(
      t.user_id,
      t.household_id
    ),
    check(
      'household_members_ended_reason_check',
      sql`((ended_reason IS NULL) OR (ended_reason IN ('household_closed', 'removed_by_parent', 'left')))`
    ),
    check(
      'household_members_role_check',
      sql`(role IN ('owner', 'parent', 'nanny', 'helper'))`
    ),
    check(
      'household_members_status_check',
      sql`(status IN ('active', 'removed', 'candidate'))`
    ),
  ]
);

export const householdInvites = sqliteTable(
  'household_invites',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    code: text().notNull(),
    email: text(),
    role: text().notNull(),
    invited_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    expires_at: text()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`)
      .notNull(),
    status: text().default('pending').notNull(),
    accepted_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    accepted_at: text(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    link_expires_at: text(),
    opened_at: text(),
    label: text(),
    pay_offer: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    pay_offer_promotion: text(),
  },
  t => [
    unique('household_invites_code_key').on(t.code),
    index('household_invites_code_pending_idx')
      .on(t.code)
      .where(sql`status = 'pending'`),
    index('household_invites_household_idx').on(
      t.household_id,
      sql`${t.created_at} desc`
    ),
    check(
      'household_invites_label_length',
      sql`((label IS NULL) OR (length(label) <= 80))`
    ),
    check(
      'household_invites_pay_offer_promotion_check',
      sql`(pay_offer_promotion IN ('promoted', 'skipped_open_round', 'skipped_stale', 'skipped_no_inviter', 'failed'))`
    ),
    check(
      'household_invites_role_check',
      sql`(role IN ('parent', 'nanny', 'helper'))`
    ),
    check(
      'household_invites_status_check',
      sql`(status IN ('pending', 'accepted', 'revoked', 'expired'))`
    ),
  ]
);

export const householdClosures = sqliteTable(
  'household_closures',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    starts_at: text().notNull(),
    ends_at: text().notNull(),
    message: text(),
    created_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    index('household_closures_household_range_idx').on(
      t.household_id,
      t.starts_at,
      t.ends_at
    ),
    check(
      'household_closures_range',
      sql`(julianday(ends_at) > julianday(starts_at))`
    ),
  ]
);

export const householdHolidays = sqliteTable(
  'household_holidays',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    holiday_key: text().notNull(),
    observed: integer({ mode: 'boolean' }).default(true).notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    unique('household_holidays_household_id_holiday_key_key').on(
      t.household_id,
      t.holiday_key
    ),
  ]
);

export const householdCustomHolidays = sqliteTable(
  'household_custom_holidays',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    dates: text({ mode: 'json' }).$type<string[]>().notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    unique('household_custom_holidays_household_id_name_key').on(
      t.household_id,
      t.name
    ),
    check(
      'household_custom_holidays_dates_check',
      sql`((json_array_length(dates) >= 1) AND (json_array_length(dates) <= 12))`
    ),
    check(
      'household_custom_holidays_name_check',
      sql`((length(trim(name)) >= 1) AND (length(trim(name)) <= 60))`
    ),
  ]
);
