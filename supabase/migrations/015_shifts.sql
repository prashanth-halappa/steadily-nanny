-- 015 Shifts, coverage, change requests and the day thread
--
-- The centre of the app. A shift is one carer covering one household for one
-- span of time. Everything else — hours, gaps, notes, the timesheet — hangs off
-- this table.
--
-- TIME MODEL
-- starts_at / ends_at are absolute UTC instants. That is the only truth. A
-- parent in London, a nanny who travels, and a co-parent abroad all see the
-- same instant rendered in their own zone. `timezone` records the zone the
-- shift was AUTHORED in, so the original wall-clock intent ("8am") survives even
-- if the household later moves.
--
-- NO OVERLAP CONSTRAINT, DELIBERATELY
-- There is no exclusion constraint preventing overlapping shifts. The product
-- rule is that conflicts WARN and never block: a nanny may accept a shift that
-- clashes with another family, and a household may double-book while it sorts
-- cover out. Enforcing non-overlap in the database would make the honest states
-- unrepresentable.

create table if not exists public.shifts (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  -- Nullable: "Thu — nobody yet" is a real, displayable state (design flow 1j).
  carer_id          uuid references public.user_profiles(user_id) on delete set null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  timezone          text not null,
  -- The local calendar day this shift belongs to, for day-grouped reads.
  -- Maintained by a trigger, never by callers — see below.
  local_date        date not null,
  kind              text not null default 'recurring'
                      check (kind in ('recurring', 'extra', 'cover', 'parent_cover')),
  status            text not null default 'draft'
                      check (status in ('draft', 'pending', 'confirmed',
                                        'declined', 'cancelled', 'completed')),
  source_pattern_id uuid references public.schedule_patterns(id) on delete set null,
  -- Who authored this instance. `system_generated` means it came straight from
  -- a pattern and has not been touched since — which is exactly the test the
  -- re-materialiser uses to decide whether it may overwrite the row.
  origin            text not null default 'system_generated'
                      check (origin in ('system_generated', 'parent_proposed',
                                        'nanny_countered', 'parent_cover')),
  -- Set when the change landed inside the household's short_notice_hours.
  is_short_notice   boolean not null default false,
  note              text,
  reason            text,
  cancelled_at         timestamptz,
  cancelled_by         uuid references public.user_profiles(user_id) on delete set null,
  -- Whether the cancellation still counts as paid hours, decided at cancel time
  -- against the household policy. Frozen onto the row on purpose: changing the
  -- policy later must not silently rewrite what someone was already owed.
  cancellation_paid    boolean not null default false,
  cancellation_message text,
  ical_uid          text not null unique default gen_random_uuid()::text,
  sequence          integer not null default 0,
  created_by        uuid references public.user_profiles(user_id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint shifts_time_order check (ends_at > starts_at)
);

-- The two hot read paths. The household index serves "show me this week"; the
-- carer index serves the cross-household busy scan that powers clash warnings,
-- and is the one that must stay fast as a nanny accumulates families.
create index if not exists shifts_household_starts_idx
  on public.shifts (household_id, starts_at);

create index if not exists shifts_carer_starts_idx
  on public.shifts (carer_id, starts_at)
  where carer_id is not null;

create index if not exists shifts_household_local_date_idx
  on public.shifts (household_id, local_date);

create index if not exists shifts_pattern_idx
  on public.shifts (source_pattern_id)
  where source_pattern_id is not null;

-- local_date cannot be a GENERATED column: `timestamptz AT TIME ZONE <text>` is
-- STABLE, not IMMUTABLE, because it depends on the tz database. Postgres refuses
-- it in a generated expression. A trigger gives the same guarantee — the value
-- is always derived, never supplied — without that restriction.
create or replace function private.sync_shift_local_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.local_date := (new.starts_at at time zone new.timezone)::date;
  return new;
end;
$$;

revoke all on function private.sync_shift_local_date() from public;

drop trigger if exists sync_shifts_local_date on public.shifts;
create trigger sync_shifts_local_date
  before insert or update of starts_at, timezone on public.shifts
  for each row execute function private.sync_shift_local_date();

-- ---------------------------------------------------------------------------
-- shift_children — who is covered, and when
-- ---------------------------------------------------------------------------
-- NULL start/end means the whole shift. A preschool morning produces two rows
-- for the same child on the same shift (8:00-9:00 and 12:00-17:00), which is
-- what makes the coverage lanes and the gap detector work per child rather than
-- per adult.

create table if not exists public.shift_children (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null references public.shifts(id) on delete cascade,
  child_id   uuid not null references public.children(id) on delete cascade,
  starts_at  timestamptz,
  ends_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint shift_children_time_order
    check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint shift_children_time_pairing
    check ((starts_at is null) = (ends_at is null))
);

create index if not exists shift_children_shift_idx
  on public.shift_children (shift_id);

create index if not exists shift_children_child_idx
  on public.shift_children (child_id);

-- ---------------------------------------------------------------------------
-- shift_change_requests
-- ---------------------------------------------------------------------------
-- The one place the propose/accept model inverts: a carer can counter-offer.
-- Also carries parent-initiated time changes, cancellations, splits and
-- handovers, so a day's negotiation is one queryable list.
--
-- DEFERRED, NOT FORGOTTEN: this is flows 1d ("One-off extra shift") and 1e
-- ("Short notice — change, cancel, or swap") from the design storyboard —
-- see PROJECT-STATUS.md's flow-by-flow status table, both "not started".
-- `apps/api/src/domains/shift/services/shiftCommandService.ts`'s header
-- comment and `apps/api/src/domains/shift/schemas.ts`'s `ParentEditShiftSchema`
-- doc both name this table as wave-2/out-of-scope, which is why `shifts` has
-- exactly one write path (the narrow parent time/note edit) and this table
-- has no repository, service, controller, or route at all. The ONE thing
-- that already reads it: `scheduleShiftRepository.hasChangeRequests` — the
-- re-materialisation guard that will refuse to touch a shift once this flow
-- ships, pre-wired ahead of the feature it protects.

create table if not exists public.shift_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  shift_id           uuid not null references public.shifts(id) on delete cascade,
  requested_by       uuid references public.user_profiles(user_id) on delete set null,
  kind               text not null
                       check (kind in ('time_change', 'cancel', 'counter_offer',
                                       'split', 'handover')),
  proposed_starts_at timestamptz,
  proposed_ends_at   timestamptz,
  -- Free text shown verbatim to the other side. "I can be there straight after
  -- 21:00 if that still helps." Declining without one is normal and unpunished.
  message            text,
  status             text not null default 'pending'
                       check (status in ('pending', 'accepted', 'declined',
                                         'withdrawn', 'superseded')),
  responded_by       uuid references public.user_profiles(user_id) on delete set null,
  responded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint shift_change_requests_time_order
    check (proposed_starts_at is null
           or proposed_ends_at is null
           or proposed_ends_at > proposed_starts_at)
);

