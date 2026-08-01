-- 014 Recurring schedule patterns (the "usual week")
--
-- A pattern is a PROPOSAL, not a fact. The model is: a parent proposes, the
-- nanny accepts. Between those two events the pattern is real, visible, and
-- unagreed — the UI has to hold that state, so it is a first-class status here
-- rather than a boolean.
--
--   draft      sketched, never sent. Nothing is sent until send is pressed.
--   pending    sent, awaiting the carer
--   accepted   the carer said yes; shifts are materialised from it
--   declined   the carer said no
--   withdrawn  the parent pulled it back before a reply
--   ended      superseded or past its `until` date
--
-- WHY RRULE RATHER THAN AN ENUM
-- "Every week / every other week / term time only" looks like three cases, but
-- term-time is really weekly minus a set of date ranges, and families invent
-- variants constantly. Storing an iCalendar RRULE means the expander handles all
-- of them uniformly, and means a future Google/Apple Calendar export needs no
-- translation layer -- the rule is already in the format those APIs speak.

create table if not exists public.schedule_patterns (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  -- The carer this week is proposed to. Nullable so a parent can sketch a usual
  -- week during onboarding, before any nanny exists (design flow 1a step 6).
  carer_id      uuid references public.user_profiles(user_id) on delete set null,
  status        text not null default 'draft'
                  check (status in ('draft', 'pending', 'accepted',
                                    'declined', 'withdrawn', 'ended')),
  -- iCalendar RRULE, e.g. 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH'.
  rrule         text not null,
  -- First date the rule can produce. A local calendar date, not an instant.
  dtstart       date not null,
  -- Last date, or null for "no end date".
  until         date,
  -- One-off skips (a bank holiday, a week away).
  exdates       date[] not null default '{}',
  -- Term-time pauses: [{"from":"2026-07-21","to":"2026-09-01"}, ...]. Kept
  -- separate from exdates because a pause is a range the family thinks of as
  -- one thing, and is edited as one thing.
  pause_ranges  jsonb not null default '[]'::jsonb,
  -- The zone the wall-clock times in schedule_pattern_days are expressed in.
  -- Copied from the household at creation so that later changing the
  -- household's zone cannot retroactively move an agreed schedule.
  timezone      text not null,
  note          text,
  created_by    uuid references public.user_profiles(user_id) on delete set null,
  sent_at       timestamptz,
  responded_at  timestamptz,
  -- Stable calendar identity + revision counter. Present from the first
  -- migration on purpose: adding them later would mean re-keying every event
  -- already pushed into someone's real calendar.
  ical_uid      text not null unique default gen_random_uuid()::text,
  sequence      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint schedule_patterns_date_order check (until is null or until >= dtstart)
);

create index if not exists schedule_patterns_household_status_idx
  on public.schedule_patterns (household_id, status);

create index if not exists schedule_patterns_carer_idx
  on public.schedule_patterns (carer_id, status)
  where carer_id is not null;

-- ---------------------------------------------------------------------------
-- schedule_pattern_days
-- ---------------------------------------------------------------------------
-- One row per weekday the pattern covers. Times are NOMINAL LOCAL WALL-CLOCK
-- times and must stay that way: "Thursdays 8:00-17:00" has to remain 8am local
-- across a GMT/BST transition. The UTC instant is derived per occurrence, in
-- the pattern's timezone, at expansion time. Storing an offset or a
-- pre-computed UTC time here would drift by an hour twice a year.

create table if not exists public.schedule_pattern_days (
  id          uuid primary key default gen_random_uuid(),
  pattern_id  uuid not null references public.schedule_patterns(id)
                on delete cascade,
  -- 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow).
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- end_time > start_time: an overnight shift is modelled as two days, not as a
  -- wrapping range, so that "which day does this belong to" is never ambiguous.
  constraint schedule_pattern_days_time_order check (end_time > start_time)
);

create unique index if not exists schedule_pattern_days_pattern_weekday_idx
  on public.schedule_pattern_days (pattern_id, weekday);

-- ---------------------------------------------------------------------------
-- schedule_pattern_day_children
-- ---------------------------------------------------------------------------
-- Which children are covered on a given day, and for which part of it.
--
-- NULL start/end means "the whole shift" (Theo, all day). Non-null carves out a
-- sub-range, which is how Maya ends up as two rows on a preschool day: 8:00-9:00
-- and 12:00-17:00, with the 9:00-12:00 preschool block left out.

