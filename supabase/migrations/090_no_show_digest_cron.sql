-- 090 no-show morning catch-up digest pg_cron job
--
-- APPLIED TO PROD 2026-08-12 (Phase 6) via Supabase MCP `apply_migration`,
-- in order with the rest of the 074→096 chain — never `supabase db push`
-- (version-scheme mismatch). Live tip after apply:
-- `redeem_draft_invite_week_starts_on`. Do not re-apply.

-- Schedules an hourly HTTP POST to POST /api/jobs/no-show-digest, which
-- tells a household's parents (once, in the morning) about yesterday's
-- confirmed shifts that had no clock-in and whose immediate no-show alert
-- never actually delivered (`noShowDigestJob.ts` — A1/D-26, matrix row N11).
--
-- WHY HOURLY, NOT DAILY
-- Same reasoning as 073's uncovered-care digest: the send window,
-- `[07:00, 10:00)`, is household-LOCAL — `noShowDigestJob.ts` gates on each
-- household's own timezone via `getLocalClock`. A single fixed UTC cron tick
-- would land inside some household's night; running hourly lets the job
-- itself pick the tick that lands in each household's own morning window.
--
-- WHY THE REPEATED TICKS ARE SAFE
-- `push_reminder_log`'s claim key is `no_show_digest:<householdId>:
-- <householdLocalDate>` — date-segmented, one row per household per local
-- day. The key string is invariant across every hour inside the send
-- window, so the first successful send's claim collides with every later
-- tick that same local day (`claimAndSend` → skipped, not re-sent).
--
-- Cron expression '50 * * * *' runs at minute 50 of every hour, in the
-- PostgreSQL server's local timezone. Chosen to collide with nothing else on
-- the schedule (026/032's horizon 0 3 * * *, 048's reminders :05, 054's
-- reconcile :25, 057's integrity checks 04:10, 066's no-show sweep */10,
-- 073's uncovered-digest :35).
--
-- SHAPE COPIED FROM 073/066, including 032's correction: `create extension
-- if not exists pg_net` goes INSIDE the pg_cron-exists check, never before
-- it. Put it before and a database without pg_net hard-fails the migration
-- before the graceful-degradation guard is ever reached.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql): the
-- vault secrets cron_api_base_url and cron_job_api_key must exist.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping no-show-digest cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'no-show-digest'
  ) THEN
    PERFORM cron.unschedule('no-show-digest');
  END IF;

  PERFORM cron.schedule(
    'no-show-digest',
    '50 * * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/no-show-digest',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
