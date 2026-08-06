-- 054 cancellation-pay-reconcile pg_cron job
--
-- Schedules an hourly HTTP POST to POST /api/jobs/cancellation-pay-reconcile.
--
-- WHY THIS MATTERS MORE THAN A NORMAL CRON
-- `accept_shift_change_request` commits `shifts.cancellation_paid = true` in
-- its own transaction; the payable `time_entries` row is written after it. If
-- that second write fails the accept fails loudly and DELIBERATELY leaves the
-- flag standing as durable evidence that the carer is owed hours — on the
-- explicit reasoning that a sweeper settles it later. `cancellationPay
-- ReconcileJob` is that sweeper, and until this migration it was reachable
-- only by a manual POST. So in production the flag was never repaired: the
-- carer was simply never paid, indefinitely. The recovery design was sound and
-- unwired; this is the wire.
--
-- THE SECOND CASE, WHICH DECIDES THE FREQUENCY
-- If a carer is clocked in when a paid cancel lands, the remainder computes to
-- empty, the recorder returns nothing, and the accept returns 200 looking
-- perfectly healthy — flag set, no entry. That one self-heals, but only on a
-- run that happens AFTER she clocks out, at which point her session is a
-- completed span and the remainder becomes real. A run at accept time can
-- never settle it. So the schedule is not just "eventually"; it has to come
-- round again on its own.
--
-- WHY HOURLY
-- The job scans shifts flagged paid within a 30-day lookback and re-calls an
-- idempotent recorder, so a run with nothing to do is a cheap no-op and runs
-- are safe to overlap with a concurrent accept. Hourly bounds the two delays
-- that matter — a failed write is repaired within the hour, and the clocked-in
-- case settles within an hour of her clocking out — while costing one HTTP
-- POST an hour against a small candidate set. Daily would be cheaper and would
-- leave a carer visibly unpaid for up to a day on a money path, which is the
-- wrong trade. Nothing here needs sub-hour latency: the shortfall is invisible
-- to both parties until the timesheet is reviewed.
--
-- Cron expression '25 * * * *' runs at twenty-five past every hour, in the
-- PostgreSQL server's local timezone. The offset is deliberate: 048's
-- reminders-hourly runs at :05 and 026/032's schedule-horizon at 03:00, so
-- this lands clear of both rather than contending for the same pg_net workers.
--
-- Modeled on 048_reminders_cron.sql, itself 026_schedule_horizon_cron.sql as
-- corrected by 032_fix_schedule_horizon_cron_pg_net_guard.sql. 032's fix is
-- carried here from the start: `create extension if not exists pg_net` goes
-- INSIDE the pg_cron-exists check, never before it. Put it before and a
-- database without pg_net hard-fails the migration before the graceful
-- degradation guard is ever reached — which is exactly the bug 032 exists to
-- undo, and the easiest one to reintroduce by copying 026 instead of 048.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql):
--   Vault secrets cron_api_base_url and cron_job_api_key must exist. The
--   second is the X-Job-Api-Key that `validateJobApiKey` compares against
--   JOB_API_KEY; without it every scheduled call 401s silently forever and
--   this migration buys nothing.
--
-- DEPLOY ORDER: 047_push_reminder_log.sql and 048_reminders_cron.sql are in
-- the repo but NOT yet applied to production. This migration does not depend
-- on either — it only needs 007's vault helpers — so it can be applied
-- independently, but the numbering implies an ordering that production has not
-- actually followed yet. Apply in file order and 047/048 land first.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping cancellation-pay-reconcile cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cancellation-pay-reconcile'
  ) THEN
    PERFORM cron.unschedule('cancellation-pay-reconcile');
  END IF;

  PERFORM cron.schedule(
    'cancellation-pay-reconcile',
    '25 * * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/cancellation-pay-reconcile',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
