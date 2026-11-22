-- 0001_triggers.sql — the Postgres triggers and EXCLUDE constraints that
-- survive the move to D1, hand-written (drizzle-kit cannot express them).
--
-- Every statement is separated by a drizzle `statement-breakpoint` so both
-- drizzle's migrator and `wrangler d1 migrations apply` can run this file.
--
-- Error messages are the contract `src/db/errors.ts` (`mapDbError`) parses:
--   'overlap:<constraint>'                -> kind 'overlap'  (was SQLSTATE 23P01)
--   'CHECK constraint failed: <name>'     -> kind 'check'    (was 23514 / check_violation)
--   'TIMESHEET_HAS_PAYMENTS'              -> unchanged from Postgres (P0001)
--
-- Instants are compared through julianday() rather than as raw text, so the
-- overlap guards hold even if a writer ever drifts from `toISOString()` format.
-- Ranges are half-open [start, end), as Postgres tstzrange defaults to '[)'.
--
-- NOT ported (service layer owns them now — see the Phase 1 report):
--   sync_shifts_local_date, sync_time_entries_local_date (AT TIME ZONE math ->
--   src/db/localDate.ts); every plpgsql RPC; RLS / private.* helpers; pg_cron.
--
-- RETURNING CAVEAT: SQLite's RETURNING does not see changes made by AFTER
-- triggers. The household_member_id stamp and updated_at stamp below happen in
-- AFTER triggers, so an `insert(...).returning()` reports household_member_id
-- as the caller supplied it (NULL if omitted). Set it in the service, or
-- re-read the row, when the response needs it.

-- ===== EXCLUDE USING gist -> overlap triggers =====

-- shifts_carer_window_excl (104): one carer cannot hold two live shifts
-- overlapping in the same household. Live = not cancelled/declined.
CREATE TRIGGER shifts_carer_window_excl_insert
BEFORE INSERT ON shifts
FOR EACH ROW
WHEN NEW.carer_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'declined')
BEGIN
  SELECT RAISE(ABORT, 'overlap:shifts_carer_window_excl')
  WHERE EXISTS (
    SELECT 1 FROM shifts o
    WHERE o.household_id = NEW.household_id AND o.carer_id = NEW.carer_id
      AND o.status NOT IN ('cancelled', 'declined')
      AND julianday(o.starts_at) < julianday(NEW.ends_at)
      AND julianday(NEW.starts_at) < julianday(o.ends_at)
  );
END;
--> statement-breakpoint
CREATE TRIGGER shifts_carer_window_excl_update
BEFORE UPDATE OF household_id, carer_id, starts_at, ends_at, status ON shifts
FOR EACH ROW
WHEN NEW.carer_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'declined')
BEGIN
  SELECT RAISE(ABORT, 'overlap:shifts_carer_window_excl')
  WHERE EXISTS (
    SELECT 1 FROM shifts o
    WHERE o.household_id = NEW.household_id AND o.carer_id = NEW.carer_id
      AND o.status NOT IN ('cancelled', 'declined')
      AND julianday(o.starts_at) < julianday(NEW.ends_at)
      AND julianday(NEW.starts_at) < julianday(o.ends_at)
      AND o.id <> OLD.id
  );
END;
--> statement-breakpoint
-- time_entries_no_clock_overlap_per_carer (055, reshaped by 069): a carer's
-- worked time never overlaps itself across households. Cancellation pay and
-- voided rows are exempt; open (running) entries are not checked.
CREATE TRIGGER time_entries_no_clock_overlap_per_carer_insert
BEFORE INSERT ON time_entries
FOR EACH ROW
WHEN NEW.kind <> 'cancellation_paid' AND NEW.status <> 'voided' AND NEW.clock_in_at IS NOT NULL AND NEW.clock_out_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'overlap:time_entries_no_clock_overlap_per_carer')
  WHERE EXISTS (
    SELECT 1 FROM time_entries o
    WHERE o.carer_id = NEW.carer_id
      AND o.kind <> 'cancellation_paid' AND o.status <> 'voided' AND o.clock_in_at IS NOT NULL AND o.clock_out_at IS NOT NULL
      AND julianday(o.clock_in_at) < julianday(NEW.clock_out_at)
      AND julianday(NEW.clock_in_at) < julianday(o.clock_out_at)
  );
