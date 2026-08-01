-- 011 Carer availability, time off, and per-user time settings
--
-- Availability belongs to the PERSON, not to a household. A nanny states her
-- working frame once and every family she works for is checked against the same
-- frame. This is the structural reason families can be told "she is unavailable"
-- without ever being told why.
--
-- A request falling outside these windows produces a WARNING, never a block:
-- "Wed 8:00-13:00 sits outside the hours Nia marked available. She can still
-- say yes."

-- ---------------------------------------------------------------------------
-- Per-user time settings
-- ---------------------------------------------------------------------------
-- Seeded from the device on first launch, editable afterwards. Because every
-- scheduling row stores an absolute UTC instant, changing this only changes how
-- times are RENDERED — it can never silently move a shift.

alter table public.user_profiles
  add column if not exists timezone text;

alter table public.user_profiles
  add column if not exists week_starts_on smallint not null default 1
    check (week_starts_on between 0 and 6);

comment on column public.user_profiles.timezone is
  'IANA zone, seeded from the device. Display only — UTC timestamps are the source of truth.';

-- ---------------------------------------------------------------------------
-- carer_availability
-- ---------------------------------------------------------------------------

create table if not exists public.carer_availability (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.user_profiles(user_id)
                   on delete cascade,
  -- 0 = Sunday .. 6 = Saturday, matching Postgres `extract(dow)`. The UI is
  -- Monday-first; that is a presentation concern, not a storage one.
  weekday        smallint not null check (weekday between 0 and 6),
  is_available   boolean not null default false,
  -- Nominal local wall-clock times in the carer's own timezone.
  earliest_start time,
  latest_finish  time,
  -- "Evenings, sometimes on" — a tri-state, because 'sometimes' is the honest
  -- answer and it changes the copy from "we'll assume" to "we'll ask".
  evening_mode   text not null default 'never'
                   check (evening_mode in ('never', 'sometimes', 'always')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint carer_availability_time_order
    check (
      earliest_start is null
      or latest_finish is null
      or latest_finish > earliest_start
    )
);

create unique index if not exists carer_availability_user_weekday_idx
  on public.carer_availability (user_id, weekday);

-- ---------------------------------------------------------------------------
-- carer_time_off
-- ---------------------------------------------------------------------------
-- Spans every household at once — "Affects Reyes (4 shifts) and one other
-- family (2). Each is told separately." The impact count is computed per
-- household by the API; this row holds no household reference at all, which is
-- what makes leaking one family to another structurally impossible here.

create table if not exists public.carer_time_off (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_profiles(user_id)
                on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  all_day     boolean not null default true,
  -- Shown to families verbatim if the carer writes one: "Family wedding —
  -- booked ages ago." Optional; declining to explain is normal.
  message     text,
  status      text not null default 'confirmed'
                check (status in ('requested', 'confirmed', 'cancelled')),
  -- Stable identity for a future calendar export. Assigning these from day one
  -- is what lets a later sync UPDATE an event rather than duplicate it; adding
  -- them afterwards would mean re-keying every event already pushed to someone's
  -- real calendar.
  ical_uid    text not null unique default gen_random_uuid()::text,
  sequence    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint carer_time_off_range check (ends_at > starts_at)
);

create index if not exists carer_time_off_user_range_idx
  on public.carer_time_off (user_id, starts_at, ends_at)
  where status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Authorisation helper
-- ---------------------------------------------------------------------------
-- True when the current user and the target user are both active members of at
-- least one household in common. This is what lets a parent read their nanny's
-- availability windows — and nothing else about her.
--
-- SECURITY DEFINER for the same reason as the 009 helpers: it reads
-- household_members, whose own policies call back into that table.

create or replace function private.shares_household_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs
      on theirs.household_id = mine.household_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = other_user
      and theirs.status = 'active'
  );
$$;

comment on function private.shares_household_with(uuid) is
  'True when the current user shares at least one active household with the target user. Gates reads of another person''s availability.';

-- Revoke the implicit PUBLIC grant, then grant back explicitly — the policies
-- below call this function, and a policy is evaluated with the CALLER's
-- privileges even though the function is SECURITY DEFINER. See the extended
-- note in 009_households.sql.
--
-- This one does take another user's id, so it is worth being explicit about
-- what it can be used to learn: whether a given uuid shares a household with
-- you. That is the same fact the household_members select policy already
-- exposes, and it requires knowing the uuid up front.
revoke all on function private.shares_household_with(uuid) from public;

grant execute on function private.shares_household_with(uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.carer_availability enable row level security;

-- Read: yourself, or someone you share a household with. The windows are the
-- "available / unavailable" surface families are promised — safe to share
-- because they carry no reference to any other family.
drop policy if exists "Read own or shared availability" on public.carer_availability;
create policy "Read own or shared availability" on public.carer_availability
  for select using (
    auth.uid() = user_id or private.shares_household_with(user_id)
  );

-- Write: only ever yourself. Nobody can edit another person's working hours.
drop policy if exists "Write own availability" on public.carer_availability;
create policy "Write own availability" on public.carer_availability
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.carer_time_off enable row level security;

drop policy if exists "Read own or shared time off" on public.carer_time_off;
create policy "Read own or shared time off" on public.carer_time_off
  for select using (
    auth.uid() = user_id or private.shares_household_with(user_id)
  );

drop policy if exists "Write own time off" on public.carer_time_off;
create policy "Write own time off" on public.carer_time_off
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_carer_availability_updated_at on public.carer_availability;
create trigger set_carer_availability_updated_at
  before update on public.carer_availability
  for each row execute function public.set_updated_at();

drop trigger if exists set_carer_time_off_updated_at on public.carer_time_off;
create trigger set_carer_time_off_updated_at
  before update on public.carer_time_off
  for each row execute function public.set_updated_at();
