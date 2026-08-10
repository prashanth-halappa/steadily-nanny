-- 073 uncovered-care evening digest pg_cron job
--
-- Schedules an hourly HTTP POST to POST /api/jobs/uncovered-digest, which
-- tells a household's parents (once an evening) about the uncovered windows
-- that were gated to silence at insert time (`payload.push_gate: 'digest'`
-- — see `uncoveredCareService.ts` and `uncoveredDigestJob.ts`).
--
-- WHY HOURLY, NOT DAILY
-- Every other daily-cadence job in this repo (048's reminders, 054's
-- reconcile) fires at one fixed UTC hour because its rule is timezone-
-- agnostic. This job's send window, `[18:00, 21:00)`, is household-LOCAL —
-- `uncoveredDigestJob.ts` gates on each household's own timezone via
-- `getLocalClock`. A single fixed UTC cron tick would land inside some
-- household's quiet hours or the middle of their night; those households
-- would never get a digest at all, not just a mistimed one, because a push
-- suppressed by quiet hours here is silently dropped rather than deferred to
-- the next tick. Running hourly lets the job itself pick the tick that lands
-- in each household's own evening window.
--
-- WHY THE REPEATED TICKS ARE SAFE
-- `push_reminder_log`'s claim key is `uncovered_digest:<householdId>:
-- <householdLocalDate>` — date-segmented, one row per household per local
-- day. The key string is invariant across every hour inside the send
-- window, so the first successful send's claim collides with every later
-- tick that same local day (`claimAndSend` → skipped, not re-sent). Running
-- this once an hour costs a handful of read-mostly sweeps per household
-- across a three-hour window, not three digests.
--
-- Cron expression '35 * * * *' runs at minute 35 of every hour, in the
-- PostgreSQL server's local timezone. Chosen to collide with nothing else on
-- the schedule (026/032's horizon 0 3 * * *, 048's reminders :05, 054's
-- reconcile :25, 057's integrity checks 04:10, 066's no-show sweep */10).
--
-- SHAPE COPIED FROM 066, including 032's correction: `create extension if
-- not exists pg_net` goes INSIDE the pg_cron-exists check, never before it.
-- Put it before and a database without pg_net hard-fails the migration
-- before the graceful-degradation guard is ever reached — the exact bug 032
-- exists to undo, and the easiest one to reintroduce by copying the wrong
-- ancestor.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql): the
-- vault secrets cron_api_base_url and cron_job_api_key must exist.

-- Candidate query in `DefaultUncoveredDigestCandidateSource.listRecentDigestRows`
-- filters `shift_events` on `event_type = 'uncovered_care'` and `created_at`
-- globally across every household on every run. `shift_events` is the
-- fastest-growing table in the app, so this partial index is not optional —
-- without it the digest's hourly candidate scan degrades into a full table
-- scan as the table grows. Lives outside the guard below: the index is
-- useful with or without pg_cron installed.
create index if not exists shift_events_uncovered_digest_idx
  on public.shift_events (created_at) where event_type = 'uncovered_care';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping uncovered-digest cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'uncovered-digest'
  ) THEN
    PERFORM cron.unschedule('uncovered-digest');
  END IF;

  PERFORM cron.schedule(
    'uncovered-digest',
    '35 * * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/uncovered-digest',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
