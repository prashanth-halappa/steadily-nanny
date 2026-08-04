-- 038 Notification preferences (per-user opt-outs + quiet hours)
--
-- One row per user. Missing row = all push types enabled and quiet hours off
-- (backward compatible with every existing householdPush call site).
--
-- RLS: owner-only via auth.uid() = user_id. The API service role bypasses RLS
-- for delivery-time reads inside sendToUser.

create table if not exists public.notification_prefs (
  user_id              uuid primary key
                         references public.user_profiles(user_id) on delete cascade,
  -- Opt-out list of push `data.type` strings (see PUSH_NOTIFICATION_TYPES).
  disabled_types       text[] not null default '{}',
  quiet_hours_enabled  boolean not null default false,
  quiet_hours_start    time,
  quiet_hours_end      time,
  -- IANA zone used when evaluating quiet hours locally for this user.
  timezone             text not null default 'UTC',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint notification_prefs_quiet_hours_pair_chk check (
    quiet_hours_enabled = false
    or (quiet_hours_start is not null and quiet_hours_end is not null)
  )
);

alter table public.notification_prefs enable row level security;

drop policy if exists "Users can view own notification prefs" on public.notification_prefs;
create policy "Users can view own notification prefs" on public.notification_prefs
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own notification prefs" on public.notification_prefs;
create policy "Users can insert own notification prefs" on public.notification_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own notification prefs" on public.notification_prefs;
create policy "Users can update own notification prefs" on public.notification_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own notification prefs" on public.notification_prefs;
create policy "Users can delete own notification prefs" on public.notification_prefs
  for delete using (auth.uid() = user_id);

drop trigger if exists set_notification_prefs_updated_at on public.notification_prefs;
create trigger set_notification_prefs_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();
