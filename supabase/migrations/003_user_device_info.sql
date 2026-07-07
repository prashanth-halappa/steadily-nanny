-- 003 User device info (push tokens, platform, timezone)
--
-- FK-ORDERING CONTRACT (do not "fix" this to point at auth.users):
--   user_id REFERENCES public.user_profiles(user_id), NOT auth.users(id).
--   A device row can only be registered AFTER the profile row exists. If this FK
--   targeted auth.users directly, device registration attempted before the profile
--   was created would still FK-fail against the profile-creation flow the app relies
--   on. Registering the device in the same success path that creates the profile
--   keeps the two in lockstep. Order of migrations (002 before 003) enforces the
--   parent table exists first.
--
-- RLS: owner-only via auth.uid() = user_id.

create table if not exists public.user_device_info (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.user_profiles(user_id) on delete cascade,
  device_id               text,
  expo_push_token         text,
  platform                text,
  notification_permission text not null default 'denied'
                            check (notification_permission in ('granted', 'provisional', 'denied')),
  timezone                text,
  app_version             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint user_device_info_user_device_uq unique (user_id, device_id)
);

create index if not exists idx_user_device_info_user_id on public.user_device_info (user_id);

alter table public.user_device_info enable row level security;

drop policy if exists "Users can view own devices" on public.user_device_info;
create policy "Users can view own devices" on public.user_device_info
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own devices" on public.user_device_info;
create policy "Users can insert own devices" on public.user_device_info
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own devices" on public.user_device_info;
create policy "Users can update own devices" on public.user_device_info
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own devices" on public.user_device_info;
create policy "Users can delete own devices" on public.user_device_info
  for delete using (auth.uid() = user_id);

drop trigger if exists set_user_device_info_updated_at on public.user_device_info;
create trigger set_user_device_info_updated_at
  before update on public.user_device_info
  for each row execute function public.set_updated_at();