END;
--> statement-breakpoint
CREATE TRIGGER time_entries_no_clock_overlap_per_carer_update
BEFORE UPDATE OF household_id, carer_id, clock_in_at, clock_out_at, kind, status ON time_entries
FOR EACH ROW
WHEN NEW.kind <> 'cancellation_paid' AND NEW.status <> 'voided' AND NEW.clock_in_at IS NOT NULL AND NEW.clock_out_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'overlap:time_entries_no_clock_overlap_per_carer')
  WHERE EXISTS (
    SELECT 1 FROM time_entries o
    WHERE o.carer_id = NEW.carer_id
      AND o.kind <> 'cancellation_paid' AND o.status <> 'voided' AND o.clock_in_at IS NOT NULL AND o.clock_out_at IS NOT NULL
      AND julianday(o.clock_in_at) < julianday(NEW.clock_out_at)
      AND julianday(NEW.clock_in_at) < julianday(o.clock_out_at)
      AND o.id <> OLD.id
  );
END;
--> statement-breakpoint
-- time_entries_no_overlap_per_household (055, reshaped by 069): within one
-- household a carer's entries never overlap — cancellation pay included.
CREATE TRIGGER time_entries_no_overlap_per_household_insert
BEFORE INSERT ON time_entries
FOR EACH ROW
WHEN NEW.status <> 'voided' AND NEW.clock_in_at IS NOT NULL AND NEW.clock_out_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'overlap:time_entries_no_overlap_per_household')
  WHERE EXISTS (
    SELECT 1 FROM time_entries o
    WHERE o.carer_id = NEW.carer_id AND o.household_id = NEW.household_id
      AND o.status <> 'voided' AND o.clock_in_at IS NOT NULL AND o.clock_out_at IS NOT NULL
      AND julianday(o.clock_in_at) < julianday(NEW.clock_out_at)
      AND julianday(NEW.clock_in_at) < julianday(o.clock_out_at)
  );
END;
--> statement-breakpoint
CREATE TRIGGER time_entries_no_overlap_per_household_update
BEFORE UPDATE OF household_id, carer_id, clock_in_at, clock_out_at, status ON time_entries
FOR EACH ROW
WHEN NEW.status <> 'voided' AND NEW.clock_in_at IS NOT NULL AND NEW.clock_out_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'overlap:time_entries_no_overlap_per_household')
  WHERE EXISTS (
    SELECT 1 FROM time_entries o
    WHERE o.carer_id = NEW.carer_id AND o.household_id = NEW.household_id
      AND o.status <> 'voided' AND o.clock_in_at IS NOT NULL AND o.clock_out_at IS NOT NULL
      AND julianday(o.clock_in_at) < julianday(NEW.clock_out_at)
      AND julianday(NEW.clock_in_at) < julianday(o.clock_out_at)
      AND o.id <> OLD.id
  );
END;
--> statement-breakpoint
-- ===== Integrity triggers =====

-- refuse_write_in_draft_household (093, D-36): a draft household holds no
-- shifts, time, timesheets, pay arrangements or commitments until a parent
-- joins. Postgres raised check_violation; the message mimics SQLite's own
-- CHECK failure so mapDbError classifies it as kind 'check'.
CREATE TRIGGER refuse_draft_child_commitments
BEFORE INSERT ON child_commitments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: refuse_draft_child_commitments')
  WHERE EXISTS (SELECT 1 FROM households h WHERE h.id = NEW.household_id AND h.state = 'draft');
END;
--> statement-breakpoint
CREATE TRIGGER refuse_draft_pay_arrangements
BEFORE INSERT ON pay_arrangements
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: refuse_draft_pay_arrangements')
  WHERE EXISTS (SELECT 1 FROM households h WHERE h.id = NEW.household_id AND h.state = 'draft');
END;
--> statement-breakpoint
CREATE TRIGGER refuse_draft_shifts
BEFORE INSERT ON shifts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: refuse_draft_shifts')
  WHERE EXISTS (SELECT 1 FROM households h WHERE h.id = NEW.household_id AND h.state = 'draft');
