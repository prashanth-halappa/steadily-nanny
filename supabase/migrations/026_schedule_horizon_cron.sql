-- 026 schedule-horizon pg_cron job
--
-- Schedules a daily HTTP POST to POST /api/jobs/schedule-horizon so accepted
-- schedule patterns keep rolling their materialisation horizon forward.
--
-- Cron expression '0 3 * * *' runs at 03:00 in the PostgreSQL server's local
-- timezone (pg_cron uses the database host clock — not household IANA zones).
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql):
--   Vault secrets cron_api_base_url and cron_job_api_key must exist.
--
-- Degrades gracefully when pg_cron is unavailable (e.g. local shadow DB): the
-- DO block checks pg_extension before scheduling.

create extension if not exists pg_net;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping schedule-horizon cron job';
    RETURN;
  END IF;

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
