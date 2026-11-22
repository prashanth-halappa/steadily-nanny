/**
 * Money: pay arrangements, acks, payments, PTO ledger, expenses, reimbursement settlements, terms proposals. Amounts are integer minor units (docs/11-MONEY.md); multipliers and miles are REAL.
 *
 * Generated from the Postgres end state (001–113) and hand-checked. Columns keep
 * their snake_case names as JS keys so rows have the same shape supabase-js
 * returned. uuid/timestamptz/date/time → TEXT; jsonb/arrays → JSON TEXT.
 *
 * @module db/schema/pay
 */
import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { carerTimeOff } from './availability';
import { NOW } from './columns';
import { householdInvites, households } from './household';
import { timesheets } from './timesheet';
import { userProfiles } from './user';

export const payArrangements = sqliteTable(
  'pay_arrangements',
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
    rate_minor: integer().notNull(),
    bill_rate_minor: integer(),
    currency: text().default('GBP').notNull(),
    overtime_threshold_minutes: integer(),
    overtime_multiplier: real().default(1.5).notNull(),
    guaranteed_minutes_per_week: integer(),
    pto_entitlement_minutes_per_year: integer(),
    mileage_rate_per_mile_minor: integer(),
    cancellation_paid_within_hours: integer(),
    valid_from: text().notNull(),
    carer_display_name: text().notNull(),
    note: text(),
    created_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    created_at: text().default(NOW).notNull(),
    household_member_id: text(),
    valid_to: text(),
    terms: text({ mode: 'json' })
      .$type<Record<string, unknown>>()
      .default(sql`'{}'`)
      .notNull(),
    overtime_daily_threshold_minutes: integer(),
    doubletime_daily_threshold_minutes: integer(),
    doubletime_multiplier: real(),
    seventh_day_multiplier: real(),
    seventh_day_doubletime_after_minutes: integer(),
    worked_holiday_multiplier: real(),
    pay_frequency: text(),
    pay_day_of_week: integer(),
    pay_day_of_month: integer(),
    holiday_hours_minutes: integer(),
  },
  t => [
    index('pay_arrangements_household_carer_valid_from_idx').on(
      t.household_id,
      t.carer_id,
      sql`${t.valid_from} desc`
    ),
    check(
      'pay_arrangements_bill_rate_minor_check',
      sql`(bill_rate_minor >= 0)`
    ),
    check(
      'pay_arrangements_bill_rate_minor_upper',
      sql`(bill_rate_minor <= 99999999)`
    ),
    check(
      'pay_arrangements_cancellation_paid_within_hours_check',
      sql`(cancellation_paid_within_hours > 0)`
    ),
    check(
      'pay_arrangements_currency_check',
      sql`(currency GLOB '[A-Z][A-Z][A-Z]')`
    ),
    check(
      'pay_arrangements_daily_tiers_ordered',
      sql`((doubletime_daily_threshold_minutes IS NULL) OR (overtime_daily_threshold_minutes IS NULL) OR (doubletime_daily_threshold_minutes > overtime_daily_threshold_minutes))`
    ),
    check(
      'pay_arrangements_doubletime_daily_needs_multiplier',
      sql`((doubletime_daily_threshold_minutes IS NULL) OR (doubletime_multiplier IS NOT NULL))`
    ),
    check(
      'pay_arrangements_doubletime_daily_threshold_positive',
      sql`(doubletime_daily_threshold_minutes > 0)`
    ),
    check(
      'pay_arrangements_doubletime_multiplier_min',
      sql`(doubletime_multiplier >= 1)`
    ),
    check(
      'pay_arrangements_guaranteed_minutes_per_week_check',
      sql`(guaranteed_minutes_per_week >= 0)`
    ),
    check(
      'pay_arrangements_holiday_hours_minutes_positive',
      sql`(holiday_hours_minutes > 0)`
    ),
    check(
      'pay_arrangements_mileage_rate_per_mile_minor_check',
      sql`(mileage_rate_per_mile_minor >= 0)`
    ),
    check(
      'pay_arrangements_mileage_rate_per_mile_minor_upper',
      sql`(mileage_rate_per_mile_minor <= 99999999)`
    ),
    check(
      'pay_arrangements_overtime_daily_threshold_positive',
      sql`(overtime_daily_threshold_minutes > 0)`
    ),
    check(
      'pay_arrangements_overtime_multiplier_check',
      sql`(overtime_multiplier >= 1)`
    ),
    check(
      'pay_arrangements_overtime_threshold_minutes_check',
      sql`(overtime_threshold_minutes > 0)`
    ),
    check(
      'pay_arrangements_pay_day_of_month_range',
      sql`((pay_day_of_month IS NULL) OR ((pay_day_of_month >= 1) AND (pay_day_of_month <= 31)))`
    ),
    check(
      'pay_arrangements_pay_day_of_week_range',
      sql`((pay_day_of_week IS NULL) OR ((pay_day_of_week >= 0) AND (pay_day_of_week <= 6)))`
    ),
    check(
      'pay_arrangements_pay_frequency_valid',
      sql`((pay_frequency IS NULL) OR (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')))`
    ),
    check(
      'pay_arrangements_pto_entitlement_minutes_per_year_check',
      sql`(pto_entitlement_minutes_per_year >= 0)`
    ),
    check('pay_arrangements_rate_minor_check', sql`(rate_minor >= 0)`),
    check('pay_arrangements_rate_minor_upper', sql`(rate_minor <= 99999999)`),
    check(
      'pay_arrangements_seventh_day_doubletime_after_positive',
      sql`(seventh_day_doubletime_after_minutes > 0)`
    ),
    check(
      'pay_arrangements_seventh_day_multiplier_min',
      sql`(seventh_day_multiplier >= 1)`
    ),
    check(
      'pay_arrangements_seventh_day_second_tier_needs_multiplier',
      sql`((seventh_day_doubletime_after_minutes IS NULL) OR ((seventh_day_multiplier IS NOT NULL) AND (doubletime_multiplier IS NOT NULL)))`
    ),
    check(
      'pay_arrangements_valid_to_after_valid_from',
      sql`((valid_to IS NULL) OR (valid_to >= valid_from))`
    ),
    check(
      'pay_arrangements_worked_holiday_multiplier_min',
      sql`(worked_holiday_multiplier >= 1)`
    ),
  ]
);

