-- 005 Remote app config + per-user beta overrides
--
-- app_config: a single-row table (id is pinned to 1 via a CHECK) holding version
-- gates, a kill switch/maintenance status, broadcast announcements, and a global
-- beta_all_pro toggle. Updated via the dashboard or an admin backend.
--
-- user_beta_overrides: per-identity grant/deny of effective-Pro that takes
-- precedence over the global app_config.beta_all_pro flag. May be keyed by
-- user_id OR email (an email can be added before the account exists; it binds on
-- first sign-in because the read path matches email OR user_id). Resolution logic
-- lives in app code; this is just a lookup table.
--
-- SECURITY: both tables are backend/admin-only. RLS is enabled with no client
-- policies and client-role table privileges are revoked, so only the service role
-- can read/write.

create table if not exists public.app_config (
  id                  integer primary key default 1 check (id = 1),
  min_supported_version text,
  latest_version      text,
  ios_store_url       text,
  android_store_url   text,
  status              text not null default 'ok'
                        check (status in ('ok', 'maintenance', 'killed')),
  maintenance_message jsonb,
  announcements       jsonb not null default '[]'::jsonb,
  beta_all_pro        boolean not null default false,
  updated_at          timestamptz not null default now()
);

-- The API reads app_config.beta_all_pro FAIL-CLOSED: if the row/flag is missing
-- or unreadable, users are treated as NOT Pro (default false). Flip to true only
-- to grant a global beta.
comment on column public.app_config.beta_all_pro is
  'When true, all users are treated as Pro (global beta). Read fail-closed by the API: absence/error means NOT Pro.';

-- Seed the single config row with placeholder store URLs (replace after store submission).
insert into public.app_config (id, ios_store_url, android_store_url)
values (
  1,
  'https://apps.apple.com/app/idPLACEHOLDER',
  'https://play.google.com/store/apps/details?id=com.yourco.yourapp'
)
on conflict (id) do nothing;

alter table public.app_config enable row level security;
-- Backend/admin-only: no client policies; strip client-role table privileges.
revoke all on public.app_config from anon, authenticated;

create table if not exists public.user_beta_overrides (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade, -- optional
  email        text,                                             -- optional (works pre-signup)
  beta_all_pro boolean not null,                                 -- true = grant Pro, false = deny
  note         text,
  created_at   timestamptz not null default now(),
  constraint user_beta_overrides_user_or_email check (user_id is not null or email is not null)
);

-- One override per identity in each dimension.
create unique index if not exists user_beta_overrides_user_id_uidx
  on public.user_beta_overrides (user_id) where user_id is not null;
create unique index if not exists user_beta_overrides_email_uidx
  on public.user_beta_overrides (lower(email)) where email is not null;

alter table public.user_beta_overrides enable row level security;
-- Backend/admin-only: no client policies; strip client-role table privileges.
revoke all on public.user_beta_overrides from anon, authenticated;

comment on table public.user_beta_overrides is
  'Per-user override of app_config.beta_all_pro. Match by user_id OR email; an explicit row wins over the global flag. Add an email even before the user signs up.';