END;
--> statement-breakpoint
CREATE TRIGGER refuse_draft_time_entries
BEFORE INSERT ON time_entries
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: refuse_draft_time_entries')
  WHERE EXISTS (SELECT 1 FROM households h WHERE h.id = NEW.household_id AND h.state = 'draft');
END;
--> statement-breakpoint
CREATE TRIGGER refuse_draft_timesheets
BEFORE INSERT ON timesheets
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: refuse_draft_timesheets')
  WHERE EXISTS (SELECT 1 FROM households h WHERE h.id = NEW.household_id AND h.state = 'draft');
END;
--> statement-breakpoint
-- sync_child_commitment_household (013): Postgres OVERWROTE household_id with
-- the child's. SQLite BEFORE triggers cannot assign NEW, so the invariant is
-- enforced by rejection instead: the caller must pass the child's household.
CREATE TRIGGER child_commitments_household_matches_child_insert
BEFORE INSERT ON child_commitments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: child_commitments_household_matches_child')
  WHERE NEW.household_id IS NOT (SELECT c.household_id FROM children c WHERE c.id = NEW.child_id);
END;
--> statement-breakpoint
CREATE TRIGGER child_commitments_household_matches_child_update
BEFORE UPDATE OF child_id, household_id ON child_commitments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CHECK constraint failed: child_commitments_household_matches_child')
  WHERE NEW.household_id IS NOT (SELECT c.household_id FROM children c WHERE c.id = NEW.child_id);
END;
--> statement-breakpoint
-- timesheets_refuse_reopen_when_paid (102): an approved timesheet with a
-- payment against it cannot leave 'approved'.
CREATE TRIGGER timesheets_refuse_reopen_when_paid
BEFORE UPDATE OF status ON timesheets
FOR EACH ROW
WHEN OLD.status = 'approved' AND NEW.status <> 'approved'
BEGIN
  SELECT RAISE(ABORT, 'TIMESHEET_HAS_PAYMENTS')
  WHERE EXISTS (SELECT 1 FROM payments p WHERE p.timesheet_id = OLD.id);