export const payArrangementAcks = sqliteTable(
  'pay_arrangement_acks',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    arrangement_id: text()
      .notNull()
      .references(() => payArrangements.id, { onDelete: 'cascade' }),
    carer_id: text().notNull(),
    kind: text().notNull(),
    note: text(),
    created_at: text().default(NOW).notNull(),
  },
  t => [
    unique('pay_arrangement_acks_arrangement_id_carer_id_kind_key').on(
      t.arrangement_id,
      t.carer_id,
      t.kind
    ),
    check(
      'pay_arrangement_acks_kind_check',
      sql`(kind IN ('seen', 'disagreed'))`
    ),
    check('pay_arrangement_acks_note_length', sql`(length(note) <= 280)`),
  ]
);

export const payments = sqliteTable(
  'payments',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    timesheet_id: text()
      .notNull()
      .references(() => timesheets.id, { onDelete: 'cascade' }),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    carer_id: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    amount_minor: integer().notNull(),
    currency: text().notNull(),
    paid_at: text().notNull(),
    method_note: text(),
    recorded_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    created_at: text().default(NOW).notNull(),
    kind: text().default('payment').notNull(),
    corrects_payment_id: text().references((): AnySQLiteColumn => payments.id, {
      onDelete: 'cascade',
    }),
    correction_reason: text(),
    idempotency_key: text(),
  },
  t => [
    index('payments_corrects_idx')
      .on(t.corrects_payment_id)
      .where(sql`corrects_payment_id IS NOT NULL`),
    index('payments_household_paid_at_idx').on(t.household_id, t.paid_at),
    uniqueIndex('payments_idempotency_key_uidx')
      .on(t.idempotency_key)
      .where(sql`idempotency_key IS NOT NULL`),
    index('payments_timesheet_idx').on(t.timesheet_id),
    check(
      'payments_amount_minor_signed_chk',
      sql`((amount_minor <> 0) AND (amount_minor >= -99999999) AND (amount_minor <= 99999999))`
    ),
    check('payments_currency_check', sql`(currency GLOB '[A-Z][A-Z][A-Z]')`),
    check('payments_kind_chk', sql`(kind IN ('payment', 'correction'))`),
    check(
      'payments_kind_shape_chk',
      sql`(((kind = 'payment') AND (corrects_payment_id IS NULL) AND (correction_reason IS NULL) AND (amount_minor >= 1)) OR ((kind = 'correction') AND (corrects_payment_id IS NOT NULL) AND (correction_reason IS NOT NULL) AND (amount_minor <= -1)))`
    ),
  ]
);

export const ptoLedger = sqliteTable(
  'pto_ledger',
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
    kind: text().notNull(),
    minutes: integer().notNull(),
    effective_date: text().notNull(),
    time_off_id: text().references(() => carerTimeOff.id, {
      onDelete: 'set null',
    }),
    carer_display_name: text().notNull(),
    note: text(),
    created_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    created_at: text().default(NOW).notNull(),
    household_member_id: text(),
    leave_kind: text(),
  },
  t => [
    index('pto_ledger_household_carer_idx').on(t.household_id, t.carer_id),
    uniqueIndex('pto_ledger_one_accrual_per_year_idx')
      .on(t.household_id, t.carer_id, t.effective_date)
      .where(sql`kind = 'accrual'`),
    uniqueIndex('pto_ledger_one_usage_per_time_off_day_idx')
      .on(t.household_id, t.time_off_id, t.effective_date)
      .where(sql`kind = 'usage'`),
    check(
      'pto_ledger_kind_check',
      sql`(kind IN ('accrual', 'usage', 'adjustment'))`
    ),
    check(
      'pto_ledger_leave_kind_check',
      sql`((leave_kind IS NULL) OR (leave_kind IN ('personal', 'sick')))`
    ),
    check('pto_ledger_minutes_check', sql`(minutes <> 0)`),
  ]
);

