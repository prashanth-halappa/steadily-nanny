-- 008 Widgets (the kitchen-sink example feature)
-- One row per user-created widget. Owner-only RLS mirrors user_profiles (002):
-- a signed-in user can only touch their own rows. The backend writes via the
-- service role (which bypasses RLS), so these policies additionally protect any
-- direct PostgREST access.
--
-- SETUP: this table belongs to the example "widget" domain. Replace it with your
-- product's first real feature table, or delete it together with the rest of the
-- widget example (see the New App Checklist).

create table if not exists public.widgets (
  id          uuid primary key default gen_random_uuid(),
  -- owner_id references the profile row (created at first sign-in), matching the
  -- FK style of user_device_info. auth.uid() equals user_profiles.user_id.
  owner_id    uuid not null references public.user_profiles(user_id) on delete cascade,
  name        text not null,
  description text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Supports both the owner-list query (findByOwnerId, newest first) and the
-- digest job's "created since" count.
create index if not exists idx_widgets_owner_created
  on public.widgets (owner_id, created_at desc);

alter table public.widgets enable row level security;

drop policy if exists "Users can view own widgets" on public.widgets;
create policy "Users can view own widgets" on public.widgets
  for select using (auth.uid() = owner_id);

drop policy if exists "Users can insert own widgets" on public.widgets;
create policy "Users can insert own widgets" on public.widgets
  for insert with check (auth.uid() = owner_id);

drop policy if exists "Users can update own widgets" on public.widgets;
create policy "Users can update own widgets" on public.widgets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own widgets" on public.widgets;
create policy "Users can delete own widgets" on public.widgets
  for delete using (auth.uid() = owner_id);

-- Keep updated_at fresh on every UPDATE via the shared trigger fn (migration 001).
drop trigger if exists set_widgets_updated_at on public.widgets;
create trigger set_widgets_updated_at
  before update on public.widgets
  for each row execute function public.set_updated_at();
