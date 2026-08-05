-- 048 reminders-hourly pg_cron job
--
-- Schedules an hourly HTTP POST to POST /api/jobs/reminders, which fans out
-- time-based push reminders (a shift starting tomorrow, a timesheet
-- submitted 3+ days ago and still unapproved, a co-parent approval about to
-- time out).
--
-- WHY HOURLY, NOT ONE SHOT PER RULE
-- Reminders must land at a sensible LOCAL hour for each recipient, and
-- recipients span timezones. Rather than a per-household/per-timezone
-- scheduler, this job runs every hour and the API filters to recipients
-- whose local time currently matches the rule's send hour.
-- 047_push_reminder_log.sql's idempotency ledger is what makes that safe:
-- an hourly poll that overlaps a recipient's send hour more than once (retry,
-- clock skew, etc.) is a no-op the second time because the insert into
-- push_reminder_log conflicts.
--
-- Cron expression '5 * * * *' runs at five past every hour, in the
-- PostgreSQL server's local timezone (pg_cron uses the database host clock —
-- not household IANA zones; this is why the filtering-by-local-hour above
-- happens in the API, not here).
--
-- Modeled on 026_schedule_horizon_cron.sql as corrected by
-- 032_fix_schedule_horizon_cron_pg_net_guard.sql: the pg_net guard fix is
-- included from the start (create extension INSIDE the pg_cron-exists check,
-- not before it), so a fresh bootstrap (new project, local shadow DB, CI)
-- degrades gracefully whether it's pg_cron or pg_net that's missing.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql):
--   Vault secrets cron_api_base_url and cron_job_api_key must exist.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping reminders-hourly cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'reminders-hourly'
  ) THEN
    PERFORM cron.unschedule('reminders-hourly');
  END IF;

  PERFORM cron.schedule(
    'reminders-hourly',
    '5 * * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/reminders',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
