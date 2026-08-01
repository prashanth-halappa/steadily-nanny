-- 006 Email log
--
-- Tables:
--   email_log  - outbound email audit trail with dedupe.
--
-- SECURITY POSTURE:
--   * RLS is enabled.
--   * Backend-only table — no client policies, and client-role table
--     privileges are revoked (PUBLIC named explicitly, not just anon/authenticated
--     — see GOLDEN-FIX #16: newly created objects are PUBLIC-executable/readable
--     by default, and anon/authenticated inherit from PUBLIC unless revoked).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.email_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  email_type text not null,
  recipient  text not null,
  status     text not null default 'sent',
  dedupe_key text,
  metadata   jsonb,
  sent_at    timestamptz not null default now()
);

-- Dedupe outbound email: at most one row per non-null dedupe_key.
create unique index if not exists email_log_dedupe_key_uidx
  on public.email_log (dedupe_key) where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.email_log enable row level security;
-- Backend-only: no client policies; strip client-role privileges. PUBLIC named
-- explicitly (GOLDEN-FIX #16) — anon/authenticated inherit from PUBLIC unless
-- revoked from it too.
revoke all on public.email_log from PUBLIC, anon, authenticated;
