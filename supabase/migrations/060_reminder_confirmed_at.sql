-- 060 Two-phase push reminder ledger — confirm the claim after the send
--
-- THE CRASH WINDOW THIS CLOSES
-- `reminderJob.claimAndSend` INSERTs a `push_reminder_log` row BEFORE sending,
-- because the job runs hourly and runs can overlap: "send, then claim" would
-- let two runs both pass the not-yet-claimed check and both deliver. The cost
-- of claiming first is a window — if the process dies between the claim COMMIT
-- and the send returning, the claim stands for a reminder that was never
-- delivered, and because the claim is the dedupe key, that reminder is
-- suppressed FOREVER. The job already handles every failure it can observe (a
-- zero-device send and a thrown send both release the claim); a hard kill is
-- the one case it cannot, and 047's header says so explicitly: "unrecoverable
-- without a two-phase (reserve/confirm) ledger, which would need a schema
-- change this job doesn't have". This is that schema change.
--
-- NULL IS THE SIGNAL
-- A row with `confirmed_at is null` means "claimed, not yet known to have been
-- delivered". The job confirms right after a send that reached at least one
-- device, and sweeps unconfirmed claims older than two hours at the start of
-- every run — long enough that a claim from the currently-running pass is
-- never swept out from under itself (a run is minutes, not hours), short
-- enough that a crashed evening's reminders come back on the next run rather
-- than a day later. Deliberately no default and no NOT NULL: a default of
-- now() would confirm at insert and make the sweep a no-op.
--
-- WHY THE BACKFILL IS NOT OPTIONAL
-- Every existing row was written by the claim-then-release path, so a row that
-- survived means a send that landed. Leaving them NULL would make the first
-- sweep delete the entire dedupe ledger and re-send every reminder in it. The
-- backfill sets `confirmed_at = sent_at` — their real (approximate) send time,
-- not now(), so the column means the same thing for old and new rows.
--
-- No index. The sweep is a small delete over a table bounded by
-- (recipients x active reminders) and the existing `sent_at` index already
-- narrows it; add a partial index on `(sent_at) where confirmed_at is null`
-- if the ledger ever grows enough for the sweep to show up in the logs.

alter table public.push_reminder_log
  add column if not exists confirmed_at timestamptz;

comment on column public.push_reminder_log.confirmed_at is
  'Set once a send for this claim reached at least one device. NULL means the claim is still a reservation; unconfirmed reservations older than the sweep horizon are garbage from a crashed run and are deleted so the reminder can be retried.';

-- Backfill: pre-060 rows are all confirmed deliveries by construction.
update public.push_reminder_log
   set confirmed_at = sent_at
 where confirmed_at is null;