create table if not exists public.schedule_pattern_day_children (
  id              uuid primary key default gen_random_uuid(),
  pattern_day_id  uuid not null references public.schedule_pattern_days(id)
                    on delete cascade,
  child_id        uuid not null references public.children(id) on delete cascade,
  start_time      time,
  end_time        time,
  created_at      timestamptz not null default now(),
  constraint schedule_pattern_day_children_time_order
    check (start_time is null or end_time is null or end_time > start_time),
  -- Both null (whole shift) or both set (explicit window). One-sided is a bug.
  constraint schedule_pattern_day_children_time_pairing
    check ((start_time is null) = (end_time is null))
);

create index if not exists schedule_pattern_day_children_day_idx
  on public.schedule_pattern_day_children (pattern_day_id);

create index if not exists schedule_pattern_day_children_child_idx
  on public.schedule_pattern_day_children (child_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- The carer must be able to READ a pattern proposed to her — that is the whole
-- point of sending it. She responds through the API (accept / decline /
-- counter), which runs under the service role, so she gets no direct write.
--
-- The child tables have no household_id of their own, so their policies reach
-- up through the parent row. That is a join per row, which is acceptable here:
-- these are small tables read a handful of rows at a time, unlike shifts.

alter table public.schedule_patterns enable row level security;

drop policy if exists "Members can view patterns" on public.schedule_patterns;
create policy "Members can view patterns" on public.schedule_patterns
  for select using (private.is_household_member(household_id));

drop policy if exists "Parents can insert patterns" on public.schedule_patterns;
create policy "Parents can insert patterns" on public.schedule_patterns
  for insert with check (private.is_household_parent(household_id));

drop policy if exists "Parents can update patterns" on public.schedule_patterns;
create policy "Parents can update patterns" on public.schedule_patterns
  for update using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

drop policy if exists "Parents can delete patterns" on public.schedule_patterns;
create policy "Parents can delete patterns" on public.schedule_patterns
  for delete using (private.is_household_parent(household_id));

alter table public.schedule_pattern_days enable row level security;

drop policy if exists "Members can view pattern days" on public.schedule_pattern_days;
create policy "Members can view pattern days" on public.schedule_pattern_days
  for select using (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = pattern_id and private.is_household_member(p.household_id)
    )
  );

drop policy if exists "Parents can write pattern days" on public.schedule_pattern_days;
create policy "Parents can write pattern days" on public.schedule_pattern_days
  for all using (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = pattern_id and private.is_household_parent(p.household_id)
    )
  )
  with check (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = pattern_id and private.is_household_parent(p.household_id)
    )
  );

alter table public.schedule_pattern_day_children enable row level security;

drop policy if exists "Members can view pattern day children"
  on public.schedule_pattern_day_children;
create policy "Members can view pattern day children"
  on public.schedule_pattern_day_children
  for select using (
    exists (
      select 1
      from public.schedule_pattern_days d
      join public.schedule_patterns p on p.id = d.pattern_id
      where d.id = pattern_day_id and private.is_household_member(p.household_id)
    )
  );

drop policy if exists "Parents can write pattern day children"
  on public.schedule_pattern_day_children;
create policy "Parents can write pattern day children"
  on public.schedule_pattern_day_children
  for all using (
    exists (
      select 1
      from public.schedule_pattern_days d
      join public.schedule_patterns p on p.id = d.pattern_id
      where d.id = pattern_day_id and private.is_household_parent(p.household_id)
    )
  )
  with check (
    exists (
      select 1
      from public.schedule_pattern_days d
      join public.schedule_patterns p on p.id = d.pattern_id
      where d.id = pattern_day_id and private.is_household_parent(p.household_id)
    )
  );

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_schedule_patterns_updated_at on public.schedule_patterns;
create trigger set_schedule_patterns_updated_at
  before update on public.schedule_patterns
  for each row execute function public.set_updated_at();

drop trigger if exists set_schedule_pattern_days_updated_at
  on public.schedule_pattern_days;
create trigger set_schedule_pattern_days_updated_at
  before update on public.schedule_pattern_days
  for each row execute function public.set_updated_at();
