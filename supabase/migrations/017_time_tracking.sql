-- 017 Time tracking: clock in/out, and the weekly timesheet
--
-- "Hours only — no payments here." This records what actually happened, which
-- is deliberately NOT the same as what was scheduled: the design's clock-in
-- screen says "Starting early? Clock in whenever — we record what happened, not
-- what was planned."
--
-- WHY THIS TABLE MATTERS BEYOND ITS OWN FEATURE
-- The schedule re-materialiser has a branch it could not implement until now:
-- a shift that someone has already clocked into must NEVER be rewritten by a
-- pattern change. Past and paid-for reality is immutable. `time_entries` is the
-- evidence for that branch — see scheduleMaterialisationService.

create table if not exists public.time_entries (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  carer_id           uuid not null references public.user_profiles(user_id)
                       on delete cascade,
  -- Nullable: a carer can clock in on a day with no scheduled shift (covering
  -- at short notice), and a cancellation-pay row has no live shift either.
  shift_id           uuid references public.shifts(id) on delete set null,
  clock_in_at        timestamptz,
  clock_out_at       timestamptz,
  break_minutes      integer not null default 0 check (break_minutes >= 0),
  -- Frozen at clock-out. The scheduled figure must not drift if the shift is
  -- later edited — the timesheet is a record of an agreement at a point in time.
  scheduled_minutes  integer,
  -- worked              a real clocked session
  -- cancellation_paid   hours owed under the household's short-notice policy
  --                     even though nobody worked them
  -- manual_adjustment   a correction agreed between parent and carer
  kind               text not null default 'worked'
                       check (kind in ('worked', 'cancellation_paid', 'manual_adjustment')),
  note               text,
  -- Reassurance, never a gate. The design is explicit: "Location is a
  -- reassurance line, never a gate." Null means "we did not check".
  clock_in_location_ok  boolean,
  clock_out_location_ok boolean,
  status             text not null default 'running'
                       check (status in ('running', 'submitted', 'approved', 'queried')),
  local_date         date not null,
  timezone           text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint time_entries_clock_order
    check (clock_out_at is null or clock_in_at is null or clock_out_at > clock_in_at)
);

-- The materialiser asks "has anyone clocked into this shift?" on every
-- occurrence it considers rewriting, so this lookup must be cheap.
create index if not exists time_entries_shift_idx
  on public.time_entries (shift_id)
  where shift_id is not null;

create index if not exists time_entries_carer_date_idx
  on public.time_entries (carer_id, local_date);

create index if not exists time_entries_household_date_idx
  on public.time_entries (household_id, local_date);

-- At most one RUNNING entry per carer. Someone cannot be on the clock twice,
-- and a partial unique index enforces that without constraining history.
create unique index if not exists time_entries_one_running_per_carer
  on public.time_entries (carer_id)
  where status = 'running';

-- ---------------------------------------------------------------------------
-- timesheets — the weekly roll-up a parent approves in one tap
-- ---------------------------------------------------------------------------

create table if not exists public.timesheets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  carer_id      uuid not null references public.user_profiles(user_id)
                  on delete cascade,
  -- Monday, in the household's timezone. en-GB weeks start Monday.
  week_start    date not null,
  total_minutes integer not null default 0,
  status        text not null default 'open'
                  check (status in ('open', 'submitted', 'approved', 'queried')),
  approved_by   uuid references public.user_profiles(user_id) on delete set null,
  approved_at   timestamptz,
  -- "Query Thursday" — an approval escape hatch that names the disagreement
  -- rather than silently withholding payment.
  query_note    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists timesheets_household_carer_week_idx
  on public.timesheets (household_id, carer_id, week_start);

-- ---------------------------------------------------------------------------
-- local_date is derived, never supplied
-- ---------------------------------------------------------------------------
-- Same reasoning as shifts (015): `timestamptz AT TIME ZONE <text>` is STABLE,
-- not IMMUTABLE, so Postgres refuses it in a GENERATED expression. A trigger
-- gives the same guarantee. Falls back to clock_out_at so a cancellation-pay
-- row with no clock-in still lands on the right day.

create or replace function private.sync_time_entry_local_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.local_date := (
    coalesce(new.clock_in_at, new.clock_out_at, now()) at time zone new.timezone
  )::date;
  return new;
end;
$$;

revoke all on function private.sync_time_entry_local_date() from public;

drop trigger if exists sync_time_entries_local_date on public.time_entries;
create trigger sync_time_entries_local_date
  before insert or update of clock_in_at, clock_out_at, timezone
  on public.time_entries
  for each row execute function private.sync_time_entry_local_date();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Both sides read: the carer needs her own hours across families, and the
-- parent needs the week to approve it. Writes go through the API under the
-- service role, which owns the role checks — a carer clocks in, a parent
-- approves, and neither may do the other's action.

alter table public.time_entries enable row level security;

drop policy if exists "Members can view time entries" on public.time_entries;
create policy "Members can view time entries" on public.time_entries
  for select using (
    private.is_household_member(household_id) or auth.uid() = carer_id
  );

alter table public.timesheets enable row level security;

drop policy if exists "Members can view timesheets" on public.timesheets;
create policy "Members can view timesheets" on public.timesheets
  for select using (
    private.is_household_member(household_id) or auth.uid() = carer_id
  );

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_time_entries_updated_at on public.time_entries;
create trigger set_time_entries_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();

drop trigger if exists set_timesheets_updated_at on public.timesheets;
create trigger set_timesheets_updated_at
  before update on public.timesheets
  for each row execute function public.set_updated_at();