export const expenses = sqliteTable(
  'expenses',
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
    local_date: text().notNull(),
    kind: text().notNull(),
    description: text().notNull(),
    amount_minor: integer(),
    miles: real(),
    currency: text().default('GBP').notNull(),
    status: text().default('pending').notNull(),
    reviewed_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    reviewed_at: text(),
    review_note: text(),
    carer_display_name: text().notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
    household_member_id: text(),
  },
  t => [
    index('expenses_carer_status_idx').on(t.carer_id, t.status),
    index('expenses_household_date_idx').on(t.household_id, t.local_date),
    uniqueIndex('expenses_one_pending_claim_idx')
      .on(
        t.household_id,
        t.carer_id,
        t.local_date,
        t.kind,
        t.description,
        t.currency,
        sql`quote(amount_minor)`,
        sql`quote(miles)`
      )
      .where(sql`status = 'pending'`),
    check('expenses_amount_minor_check', sql`(amount_minor >= 0)`),
    check('expenses_amount_minor_upper', sql`(amount_minor <= 99999999)`),
    check('expenses_currency_check', sql`(currency GLOB '[A-Z][A-Z][A-Z]')`),
    check(
      'expenses_expense_has_amount',
      sql`((kind <> 'expense') OR (amount_minor IS NOT NULL))`
    ),
    check('expenses_kind_check', sql`(kind IN ('expense', 'mileage'))`),
    check(
      'expenses_mileage_amount_after_approval',
      sql`((kind <> 'mileage') OR (status = 'approved') OR (amount_minor IS NULL))`
    ),
    check(
      'expenses_mileage_has_miles',
      sql`((kind <> 'mileage') OR (miles IS NOT NULL))`
    ),
    check('expenses_miles_check', sql`(miles > 0)`),
    check(
      'expenses_status_check',
      sql`(status IN ('pending', 'approved', 'rejected'))`
    ),
  ]
);

export const reimbursementSettlements = sqliteTable(
  'reimbursement_settlements',
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
    amount_minor: integer().notNull(),
    currency: text().notNull(),
    settled_at: text().notNull(),
    note: text(),
    recorded_by: text().references(() => userProfiles.user_id, {
      onDelete: 'set null',
    }),
    created_at: text().default(NOW).notNull(),
  },
  t => [
    uniqueIndex('reimbursement_settlements_week_idx').on(
      t.household_id,
      t.carer_id,
      t.week_start
    ),
    check(
      'reimbursement_settlements_amount_minor_check',
      sql`((amount_minor >= 1) AND (amount_minor <= 99999999))`
    ),
    check(
      'reimbursement_settlements_currency_check',
      sql`(currency GLOB '[A-Z][A-Z][A-Z]')`
    ),
  ]
);

export const termsProposals = sqliteTable(
  'terms_proposals',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    household_id: text()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    carer_id: text().notNull(),
    proposed_by: text().notNull(),
    direction: text().notNull(),
    status: text().default('proposed').notNull(),
    terms: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    note: text(),
    supersedes_id: text().references((): AnySQLiteColumn => termsProposals.id, {
      onDelete: 'set null',
    }),
    from_invite_id: text().references(() => householdInvites.id, {
      onDelete: 'set null',
    }),
    carer_display_name: text().notNull(),
    viewed_at: text(),
    responded_at: text(),
    accepted_by: text(),
    accepted_arrangement_id: text().references(() => payArrangements.id, {
      onDelete: 'set null',
    }),
    responsibility_confirmed: integer({ mode: 'boolean' })
      .default(false)
      .notNull(),
    created_at: text().default(NOW).notNull(),
    updated_at: text().default(NOW).notNull(),
  },
  t => [
    index('terms_proposals_from_invite_idx')
      .on(t.from_invite_id)
      .where(sql`from_invite_id IS NOT NULL`),
    index('terms_proposals_household_carer_idx').on(
      t.household_id,
      t.carer_id,
      sql`${t.created_at} desc`
    ),
    uniqueIndex('terms_proposals_open_unique_idx')
      .on(t.household_id, t.carer_id)
      .where(sql`status = 'proposed'`),
    check(
      'terms_proposals_accepted_needs_confirmation',
      sql`((status <> 'accepted') OR responsibility_confirmed)`
    ),
    check(
      'terms_proposals_direction_check',
      sql`(direction IN ('carer', 'parent'))`
    ),
    check(
      'terms_proposals_responded_at_present',
      sql`((status = 'proposed') OR (responded_at IS NOT NULL))`
    ),
    check(
      'terms_proposals_status_check',
      sql`(status IN ('proposed', 'countered', 'accepted', 'withdrawn', 'declined'))`
    ),
  ]
);
