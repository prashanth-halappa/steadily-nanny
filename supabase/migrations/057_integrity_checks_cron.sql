-- 057 integrity-checks pg_cron job
--
-- Schedules a daily HTTP POST to POST /api/jobs/integrity-checks, which calls
-- 056's `run_integrity_checks()` and logs one error per violation class.
--
-- WHY THIS MIGRATION EXISTS AT ALL
-- 054's header says it: a job reachable only by a manual POST is, in
-- production, a job that never runs. `cancellationPayReconcileJob` sat in that
-- state and the consequence was carers who were simply never paid. 056 is
-- worse in one respect — nobody is ever going to POST an integrity sweep by
-- hand, because its whole value is telling you about a problem you do not know
-- you have. Unscheduled, it is documentation.
--
-- WHY DAILY, AND WHY 04:10
-- Every condition 056 looks for is durable: a mismatched total, an unsettled
-- cancellation and an orphaned week all persist until someone acts on them, so
-- checking more often only re-reports the same rows. Daily bounds the
-- discovery delay at 24 hours on states that have usually already been wrong
-- for longer, at the cost of one full-table read a night. The sweep is
-- read-only and its heaviest branch is a self-join over `time_entries`, so it
-- belongs in the quiet hours: 03:00 is 026/032's schedule-horizon, :05 is
-- 048's reminders-hourly, :25 is 054's reconcile. 04:10 is clear of all three
-- and does not contend for the same pg_net workers.
--
-- Cron expression '10 4 * * *' runs at ten past four every morning, in the
-- PostgreSQL server's local timezone.
--
-- SHAPE COPIED FROM 054, including 032's correction: `create extension if not
-- exists pg_net` goes INSIDE the pg_cron-exists check, never before it. Put it
-- before and a database without pg_net hard-fails the migration before the
-- graceful-degradation guard is ever reached — the exact bug 032 exists to
-- undo, and the easiest one to reintroduce by copying the wrong ancestor.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql): the
-- vault secrets cron_api_base_url and cron_job_api_key must exist. The second
-- is the X-Job-Api-Key that `validateJobApiKey` compares against JOB_API_KEY;
-- without it every scheduled call 401s silently forever and this migration
-- buys nothing.
--
-- A FAILING RUN IS THE POINT. `createTrackedJobHandler` now responds 500 when
-- a job reports errorCount > 0, and the integrity job's errorCount is its
-- violation total — so a database with violations produces a failed `job_runs`
-- row and an error-level log that reaches Sentry, every morning, until someone
-- fixes the data.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping integrity-checks cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'integrity-checks'
  ) THEN
    PERFORM cron.unschedule('integrity-checks');
  END IF;

  PERFORM cron.schedule(
    'integrity-checks',
    '10 4 * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/integrity-checks',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