END;
--> statement-breakpoint
-- stamp_household_member_id (058): fill household_member_id from the carer's
-- membership row when the writer left it NULL. AFTER INSERT (see the
-- RETURNING caveat in this file's header).
CREATE TRIGGER expenses_stamp_household_member_id
AFTER INSERT ON expenses
FOR EACH ROW
WHEN NEW.household_member_id IS NULL AND NEW.carer_id IS NOT NULL
BEGIN
  UPDATE expenses
  SET household_member_id = (
    SELECT hm.id FROM household_members hm
    WHERE hm.household_id = NEW.household_id AND hm.user_id = NEW.carer_id
  )
  WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER pay_arrangements_stamp_household_member_id
AFTER INSERT ON pay_arrangements
FOR EACH ROW
WHEN NEW.household_member_id IS NULL AND NEW.carer_id IS NOT NULL
BEGIN
  UPDATE pay_arrangements
  SET household_member_id = (
    SELECT hm.id FROM household_members hm
    WHERE hm.household_id = NEW.household_id AND hm.user_id = NEW.carer_id
  )
  WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER pto_ledger_stamp_household_member_id
AFTER INSERT ON pto_ledger
FOR EACH ROW
WHEN NEW.household_member_id IS NULL AND NEW.carer_id IS NOT NULL
BEGIN
  UPDATE pto_ledger
  SET household_member_id = (
    SELECT hm.id FROM household_members hm
    WHERE hm.household_id = NEW.household_id AND hm.user_id = NEW.carer_id
  )
  WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER time_entries_stamp_household_member_id
AFTER INSERT ON time_entries
FOR EACH ROW
WHEN NEW.household_member_id IS NULL AND NEW.carer_id IS NOT NULL
BEGIN
  UPDATE time_entries
  SET household_member_id = (
    SELECT hm.id FROM household_members hm
    WHERE hm.household_id = NEW.household_id AND hm.user_id = NEW.carer_id
  )
  WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER timesheets_stamp_household_member_id
AFTER INSERT ON timesheets
FOR EACH ROW
WHEN NEW.household_member_id IS NULL AND NEW.carer_id IS NOT NULL
BEGIN
  UPDATE timesheets
  SET household_member_id = (
    SELECT hm.id FROM household_members hm
    WHERE hm.household_id = NEW.household_id AND hm.user_id = NEW.carer_id
  )
  WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
-- set_updated_at (001 et al.): stamp updated_at on every UPDATE. The WHEN
-- guard keeps an explicit caller-supplied updated_at and stops the trigger's
-- own UPDATE from re-firing it even if recursive_triggers is ever enabled.
-- app_config never had this trigger in Postgres and still does not.
CREATE TRIGGER set_calendar_accounts_updated_at
AFTER UPDATE ON calendar_accounts
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE calendar_accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_calendar_event_links_updated_at
AFTER UPDATE ON calendar_event_links
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE calendar_event_links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_carer_availability_updated_at
AFTER UPDATE ON carer_availability
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE carer_availability SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_carer_time_off_updated_at
AFTER UPDATE ON carer_time_off
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE carer_time_off SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_child_commitments_updated_at
AFTER UPDATE ON child_commitments
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE child_commitments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_children_updated_at
AFTER UPDATE ON children
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE children SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_co_parent_approvals_updated_at
AFTER UPDATE ON co_parent_approvals
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE co_parent_approvals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_expenses_updated_at
AFTER UPDATE ON expenses
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE expenses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_external_busy_blocks_updated_at
AFTER UPDATE ON external_busy_blocks
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE external_busy_blocks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_handoff_notes_updated_at
AFTER UPDATE ON handoff_notes
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE handoff_notes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_household_closures_updated_at
AFTER UPDATE ON household_closures
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE household_closures SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_household_custom_holidays_updated_at
AFTER UPDATE ON household_custom_holidays
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE household_custom_holidays SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_household_holidays_updated_at
AFTER UPDATE ON household_holidays
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE household_holidays SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_household_invites_updated_at
AFTER UPDATE ON household_invites
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE household_invites SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_household_members_updated_at
AFTER UPDATE ON household_members
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE household_members SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_households_updated_at
AFTER UPDATE ON households
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE households SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_notification_prefs_updated_at
AFTER UPDATE ON notification_prefs
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE notification_prefs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_schedule_pattern_days_updated_at
AFTER UPDATE ON schedule_pattern_days
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE schedule_pattern_days SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_schedule_patterns_updated_at
AFTER UPDATE ON schedule_patterns
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE schedule_patterns SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_shift_change_requests_updated_at
AFTER UPDATE ON shift_change_requests
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE shift_change_requests SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_shifts_updated_at
AFTER UPDATE ON shifts
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE shifts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_terms_proposals_updated_at
AFTER UPDATE ON terms_proposals
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE terms_proposals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_time_entries_updated_at
AFTER UPDATE ON time_entries
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE time_entries SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_user_device_info_updated_at
AFTER UPDATE ON user_device_info
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE user_device_info SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER set_user_profiles_updated_at
AFTER UPDATE ON user_profiles
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE user_profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
-- set_timesheets_updated_at (100): like set_updated_at, except an update that
-- changes ONLY parent_viewed_at (a read receipt) is not a new row version.
-- Keep this column list in step with the timesheets table.
CREATE TRIGGER set_timesheets_updated_at
AFTER UPDATE ON timesheets
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
  AND NOT (NEW.parent_viewed_at IS NOT OLD.parent_viewed_at AND NEW.id IS OLD.id AND NEW.household_id IS OLD.household_id AND NEW.carer_id IS OLD.carer_id AND NEW.week_start IS OLD.week_start AND NEW.total_minutes IS OLD.total_minutes AND NEW.status IS OLD.status AND NEW.approved_by IS OLD.approved_by AND NEW.approved_at IS OLD.approved_at AND NEW.query_note IS OLD.query_note AND NEW.created_at IS OLD.created_at AND NEW.carer_display_name IS OLD.carer_display_name AND NEW.gross_minor IS OLD.gross_minor AND NEW.currency IS OLD.currency AND NEW.earnings IS OLD.earnings AND NEW.earnings_computed_at IS OLD.earnings_computed_at AND NEW.reopen_reason IS OLD.reopen_reason AND NEW.household_member_id IS OLD.household_member_id AND NEW.hours_changed_after_payment_at IS OLD.hours_changed_after_payment_at AND NEW.previous_approval IS OLD.previous_approval)
BEGIN
  UPDATE timesheets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
