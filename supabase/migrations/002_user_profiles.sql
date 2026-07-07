-- 002 User profiles
-- One row per auth user holding app-level profile data. This is the anchor row
-- that later tables (e.g. user_device_info) foreign-key against, so it must be
-- created before them.
--
-- RLS: owner-only. A signed-in user can only read/write their own row. The
-- service role bypasses RLS for backend writes.

create table if not exists public.user_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  name             text,
  city             text,
  country          text,
  preferred_locale text,
  additional_data  jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "Users can view own profile" on public.user_profiles;
create policy "Users can view own profile" on public.user_profiles
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own profile" on public.user_profiles;
create policy "Users can insert own profile" on public.user_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile" on public.user_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own profile" on public.user_profiles;
create policy "Users can delete own profile" on public.user_profiles
  for delete using (auth.uid() = user_id);

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();
