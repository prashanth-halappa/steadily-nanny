-- 047 Push reminder idempotency ledger
--
-- The reminders-hourly cron job (048) fans out time-based push reminders — a
-- shift starting tomorrow, a timesheet submitted 3+ days ago and still
-- unapproved, a co-parent approval about to time out. Because the job runs
-- EVERY HOUR (see 048's header for why) and any run can be retried, the same
-- condition would otherwise fire the same push to the same person on every
-- subsequent run until the condition clears. This table is the ledger that
-- makes a reminder send-once: the job INSERTs a row BEFORE sending and treats
-- a unique-violation on the row as "already sent, skip" rather than a real
-- error.
--
-- The API writes this table under the service role, which bypasses RLS.
-- Users never write it directly.

create table if not exists public.push_reminder_log (
  user_id      uuid not null references public.user_profiles(user_id) on delete cascade,
  -- Opaque caller-built key, e.g. 'shift_reminder:<shiftId>' or
  -- 'timesheet_awaiting_approval:<timesheetId>:<yyyy-mm-dd>'. The (user_id,
  -- reminder_key) primary key below is the whole mechanism: a second insert
  -- attempt for the same pair fails, and that failure IS the "already sent"
  -- signal — no separate lookup query needed.
  reminder_key text not null,
  sent_at      timestamptz not null default now(),
  primary key (user_id, reminder_key)
);

create index if not exists idx_push_reminder_log_sent_at on public.push_reminder_log (sent_at);

alter table public.push_reminder_log enable row level security;

drop policy if exists "Users can view own reminder log" on public.push_reminder_log;
create policy "Users can view own reminder log" on public.push_reminder_log
  for select using ((select auth.uid()) = user_id);

-- No insert/update/delete policies, deliberately. Writes are service-role
-- only (the reminders job runs under the service key, which bypasses RLS
-- entirely); the absence of a policy is the deny for the `authenticated` and
-- `anon` roles. Do not "fix" this by adding a user-facing write policy — a
-- user has no legitimate reason to write their own reminder history, and
-- doing so would let them erase rows to re-trigger a reminder the job has
-- already deduped.

-- No updated_at / set_updated_at trigger: rows are write-once and never
-- mutated after insert.