create index if not exists shift_change_requests_shift_idx
  on public.shift_change_requests (shift_id, created_at desc);

create index if not exists shift_change_requests_pending_idx
  on public.shift_change_requests (shift_id)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- shift_events — the day thread
-- ---------------------------------------------------------------------------
-- Append-only. "Amara asked to cancel / Sam agreed / Nia told / Nia
-- acknowledged." One thread per day so nobody has to remember who agreed to
-- what — the quiet audit trail is the thing households actually argue about.
--
-- shift_id is nullable so day-level events (a gap raised, a cover week
-- rearranged) can be recorded against a date with no single shift.

create table if not exists public.shift_events (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  shift_id     uuid references public.shifts(id) on delete cascade,
  local_date   date not null,
  actor_id     uuid references public.user_profiles(user_id) on delete set null,
  event_type   text not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists shift_events_household_date_idx
  on public.shift_events (household_id, local_date, created_at);

create index if not exists shift_events_shift_idx
  on public.shift_events (shift_id, created_at)
  where shift_id is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Reads are household-scoped, which is the floor that stops one family seeing
-- another's shifts even though the same nanny works both. The service-layer
-- anonymiser (API availability domain) is what turns a cross-household busy
-- span into "unavailable" with no name attached; this is the backstop under it.
--
-- Writes go through the API under the service role. Carers respond via
-- endpoints rather than direct writes, so there are no carer write policies.

alter table public.shifts enable row level security;

drop policy if exists "Members can view shifts" on public.shifts;
create policy "Members can view shifts" on public.shifts
  for select using (private.is_household_member(household_id));

drop policy if exists "Parents can write shifts" on public.shifts;
create policy "Parents can write shifts" on public.shifts
  for all using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

alter table public.shift_children enable row level security;

drop policy if exists "Members can view shift children" on public.shift_children;
create policy "Members can view shift children" on public.shift_children
  for select using (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.is_household_member(s.household_id)
    )
  );

drop policy if exists "Parents can write shift children" on public.shift_children;
create policy "Parents can write shift children" on public.shift_children
  for all using (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.is_household_parent(s.household_id)
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.is_household_parent(s.household_id)
    )
  );

alter table public.shift_change_requests enable row level security;

drop policy if exists "Members can view change requests" on public.shift_change_requests;
create policy "Members can view change requests" on public.shift_change_requests
  for select using (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.is_household_member(s.household_id)
    )
  );

alter table public.shift_events enable row level security;

drop policy if exists "Members can view day thread" on public.shift_events;
create policy "Members can view day thread" on public.shift_events
  for select using (private.is_household_member(household_id));

-- No update or delete policy anywhere on shift_events: it is append-only, and an
-- audit trail that can be edited is not an audit trail.

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_shifts_updated_at on public.shifts;
create trigger set_shifts_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

drop trigger if exists set_shift_change_requests_updated_at
  on public.shift_change_requests;
create trigger set_shift_change_requests_updated_at
  before update on public.shift_change_requests
  for each row execute function public.set_updated_at();
