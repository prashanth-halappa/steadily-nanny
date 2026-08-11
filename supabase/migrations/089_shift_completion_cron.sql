-- 089 nightly shift-completion pg_cron job (S2 · D-24)
--
-- REPO FILE ONLY — never applied to any environment as part of Phase 3 slice
-- 3-T3 (see TRUST-AND-TERMS-PLAYBOOK.md §3). Phase 6 applies the rehearsed
-- migration chain via the Supabase MCP, in order, never `supabase db push`.
--
-- ---------------------------------------------------------------------------
-- WHY THIS JOB EXISTS
-- ---------------------------------------------------------------------------
-- `shifts.status` has had `completed` in its CHECK constraint since 015, in
-- the immutability set since the repository was written, and in the covering
-- statuses since uncovered-care shipped — and NOTHING HAS EVER WRITTEN IT.
-- Every shift that was actually worked has sat at `confirmed` forever, which
-- means the schedule never closes: "what we agreed" and "what happened" stay
-- the same row, and scheduled-versus-worked reconciliation has nothing to
-- reconcile against. D-24 calls this the quiet accomplice.
--
-- `runShiftCompletionJob` flips past `confirmed` shifts to `completed` in one
-- batched UPDATE per run (never a per-row loop — GOLDEN-FIXES #28: a remote
-- database charges per round trip, and a per-row sweep over a night's shifts
-- is the same mistake that made accepting a usual week take 26 seconds).
--
-- IMMUTABILITY IS RESPECTED BY CONSTRUCTION, not by a check the job performs.
-- `IMMUTABLE_STATUSES` is {completed, cancelled}; the update's WHERE clause is
-- `status = 'confirmed'`, so no immutable row is ever in scope. Shifts with
-- time entries behind them are deliberately IN scope — a worked shift is
-- precisely the thing that should end up `completed`. (`assertMutable` also
-- refuses rows with time entries, which is why the job must not route through
-- `ShiftRepository.update`: that guard is about editing a shift's terms, not
-- about closing it.)
--
-- NO PUSH, ever (spec §1.6). A buzz saying "your shift finished" tells nobody
-- anything they were not present for. The status surfaces on the day rows and
-- in the reconciliation this enables — that is the whole point of it.
--
-- ---------------------------------------------------------------------------
-- WHY NIGHTLY AND NOT HOURLY
-- ---------------------------------------------------------------------------
-- Nothing is waiting on this. The only consumers are reconciliation surfaces
-- and the immutability guard, and a shift that finished at 17:00 being marked
-- `completed` at 03:40 instead of 18:00 changes no decision anyone makes. The
-- job uses a grace period past `ends_at` rather than a local-midnight gate, so
-- a single fixed UTC tick is correct for every timezone — unlike the digests
-- (073/090), which have household-local send windows and must run hourly.
--
-- Cron expression '40 3 * * *' — 03:40 in the PostgreSQL server's local
-- timezone, after 026/032's horizon roll at 03:00 (a shift cancelled by the
-- horizon roll should not then be completed by this job in the same minute)
-- and clear of 057's integrity checks at 04:10.
--
-- SHAPE COPIED FROM 090/073/066, including 032's correction: `create
-- extension if not exists pg_net` goes INSIDE the pg_cron-exists check, never
-- before it. Put it before and a database without pg_net hard-fails the
-- migration before the graceful-degradation guard is ever reached.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql): the
-- vault secrets cron_api_base_url and cron_job_api_key must exist.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping shift-completion cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'shift-completion'
  ) THEN
    PERFORM cron.unschedule('shift-completion');
  END IF;

  PERFORM cron.schedule(
    'shift-completion',
    '40 3 * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/shift-completion',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
