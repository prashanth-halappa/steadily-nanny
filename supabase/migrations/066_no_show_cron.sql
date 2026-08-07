-- 066 no-show-sweep pg_cron job
--
-- Schedules a ten-minutely HTTP POST to POST /api/jobs/no-show-sweep, which
-- alerts a household's parents when nobody has clocked in twenty minutes into
-- a confirmed shift.
--
-- WHY EVERY TEN MINUTES, NOT HOURLY
-- 048's reminders job runs hourly because every rule it carries is measured in
-- days. This one is measured in minutes: the threshold is twenty, and an
-- hourly tick would deliver "nobody has clocked in" anywhere from twenty to
-- eighty minutes after the shift started. A parent who has to decide whether
-- to leave work needs that inside the first half hour or it is a report rather
-- than an alert. Ten minutes bounds the delay at thirty minutes total and
-- costs six read-mostly sweeps an hour over a window that is usually empty.
--
-- WHY THE REPEATED TICKS ARE SAFE
-- 047's push_reminder_log is the same ledger the reminders job uses. The key
-- is 'no_show:<shiftId>' with NO date segment, so the first tick that alerts
-- claims the slot and every later tick inside the job's two-hour window
-- collides with it — one push per parent per shift, ever, regardless of how
-- often this fires. 060's confirmed_at makes that claim two-phase, so a run
-- killed mid-send does not suppress the alert permanently.
--
-- Cron expression '*/10 * * * *' runs at every tenth minute past the hour, in
-- the PostgreSQL server's local timezone. It collides at :00 with nothing
-- (026/032's horizon is 03:00, 048's reminders :05, 054's reconcile :25,
-- 057's integrity checks 04:10) — the sweep is a single indexed range scan
-- over `shifts`, so sharing a minute with any of them would be harmless
-- anyway.
--
-- SHAPE COPIED FROM 057, including 032's correction: `create extension if not
-- exists pg_net` goes INSIDE the pg_cron-exists check, never before it. Put it
-- before and a database without pg_net hard-fails the migration before the
-- graceful-degradation guard is ever reached — the exact bug 032 exists to
-- undo, and the easiest one to reintroduce by copying the wrong ancestor.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql): the
-- vault secrets cron_api_base_url and cron_job_api_key must exist. The second
-- is the X-Job-Api-Key that `validateJobApiKey` compares against JOB_API_KEY;
-- without it every scheduled call 401s silently forever and this migration
-- buys nothing. A job left unscheduled is 054's lesson: reachable only by a
-- manual POST means, in production, never.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping no-show-sweep cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'no-show-sweep'
  ) THEN
    PERFORM cron.unschedule('no-show-sweep');
  END IF;

  PERFORM cron.schedule(
    'no-show-sweep',
    '*/10 * * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/no-show-sweep',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
