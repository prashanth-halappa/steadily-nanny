-- 105 job-health function + cron (J1-b, closing S2)
--
-- WHY THIS EXISTS
-- S2: every registered job is fired by `net.http_post`, which is
-- asynchronous. `cron.job_run_details.status = 'succeeded'` (what
-- `POST-SHIP-WATCH.md` used to tell you to trust) proves only that pg_net
-- ACCEPTED the enqueue — never that the HTTP call it made actually reached
-- the API, or that the job it ran completed cleanly. `net._http_response`
-- (where the real outcome lands) has zero readers anywhere in this repo, and
-- pg_net's own retention window is short — a rotated Vault key, a 500, and a
-- dead API are all indistinguishable from success to anyone just watching
-- `cron.job_run_details`.
--
-- `jobHealthJob` (apps/api/src/jobs/jobHealthJob.ts) is the automated reader
-- this migration schedules. It checks TWO independent signals:
--  (i)  `job_runs` — every job's own recorded outcome, via
--       `JobRunRepository.latestPerJob` / `.countByStatusSince`.
--  (ii) `net._http_response` — via the function below, for the failure class
--       (i) structurally cannot see: a call that never reached the API at
--       all (401 from a rotated key, network failure, dead deploy) never
--       creates a `job_runs` row in the first place.
--
-- WHY A FUNCTION HERE AND NOT A TS QUERY AGAINST net._http_response DIRECTLY
-- `net` is a pg_net-owned schema, not `public` — PostgREST (and therefore the
-- service-role Supabase client the API uses) can only reach it through a
-- function IN `public`. SECURITY DEFINER, not INVOKER like 056's
-- `run_integrity_checks`: 056's comment explains invoker is correct THERE
-- because service_role already bypasses RLS on tables it owns — but
-- `net._http_response` is not an RLS-protected table this project owns, it
-- is pg_net's own table with its own grants, and is not reachable by a
-- service-role caller running as itself (invoker rights). Definer rights
-- (running as the function's OWNER) are what let a service-role caller reach
-- across that boundary at all. Revoked from
-- PUBLIC/anon/authenticated, service_role EXECUTE only — same lockdown shape
-- as 056, just for the opposite security direction.
--
-- No private.* function is ever called via `.rpc()` anywhere in this
-- codebase (checked: every existing `supabaseService.rpc(...)` call site
-- targets a `public.*` function) — so this one is public too, consistent
-- with the only pattern the TS side actually knows how to call.

create or replace function public.job_http_failures(p_since interval)
returns table (status_code integer, count bigint)
language sql
stable
security definer
set search_path = public, net
as $$
  select r.status_code, count(*) as count
  from net._http_response r
  where r.created > now() - p_since
    and (r.status_code is null or r.status_code >= 300)
  group by r.status_code
$$;

revoke all on function public.job_http_failures(interval) from public;
revoke all on function public.job_http_failures(interval) from anon;
revoke all on function public.job_http_failures(interval) from authenticated;
grant execute on function public.job_http_failures(interval) to service_role;

comment on function public.job_http_failures is
  'SECURITY DEFINER read of net._http_response (pg_net-owned, not public), grouped by non-2xx/missing status_code within p_since. service_role only; called by jobHealthJob (POST /api/jobs/job-health, scheduled daily by 105). Read-only, never repairs anything — same discipline as run_integrity_checks (056).';

-- ---------------------------------------------------------------------------
-- job-health cron — daily
-- ---------------------------------------------------------------------------
-- WHY DAILY, AND WHY 06:15. Every signal this job reads is itself a rolling
-- window (24h for failed/partial runs and pg_net failures; each job's own
-- cadence-derived budget for staleness), so checking more often than once a
-- day mostly re-reports the same gap. 06:15 sits well clear of every other
-- job on the schedule (026/032 horizon 03:00, 048 reminders :05, 054
-- reconcile :25, 057 integrity 04:10, 066 no-show */10, 073 uncovered-digest
-- :35, 088 cover-ask-expiry 3-58/5, 089 shift-completion 03:40, 090
-- no-show-digest :50) and late enough that every job with a "daily, early
-- morning" cadence (horizon, shift-completion, integrity-checks) has already
-- had its chance to run and be checked, not just enqueued.
--
-- SHAPE COPIED FROM 057/090/etc, including 032's correction: `create
-- extension if not exists pg_net` goes INSIDE the pg_cron-exists check, never
-- before it.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql): the
-- vault secrets cron_api_base_url and cron_job_api_key must exist.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping job-health cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'job-health'
  ) THEN
    PERFORM cron.unschedule('job-health');
  END IF;

  PERFORM cron.schedule(
    'job-health',
    '15 6 * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/job-health',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
