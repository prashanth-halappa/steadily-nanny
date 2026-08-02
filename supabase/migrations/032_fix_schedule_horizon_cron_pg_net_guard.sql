-- 032 Fix 026: pg_net creation belongs INSIDE the pg_cron guard
--
-- 026_schedule_horizon_cron.sql enables the net extension BEFORE the DO block
-- that checks pg_extension for pg_cron and RETURNs with a notice if it's
-- missing. That header claims graceful degradation "when pg_cron is
-- unavailable (e.g. local shadow DB)" — but on any environment where the net
-- extension itself is unavailable, the migration hard-fails before the guard
-- is ever reached. 007_pg_cron_vault_and_example_cron.sql deliberately left
-- both the extension creation and the schedule out of its own base migration
-- for exactly this reason (see its lines ~15-21 and ~60-66).
--
-- 026 is already applied to the live project and is not edited here — this
-- migration re-registers the schedule-horizon cron job with pg_net created
-- INSIDE the guard, so a fresh bootstrap (new project, local shadow DB, CI)
-- degrades gracefully whether it's pg_cron or pg_net that's missing.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping schedule-horizon cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'schedule-horizon'
  ) THEN
    PERFORM cron.unschedule('schedule-horizon');
  END IF;

  PERFORM cron.schedule(
    'schedule-horizon',
    '0 3 * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/schedule-horizon',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
