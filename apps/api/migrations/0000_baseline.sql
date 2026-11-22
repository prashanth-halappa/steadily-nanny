CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `calendar_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_identifier` text NOT NULL,
	`display_name` text,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`sync_direction` text DEFAULT 'read' NOT NULL,
	`default_calendar_id` text,
	`credentials_ref` text,
	`sync_token` text,
	`last_sync_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_accounts_provider_check" CHECK((provider IN ('google', 'apple', 'caldav'))),
	CONSTRAINT "calendar_accounts_status_check" CHECK((status IN ('active', 'reauth_required', 'disabled'))),
	CONSTRAINT "calendar_accounts_sync_direction_check" CHECK((sync_direction IN ('read', 'write', 'both')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_accounts_user_provider_idx` ON `calendar_accounts` (`user_id`,`provider`,`account_identifier`);--> statement-breakpoint
CREATE TABLE `calendar_event_links` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_account_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`external_calendar_id` text,
	`etag` text,
	`last_pushed_sequence` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`calendar_account_id`) REFERENCES `calendar_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_event_links_entity_type_check" CHECK((entity_type IN ('shift', 'time_off', 'commitment')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_account_entity_idx` ON `calendar_event_links` (`calendar_account_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_links_entity_idx` ON `calendar_event_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `carer_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`is_available` integer DEFAULT false NOT NULL,
	`earliest_start` text,
	`latest_finish` text,
	`evening_mode` text DEFAULT 'never' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "carer_availability_evening_mode_check" CHECK((evening_mode IN ('never', 'sometimes', 'always'))),
	CONSTRAINT "carer_availability_time_order" CHECK(((earliest_start IS NULL) OR (latest_finish IS NULL) OR (latest_finish > earliest_start))),
	CONSTRAINT "carer_availability_weekday_check" CHECK(((weekday >= 0) AND (weekday <= 6)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carer_availability_user_weekday_idx` ON `carer_availability` (`user_id`,`weekday`);--> statement-breakpoint
CREATE TABLE `carer_time_off` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`all_day` integer DEFAULT true NOT NULL,
	`message` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`ical_uid` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`kind` text DEFAULT 'personal' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "carer_time_off_kind_check" CHECK((kind IN ('personal', 'sick'))),
	CONSTRAINT "carer_time_off_range" CHECK((julianday(ends_at) > julianday(starts_at))),
	CONSTRAINT "carer_time_off_status_check" CHECK((status IN ('requested', 'confirmed', 'cancelled')))
);
--> statement-breakpoint
CREATE INDEX `carer_time_off_user_range_idx` ON `carer_time_off` (`user_id`,`starts_at`,`ends_at`) WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX `carer_time_off_ical_uid_key` ON `carer_time_off` (`ical_uid`);--> statement-breakpoint
CREATE TABLE `external_busy_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`calendar_account_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`opacity` text DEFAULT 'busy' NOT NULL,
	`title` text,
	`source` text DEFAULT 'calendar' NOT NULL,
	`external_event_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_account_id`) REFERENCES `calendar_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_busy_blocks_opacity_check" CHECK((opacity IN ('busy', 'free', 'tentative'))),
	CONSTRAINT "external_busy_blocks_range" CHECK((julianday(ends_at) > julianday(starts_at)))
);
--> statement-breakpoint
CREATE INDEX `external_busy_blocks_user_range_idx` ON `external_busy_blocks` (`user_id`,`starts_at`,`ends_at`) WHERE opacity <> 'free';--> statement-breakpoint
CREATE TABLE `child_commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`household_id` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`label` text,
	`rrule` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`exdates` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "child_commitments_kind_check" CHECK((kind IN ('preschool', 'school', 'activity', 'nap', 'other'))),
	CONSTRAINT "child_commitments_time_order" CHECK((end_time > start_time))
);
--> statement-breakpoint
CREATE INDEX `child_commitments_child_idx` ON `child_commitments` (`child_id`);--> statement-breakpoint
CREATE INDEX `child_commitments_household_idx` ON `child_commitments` (`household_id`);--> statement-breakpoint
CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`birth_date` text,
	`colour` text,
	`avatar_initial` text,
	`routine_notes` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `children_household_idx` ON `children` (`household_id`) WHERE archived_at IS NULL;--> statement-breakpoint
CREATE TABLE `household_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`message` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "household_closures_range" CHECK((julianday(ends_at) > julianday(starts_at)))
);
--> statement-breakpoint
CREATE INDEX `household_closures_household_range_idx` ON `household_closures` (`household_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `household_custom_holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`dates` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_custom_holidays_dates_check" CHECK(((json_array_length(dates) >= 1) AND (json_array_length(dates) <= 12))),
	CONSTRAINT "household_custom_holidays_name_check" CHECK(((length(trim(name)) >= 1) AND (length(trim(name)) <= 60)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_custom_holidays_household_id_name_key` ON `household_custom_holidays` (`household_id`,`name`);--> statement-breakpoint
CREATE TABLE `household_holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`holiday_key` text NOT NULL,
	`observed` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_holidays_household_id_holiday_key_key` ON `household_holidays` (`household_id`,`holiday_key`);--> statement-breakpoint
CREATE TABLE `household_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`code` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`invited_by` text,
	`expires_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days')) NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`link_expires_at` text,
	`opened_at` text,
	`label` text,
	`pay_offer` text,
	`pay_offer_promotion` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "household_invites_label_length" CHECK(((label IS NULL) OR (length(label) <= 80))),
	CONSTRAINT "household_invites_pay_offer_promotion_check" CHECK((pay_offer_promotion IN ('promoted', 'skipped_open_round', 'skipped_stale', 'skipped_no_inviter', 'failed'))),
	CONSTRAINT "household_invites_role_check" CHECK((role IN ('parent', 'nanny', 'helper'))),
	CONSTRAINT "household_invites_status_check" CHECK((status IN ('pending', 'accepted', 'revoked', 'expired')))
);
--> statement-breakpoint
CREATE INDEX `household_invites_code_pending_idx` ON `household_invites` (`code`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `household_invites_household_idx` ON `household_invites` (`household_id`,"created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `household_invites_code_key` ON `household_invites` (`code`);--> statement-breakpoint
CREATE TABLE `household_members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`can_edit` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`display_name_override` text,
	`colour` text,
	`joined_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ended_reason` text,
	`ended_at` text,
	`ended_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ended_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "household_members_ended_reason_check" CHECK(((ended_reason IS NULL) OR (ended_reason IN ('household_closed', 'removed_by_parent', 'left')))),
	CONSTRAINT "household_members_role_check" CHECK((role IN ('owner', 'parent', 'nanny', 'helper'))),
	CONSTRAINT "household_members_status_check" CHECK((status IN ('active', 'removed', 'candidate')))
);
--> statement-breakpoint
CREATE INDEX `household_members_household_status_idx` ON `household_members` (`household_id`,`status`) WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_user_household_idx` ON `household_members` (`user_id`,`household_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`timezone` text DEFAULT 'Europe/London' NOT NULL,
	`address_line` text,
	`latitude` real,
	`longitude` real,
	`approval_mode` text DEFAULT 'either' NOT NULL,
	`approval_scope` text DEFAULT 'short_notice_and_cancellations' NOT NULL,
	`short_notice_hours` integer DEFAULT 24 NOT NULL,
	`cancellation_paid_within_hours` integer DEFAULT 24 NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`jurisdiction` text,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'live' NOT NULL,
	`emergency_contact_name` text,
	`emergency_contact_phone` text,
	`emergency_contact_relationship` text,
	`country` text DEFAULT 'US' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "households_approval_mode_check" CHECK((approval_mode IN ('either', 'owner_only'))),
	CONSTRAINT "households_approval_scope_check" CHECK((approval_scope IN ('all', 'short_notice_and_cancellations'))),
	CONSTRAINT "households_cancellation_paid_within_hours_check" CHECK(((cancellation_paid_within_hours >= 0) AND (cancellation_paid_within_hours <= 336))),
	CONSTRAINT "households_country_check" CHECK((country GLOB '[A-Z][A-Z]')),
	CONSTRAINT "households_currency_check" CHECK((currency GLOB '[A-Z][A-Z][A-Z]')),
	CONSTRAINT "households_jurisdiction_check" CHECK(((jurisdiction IS NULL) OR (jurisdiction GLOB '[A-Z][A-Z]'))),
	CONSTRAINT "households_live_has_name" CHECK(((state = 'draft') OR ((name IS NOT NULL) AND (length(name) > 0)))),
	CONSTRAINT "households_short_notice_hours_check" CHECK(((short_notice_hours >= 0) AND (short_notice_hours <= 336))),
	CONSTRAINT "households_state_valid" CHECK((state IN ('draft', 'live'))),
	CONSTRAINT "households_week_starts_on_check" CHECK(((week_starts_on >= 0) AND (week_starts_on <= 6)))
);
--> statement-breakpoint
CREATE INDEX `households_state_idx` ON `households` (`state`) WHERE state = 'draft';--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`local_date` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`amount_minor` integer,
	`miles` real,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_note` text,
	`carer_display_name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`household_member_id` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "expenses_amount_minor_check" CHECK((amount_minor >= 0)),
	CONSTRAINT "expenses_amount_minor_upper" CHECK((amount_minor <= 99999999)),
	CONSTRAINT "expenses_currency_check" CHECK((currency GLOB '[A-Z][A-Z][A-Z]')),
	CONSTRAINT "expenses_expense_has_amount" CHECK(((kind <> 'expense') OR (amount_minor IS NOT NULL))),
	CONSTRAINT "expenses_kind_check" CHECK((kind IN ('expense', 'mileage'))),
	CONSTRAINT "expenses_mileage_amount_after_approval" CHECK(((kind <> 'mileage') OR (status = 'approved') OR (amount_minor IS NULL))),
	CONSTRAINT "expenses_mileage_has_miles" CHECK(((kind <> 'mileage') OR (miles IS NOT NULL))),
	CONSTRAINT "expenses_miles_check" CHECK((miles > 0)),
	CONSTRAINT "expenses_status_check" CHECK((status IN ('pending', 'approved', 'rejected')))
);
--> statement-breakpoint
CREATE INDEX `expenses_carer_status_idx` ON `expenses` (`carer_id`,`status`);--> statement-breakpoint
CREATE INDEX `expenses_household_date_idx` ON `expenses` (`household_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_one_pending_claim_idx` ON `expenses` (`household_id`,`carer_id`,`local_date`,`kind`,`description`,`currency`,quote(amount_minor),quote(miles)) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `pay_arrangement_acks` (
	`id` text PRIMARY KEY NOT NULL,
	`arrangement_id` text NOT NULL,
	`carer_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`arrangement_id`) REFERENCES `pay_arrangements`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pay_arrangement_acks_kind_check" CHECK((kind IN ('seen', 'disagreed'))),
	CONSTRAINT "pay_arrangement_acks_note_length" CHECK((length(note) <= 280))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_arrangement_acks_arrangement_id_carer_id_kind_key` ON `pay_arrangement_acks` (`arrangement_id`,`carer_id`,`kind`);--> statement-breakpoint
CREATE TABLE `pay_arrangements` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`rate_minor` integer NOT NULL,
	`bill_rate_minor` integer,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`overtime_threshold_minutes` integer,
	`overtime_multiplier` real DEFAULT 1.5 NOT NULL,
	`guaranteed_minutes_per_week` integer,
	`pto_entitlement_minutes_per_year` integer,
	`mileage_rate_per_mile_minor` integer,
	`cancellation_paid_within_hours` integer,
	`valid_from` text NOT NULL,
	`carer_display_name` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`household_member_id` text,
	`valid_to` text,
	`terms` text DEFAULT '{}' NOT NULL,
	`overtime_daily_threshold_minutes` integer,
	`doubletime_daily_threshold_minutes` integer,
	`doubletime_multiplier` real,
	`seventh_day_multiplier` real,
	`seventh_day_doubletime_after_minutes` integer,
	`worked_holiday_multiplier` real,
	`pay_frequency` text,
	`pay_day_of_week` integer,
	`pay_day_of_month` integer,
	`holiday_hours_minutes` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pay_arrangements_bill_rate_minor_check" CHECK((bill_rate_minor >= 0)),
	CONSTRAINT "pay_arrangements_bill_rate_minor_upper" CHECK((bill_rate_minor <= 99999999)),
	CONSTRAINT "pay_arrangements_cancellation_paid_within_hours_check" CHECK((cancellation_paid_within_hours > 0)),
	CONSTRAINT "pay_arrangements_currency_check" CHECK((currency GLOB '[A-Z][A-Z][A-Z]')),
	CONSTRAINT "pay_arrangements_daily_tiers_ordered" CHECK(((doubletime_daily_threshold_minutes IS NULL) OR (overtime_daily_threshold_minutes IS NULL) OR (doubletime_daily_threshold_minutes > overtime_daily_threshold_minutes))),
	CONSTRAINT "pay_arrangements_doubletime_daily_needs_multiplier" CHECK(((doubletime_daily_threshold_minutes IS NULL) OR (doubletime_multiplier IS NOT NULL))),
	CONSTRAINT "pay_arrangements_doubletime_daily_threshold_positive" CHECK((doubletime_daily_threshold_minutes > 0)),
	CONSTRAINT "pay_arrangements_doubletime_multiplier_min" CHECK((doubletime_multiplier >= 1)),
	CONSTRAINT "pay_arrangements_guaranteed_minutes_per_week_check" CHECK((guaranteed_minutes_per_week >= 0)),
	CONSTRAINT "pay_arrangements_holiday_hours_minutes_positive" CHECK((holiday_hours_minutes > 0)),
	CONSTRAINT "pay_arrangements_mileage_rate_per_mile_minor_check" CHECK((mileage_rate_per_mile_minor >= 0)),
	CONSTRAINT "pay_arrangements_mileage_rate_per_mile_minor_upper" CHECK((mileage_rate_per_mile_minor <= 99999999)),
	CONSTRAINT "pay_arrangements_overtime_daily_threshold_positive" CHECK((overtime_daily_threshold_minutes > 0)),
	CONSTRAINT "pay_arrangements_overtime_multiplier_check" CHECK((overtime_multiplier >= 1)),
	CONSTRAINT "pay_arrangements_overtime_threshold_minutes_check" CHECK((overtime_threshold_minutes > 0)),
	CONSTRAINT "pay_arrangements_pay_day_of_month_range" CHECK(((pay_day_of_month IS NULL) OR ((pay_day_of_month >= 1) AND (pay_day_of_month <= 31)))),
	CONSTRAINT "pay_arrangements_pay_day_of_week_range" CHECK(((pay_day_of_week IS NULL) OR ((pay_day_of_week >= 0) AND (pay_day_of_week <= 6)))),
	CONSTRAINT "pay_arrangements_pay_frequency_valid" CHECK(((pay_frequency IS NULL) OR (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')))),
	CONSTRAINT "pay_arrangements_pto_entitlement_minutes_per_year_check" CHECK((pto_entitlement_minutes_per_year >= 0)),
	CONSTRAINT "pay_arrangements_rate_minor_check" CHECK((rate_minor >= 0)),
	CONSTRAINT "pay_arrangements_rate_minor_upper" CHECK((rate_minor <= 99999999)),
	CONSTRAINT "pay_arrangements_seventh_day_doubletime_after_positive" CHECK((seventh_day_doubletime_after_minutes > 0)),
	CONSTRAINT "pay_arrangements_seventh_day_multiplier_min" CHECK((seventh_day_multiplier >= 1)),
	CONSTRAINT "pay_arrangements_seventh_day_second_tier_needs_multiplier" CHECK(((seventh_day_doubletime_after_minutes IS NULL) OR ((seventh_day_multiplier IS NOT NULL) AND (doubletime_multiplier IS NOT NULL)))),
	CONSTRAINT "pay_arrangements_valid_to_after_valid_from" CHECK(((valid_to IS NULL) OR (valid_to >= valid_from))),
	CONSTRAINT "pay_arrangements_worked_holiday_multiplier_min" CHECK((worked_holiday_multiplier >= 1))
);
--> statement-breakpoint
CREATE INDEX `pay_arrangements_household_carer_valid_from_idx` ON `pay_arrangements` (`household_id`,`carer_id`,"valid_from" desc);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`timesheet_id` text NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`paid_at` text NOT NULL,
	`method_note` text,
	`recorded_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`kind` text DEFAULT 'payment' NOT NULL,
	`corrects_payment_id` text,
	`correction_reason` text,
	`idempotency_key` text,
	FOREIGN KEY (`timesheet_id`) REFERENCES `timesheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`corrects_payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_amount_minor_signed_chk" CHECK(((amount_minor <> 0) AND (amount_minor >= -99999999) AND (amount_minor <= 99999999))),
	CONSTRAINT "payments_currency_check" CHECK((currency GLOB '[A-Z][A-Z][A-Z]')),
	CONSTRAINT "payments_kind_chk" CHECK((kind IN ('payment', 'correction'))),
	CONSTRAINT "payments_kind_shape_chk" CHECK((((kind = 'payment') AND (corrects_payment_id IS NULL) AND (correction_reason IS NULL) AND (amount_minor >= 1)) OR ((kind = 'correction') AND (corrects_payment_id IS NOT NULL) AND (correction_reason IS NOT NULL) AND (amount_minor <= -1))))
);
--> statement-breakpoint
CREATE INDEX `payments_corrects_idx` ON `payments` (`corrects_payment_id`) WHERE corrects_payment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `payments_household_paid_at_idx` ON `payments` (`household_id`,`paid_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_key_uidx` ON `payments` (`idempotency_key`) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX `payments_timesheet_idx` ON `payments` (`timesheet_id`);--> statement-breakpoint
CREATE TABLE `pto_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`kind` text NOT NULL,
	`minutes` integer NOT NULL,
	`effective_date` text NOT NULL,
	`time_off_id` text,
	`carer_display_name` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`household_member_id` text,
	`leave_kind` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`time_off_id`) REFERENCES `carer_time_off`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pto_ledger_kind_check" CHECK((kind IN ('accrual', 'usage', 'adjustment'))),
	CONSTRAINT "pto_ledger_leave_kind_check" CHECK(((leave_kind IS NULL) OR (leave_kind IN ('personal', 'sick')))),
	CONSTRAINT "pto_ledger_minutes_check" CHECK((minutes <> 0))
);
--> statement-breakpoint
CREATE INDEX `pto_ledger_household_carer_idx` ON `pto_ledger` (`household_id`,`carer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pto_ledger_one_accrual_per_year_idx` ON `pto_ledger` (`household_id`,`carer_id`,`effective_date`) WHERE kind = 'accrual';--> statement-breakpoint
CREATE UNIQUE INDEX `pto_ledger_one_usage_per_time_off_day_idx` ON `pto_ledger` (`household_id`,`time_off_id`,`effective_date`) WHERE kind = 'usage';--> statement-breakpoint
CREATE TABLE `reimbursement_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`week_start` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`settled_at` text NOT NULL,
	`note` text,
	`recorded_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reimbursement_settlements_amount_minor_check" CHECK(((amount_minor >= 1) AND (amount_minor <= 99999999))),
	CONSTRAINT "reimbursement_settlements_currency_check" CHECK((currency GLOB '[A-Z][A-Z][A-Z]'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_settlements_week_idx` ON `reimbursement_settlements` (`household_id`,`carer_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `terms_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text NOT NULL,
	`proposed_by` text NOT NULL,
	`direction` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`terms` text NOT NULL,
	`note` text,
	`supersedes_id` text,
	`from_invite_id` text,
	`carer_display_name` text NOT NULL,
	`viewed_at` text,
	`responded_at` text,
	`accepted_by` text,
	`accepted_arrangement_id` text,
	`responsibility_confirmed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supersedes_id`) REFERENCES `terms_proposals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`from_invite_id`) REFERENCES `household_invites`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_arrangement_id`) REFERENCES `pay_arrangements`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "terms_proposals_accepted_needs_confirmation" CHECK(((status <> 'accepted') OR responsibility_confirmed)),
	CONSTRAINT "terms_proposals_direction_check" CHECK((direction IN ('carer', 'parent'))),
	CONSTRAINT "terms_proposals_responded_at_present" CHECK(((status = 'proposed') OR (responded_at IS NOT NULL))),
	CONSTRAINT "terms_proposals_status_check" CHECK((status IN ('proposed', 'countered', 'accepted', 'withdrawn', 'declined')))
);
--> statement-breakpoint
CREATE INDEX `terms_proposals_from_invite_idx` ON `terms_proposals` (`from_invite_id`) WHERE from_invite_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `terms_proposals_household_carer_idx` ON `terms_proposals` (`household_id`,`carer_id`,"created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `terms_proposals_open_unique_idx` ON `terms_proposals` (`household_id`,`carer_id`) WHERE status = 'proposed';--> statement-breakpoint
CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`min_supported_version` text,
	`latest_version` text,
	`ios_store_url` text,
	`android_store_url` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`maintenance_message` text,
	`announcements` text DEFAULT '[]' NOT NULL,
	`beta_all_pro` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "app_config_id_check" CHECK((id = 1)),
	CONSTRAINT "app_config_status_check" CHECK((status IN ('ok', 'maintenance', 'killed')))
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`completed_at` text,
	`duration_ms` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`total_processed` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`peak_memory_mb` real,
	`db_query_count` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`error_message` text,
	`error_details` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`idempotency_key` text,
	CONSTRAINT "job_runs_status_check" CHECK((status IN ('running', 'success', 'failed', 'partial')))
);
--> statement-breakpoint
CREATE INDEX `idx_job_runs_name_started` ON `job_runs` (`job_name`,"started_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_idempotency_key_key` ON `job_runs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `schedule_pattern_day_children` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern_day_id` text NOT NULL,
	`child_id` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`pattern_day_id`) REFERENCES `schedule_pattern_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "schedule_pattern_day_children_time_order" CHECK(((start_time IS NULL) OR (end_time IS NULL) OR (end_time > start_time))),
	CONSTRAINT "schedule_pattern_day_children_time_pairing" CHECK(((start_time IS NULL) = (end_time IS NULL)))
);
--> statement-breakpoint
CREATE INDEX `schedule_pattern_day_children_child_idx` ON `schedule_pattern_day_children` (`child_id`);--> statement-breakpoint
CREATE INDEX `schedule_pattern_day_children_day_idx` ON `schedule_pattern_day_children` (`pattern_day_id`);--> statement-breakpoint
CREATE TABLE `schedule_pattern_days` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`pattern_id`) REFERENCES `schedule_patterns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "schedule_pattern_days_time_order" CHECK((end_time > start_time)),
	CONSTRAINT "schedule_pattern_days_weekday_check" CHECK(((weekday >= 0) AND (weekday <= 6)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_pattern_days_pattern_weekday_start_idx` ON `schedule_pattern_days` (`pattern_id`,`weekday`,`start_time`);--> statement-breakpoint
CREATE TABLE `schedule_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`rrule` text NOT NULL,
	`dtstart` text NOT NULL,
	`until` text,
	`exdates` text DEFAULT '[]' NOT NULL,
	`pause_ranges` text DEFAULT '[]' NOT NULL,
	`timezone` text NOT NULL,
	`note` text,
	`created_by` text,
	`sent_at` text,
	`responded_at` text,
	`ical_uid` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`decline_message` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "schedule_patterns_date_order" CHECK(((until IS NULL) OR (until >= dtstart))),
	CONSTRAINT "schedule_patterns_status_check" CHECK((status IN ('draft', 'pending', 'accepted', 'declined', 'withdrawn', 'ended')))
);
--> statement-breakpoint
CREATE INDEX `schedule_patterns_carer_idx` ON `schedule_patterns` (`carer_id`,`status`) WHERE carer_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `schedule_patterns_household_status_idx` ON `schedule_patterns` (`household_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_patterns_one_accepted_idx` ON `schedule_patterns` (`household_id`,`carer_id`) WHERE (status = 'accepted') AND (carer_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_patterns_ical_uid_key` ON `schedule_patterns` (`ical_uid`);--> statement-breakpoint
CREATE TABLE `co_parent_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`requested_by` text,
	`action` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`timeout_at` text NOT NULL,
	`responded_by` text,
	`responded_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responded_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "co_parent_approvals_action_check" CHECK((action IN ('short_notice_change', 'cancel', 'extra_shift', 'other'))),
	CONSTRAINT "co_parent_approvals_status_check" CHECK((status IN ('pending', 'approved', 'declined', 'timed_out', 'withdrawn')))
);
--> statement-breakpoint
CREATE INDEX `co_parent_approvals_household_pending_idx` ON `co_parent_approvals` (`household_id`,"created_at" desc) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `co_parent_approvals_timeout_idx` ON `co_parent_approvals` (`timeout_at`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `handoff_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`local_date` text NOT NULL,
	`author_id` text,
	`phase` text NOT NULL,
	`chips` text DEFAULT '[]' NOT NULL,
	`body` text,
	`moment_saved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "handoff_notes_phase_check" CHECK((phase IN ('morning', 'evening')))
);
--> statement-breakpoint
CREATE INDEX `handoff_notes_household_date_idx` ON `handoff_notes` (`household_id`,`local_date`,`phase`);--> statement-breakpoint
CREATE TABLE `shift_change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`requested_by` text,
	`kind` text NOT NULL,
	`proposed_starts_at` text,
	`proposed_ends_at` text,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`responded_by` text,
	`responded_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`response_message` text,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responded_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shift_change_requests_kind_check" CHECK((kind IN ('time_change', 'cancel', 'counter_offer', 'split', 'handover'))),
	CONSTRAINT "shift_change_requests_status_check" CHECK((status IN ('pending', 'accepted', 'declined', 'withdrawn', 'superseded', 'expired'))),
	CONSTRAINT "shift_change_requests_time_order" CHECK(((proposed_starts_at IS NULL) OR (proposed_ends_at IS NULL) OR (julianday(proposed_ends_at) > julianday(proposed_starts_at))))
);
--> statement-breakpoint
CREATE INDEX `shift_change_requests_pending_idx` ON `shift_change_requests` (`shift_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `shift_change_requests_shift_idx` ON `shift_change_requests` (`shift_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `shift_children` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`child_id` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shift_children_time_order" CHECK(((starts_at IS NULL) OR (ends_at IS NULL) OR (julianday(ends_at) > julianday(starts_at)))),
	CONSTRAINT "shift_children_time_pairing" CHECK(((starts_at IS NULL) = (ends_at IS NULL)))
);
--> statement-breakpoint
CREATE INDEX `shift_children_child_idx` ON `shift_children` (`child_id`);--> statement-breakpoint
CREATE INDEX `shift_children_shift_idx` ON `shift_children` (`shift_id`);--> statement-breakpoint
CREATE TABLE `shift_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`shift_id` text,
	`local_date` text NOT NULL,
	`actor_id` text,
	`event_type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shift_events_household_date_idx` ON `shift_events` (`household_id`,`local_date`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `shift_events_keyed_unique_idx` ON `shift_events` (`household_id`,`local_date`,`event_type`,(payload ->> '$.key')) WHERE (payload ->> '$.key') IS NOT NULL;--> statement-breakpoint
CREATE INDEX `shift_events_shift_idx` ON `shift_events` (`shift_id`,`created_at`) WHERE shift_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `shift_events_uncovered_digest_idx` ON `shift_events` (`created_at`) WHERE event_type = 'uncovered_care';--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`timezone` text NOT NULL,
	`local_date` text NOT NULL,
	`kind` text DEFAULT 'recurring' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source_pattern_id` text,
	`origin` text DEFAULT 'system_generated' NOT NULL,
	`is_short_notice` integer DEFAULT false NOT NULL,
	`note` text,
	`reason` text,
	`cancelled_at` text,
	`cancelled_by` text,
	`cancellation_paid` integer DEFAULT false NOT NULL,
	`cancellation_message` text,
	`ical_uid` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`cover_ask_expires_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_pattern_id`) REFERENCES `schedule_patterns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shifts_kind_check" CHECK((kind IN ('recurring', 'extra', 'cover', 'parent_cover'))),
	CONSTRAINT "shifts_origin_check" CHECK((origin IN ('system_generated', 'parent_proposed', 'nanny_countered', 'parent_cover'))),
	CONSTRAINT "shifts_status_check" CHECK((status IN ('draft', 'pending', 'confirmed', 'declined', 'cancelled', 'completed'))),
	CONSTRAINT "shifts_time_order" CHECK((julianday(ends_at) > julianday(starts_at)))
);
--> statement-breakpoint
CREATE INDEX `shifts_carer_starts_idx` ON `shifts` (`carer_id`,`starts_at`) WHERE carer_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `shifts_cover_ask_expiry_idx` ON `shifts` (`cover_ask_expires_at`) WHERE (status = 'pending') AND (cover_ask_expires_at IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_cover_window_unique` ON `shifts` (`household_id`,quote("carer_id"),`starts_at`,`ends_at`) WHERE (kind = 'cover') AND (status <> 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_extra_window_unique` ON `shifts` (`household_id`,quote("carer_id"),`starts_at`,`ends_at`) WHERE (kind = 'extra') AND (status <> 'cancelled');--> statement-breakpoint
CREATE INDEX `shifts_household_local_date_idx` ON `shifts` (`household_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `shifts_household_starts_idx` ON `shifts` (`household_id`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_parent_cover_window_unique` ON `shifts` (`household_id`,quote("carer_id"),`starts_at`,`ends_at`) WHERE (kind = 'parent_cover') AND (status <> 'cancelled');--> statement-breakpoint
CREATE INDEX `shifts_pattern_idx` ON `shifts` (`source_pattern_id`) WHERE source_pattern_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_recurring_window_unique` ON `shifts` (`household_id`,quote("carer_id"),`starts_at`,`ends_at`) WHERE (kind = 'recurring') AND (status <> 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_ical_uid_key` ON `shifts` (`ical_uid`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`shift_id` text,
	`clock_in_at` text,
	`clock_out_at` text,
	`break_minutes` integer DEFAULT 0 NOT NULL,
	`scheduled_minutes` integer,
	`kind` text DEFAULT 'worked' NOT NULL,
	`note` text,
	`clock_in_location_ok` integer,
	`clock_out_location_ok` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`carer_display_name` text NOT NULL,
	`household_member_id` text,
	`observed_clock_in_at` text,
	`observed_clock_out_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "time_entries_break_minutes_check" CHECK((break_minutes >= 0)),
	CONSTRAINT "time_entries_clock_order" CHECK(((clock_out_at IS NULL) OR (clock_in_at IS NULL) OR (julianday(clock_out_at) > julianday(clock_in_at)))),
	CONSTRAINT "time_entries_kind_check" CHECK((kind IN ('worked', 'cancellation_paid', 'manual_adjustment'))),
	CONSTRAINT "time_entries_status_check" CHECK((status IN ('running', 'submitted', 'approved', 'queried', 'voided')))
);
--> statement-breakpoint
CREATE INDEX `time_entries_carer_date_idx` ON `time_entries` (`carer_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `time_entries_household_date_idx` ON `time_entries` (`household_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_one_cancellation_paid_per_span` ON `time_entries` (`shift_id`,quote("clock_in_at")) WHERE (kind = 'cancellation_paid') AND (shift_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_one_running_per_carer` ON `time_entries` (`carer_id`) WHERE status = 'running';--> statement-breakpoint
CREATE INDEX `time_entries_shift_idx` ON `time_entries` (`shift_id`) WHERE shift_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `timesheets` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`carer_id` text,
	`week_start` text NOT NULL,
	`total_minutes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`query_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`carer_display_name` text NOT NULL,
	`gross_minor` integer,
	`currency` text,
	`earnings` text,
	`earnings_computed_at` text,
	`reopen_reason` text,
	`household_member_id` text,
	`parent_viewed_at` text,
	`hours_changed_after_payment_at` text,
	`previous_approval` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carer_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "timesheets_approved_has_snapshot" CHECK(((status <> 'approved') OR ((gross_minor IS NOT NULL) AND (currency IS NOT NULL) AND (earnings IS NOT NULL) AND (earnings_computed_at IS NOT NULL)))),
	CONSTRAINT "timesheets_currency_check" CHECK((currency GLOB '[A-Z][A-Z][A-Z]')),
	CONSTRAINT "timesheets_gross_minor_check" CHECK((gross_minor >= 0)),
	CONSTRAINT "timesheets_gross_minor_upper" CHECK((gross_minor <= 99999999)),
	CONSTRAINT "timesheets_status_check" CHECK((status IN ('open', 'submitted', 'approved', 'queried')))
);
--> statement-breakpoint
CREATE INDEX `timesheets_carer_id_idx` ON `timesheets` (`carer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `timesheets_household_carer_week_idx` ON `timesheets` (`household_id`,`carer_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email_type` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`dedupe_key` text,
	`metadata` text,
	`sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_log_dedupe_key_uidx` ON `email_log` (`dedupe_key`) WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `notification_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`disabled_types` text DEFAULT '[]' NOT NULL,
	`quiet_hours_enabled` integer DEFAULT false NOT NULL,
	`quiet_hours_start` text,
	`quiet_hours_end` text,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_prefs_quiet_hours_pair_chk" CHECK(((quiet_hours_enabled = false) OR ((quiet_hours_start IS NOT NULL) AND (quiet_hours_end IS NOT NULL))))
);
--> statement-breakpoint
CREATE TABLE `push_reminder_log` (
	`user_id` text NOT NULL,
	`reminder_key` text NOT NULL,
	`sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`confirmed_at` text,
	PRIMARY KEY(`user_id`, `reminder_key`),
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_push_reminder_log_sent_at` ON `push_reminder_log` (`sent_at`);--> statement-breakpoint
CREATE TABLE `user_beta_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`beta_all_pro` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_beta_overrides_user_or_email" CHECK(((user_id IS NOT NULL) OR (email IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_beta_overrides_email_uidx` ON `user_beta_overrides` (lower(email)) WHERE email IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_beta_overrides_user_id_uidx` ON `user_beta_overrides` (`user_id`) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `user_device_info` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`expo_push_token` text,
	`platform` text,
	`notification_permission` text DEFAULT 'denied' NOT NULL,
	`timezone` text,
	`app_version` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_device_info_notification_permission_check" CHECK((notification_permission IN ('granted', 'provisional', 'denied')))
);
--> statement-breakpoint
CREATE INDEX `idx_user_device_info_user_id` ON `user_device_info` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_device_info_user_device_uq` ON `user_device_info` (`user_id`,`device_id`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`city` text,
	`country` text,
	`preferred_locale` text,
	`additional_data` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`timezone` text,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`phone` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_profiles_week_starts_on_check" CHECK(((week_starts_on >= 0) AND (week_starts_on <= 6)))
);
