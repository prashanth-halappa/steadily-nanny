-- 004 Job runs (background job observability)
-- One row per background/cron job execution. Written exclusively by the backend
-- (service role); never touched by app clients.
--
-- SECURITY: backend-only. RLS is enabled with no client policies, and table
-- privileges are revoked from anon/authenticated so only the service role
-- (which bypasses RLS) can read or write.

create table if not exists public.job_runs (
  id              uuid primary key default gen_random_uuid(),
  job_name        text not null,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  duration_ms     integer,
  status          text not null default 'running'
                    check (status in ('running', 'success', 'failed', 'partial')),
  total_processed integer not null default 0,
  success_count   integer not null default 0,
  error_count     integer not null default 0,
  skipped_count   integer not null default 0,
  peak_memory_mb  numeric,
  db_query_count  integer not null default 0,
  summary         jsonb,
  error_message   text,
  error_details   jsonb,
  created_at      timestamptz not null default now(),
  idempotency_key text unique
);

create index if not exists idx_job_runs_name_started
  on public.job_runs (job_name, started_at desc);

alter table public.job_runs enable row level security;

-- Backend-only: strip client-role table privileges (service role bypasses RLS).
revoke all on public.job_runs from anon, authenticated;
