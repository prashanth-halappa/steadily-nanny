-- 010 Children and their fixed commitments
--
-- Children are the unit everything else attaches to. A shift is only
-- interesting because a child is covered, so coverage, gaps and the daily log
-- all key off this table rather than off the carer.
--
-- Each child carries their own hours: preschool and naps do not have to match
-- between siblings, which is why commitments hang off the child and not the
-- household.

create table if not exists public.children (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null,
  -- Age is always derived, never stored — "Maya, 3" has to stay true next year.
  birth_date    date,
  -- Timeline colour and the single-letter avatar. Both are presentation, but
  -- they must be stable across devices, so they live with the record.
  colour        text,
  avatar_initial text,
  -- Free text the carer sees: "two naps", "no dairy".
  routine_notes text,
  -- Soft delete. A child who leaves the arrangement must not vanish from last
  -- month's approved timesheet.
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists children_household_idx
  on public.children (household_id)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- child_commitments
-- ---------------------------------------------------------------------------
-- A child's fixed life, set once: preschool Mon-Thu 9:00-12:00, swimming,
-- grandma Fridays. Every shift is then drawn around it, and a commitment marked
-- `excluded_from_cover` is what carves the visible gap out of a coverage lane.

create table if not exists public.child_commitments (
  id                  uuid primary key default gen_random_uuid(),
  child_id            uuid not null references public.children(id) on delete cascade,
  -- Denormalised from children so the RLS policy is a direct predicate rather
  -- than a join on every row read. Kept honest by the trigger below.
  household_id        uuid not null references public.households(id) on delete cascade,
  kind                text not null default 'other'
                        check (kind in ('preschool', 'school', 'activity', 'nap', 'other')),
  label               text not null,
  -- iCalendar RRULE, e.g. 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH'. Stored in the same
  -- dialect as schedule_patterns so one expander serves both, and so a future
  -- calendar export needs no translation layer.
  rrule               text not null,
  -- Nominal local wall-clock times, deliberately NOT timestamptz. "Preschool
  -- starts at 9" must stay 9am across a DST transition; the UTC instant is
  -- derived per occurrence in the household timezone. See 013_shifts.sql.
  start_time          time not null,
  end_time            time not null,
  starts_on           date,
  ends_on             date,
  -- Dates the rule would produce but that do not happen (INSET days, holidays).
  exdates             date[] not null default '{}',
  -- True for preschool: the carer is not covering the child during it, so the
  -- time is subtracted from coverage rather than added to it.
  excluded_from_cover boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint child_commitments_time_order check (end_time > start_time)
);

create index if not exists child_commitments_child_idx
  on public.child_commitments (child_id);

create index if not exists child_commitments_household_idx
  on public.child_commitments (household_id);

-- Guarantee the denormalised household_id always matches the child's. Without
-- this, a bad write would make a commitment readable by the wrong household —
-- the denormalisation would become a privacy hole rather than an optimisation.
-- Lives in `private`, not `public`: PostgREST exposes every public function as
-- an RPC endpoint, so a SECURITY DEFINER function in `public` is callable at
-- /rest/v1/rpc/ by anon (Supabase advisor 0028/0029). A trigger function has no
-- business on the public API.
create or replace function private.sync_child_commitment_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.household_id into new.household_id
  from public.children c
  where c.id = new.child_id;

  if new.household_id is null then
    raise exception 'child % does not exist', new.child_id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_child_commitment_household() from public;

drop trigger if exists sync_child_commitments_household on public.child_commitments;
create trigger sync_child_commitments_household
  before insert or update of child_id, household_id on public.child_commitments
  for each row execute function private.sync_child_commitment_household();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Every active member reads children, including the nanny and a view-only
-- helper — a carer cannot do the job without knowing the child's routine. Only
-- parents write.

alter table public.children enable row level security;

drop policy if exists "Members can view children" on public.children;
create policy "Members can view children" on public.children
  for select using (private.is_household_member(household_id));

drop policy if exists "Parents can insert children" on public.children;
create policy "Parents can insert children" on public.children
  for insert with check (private.is_household_parent(household_id));

drop policy if exists "Parents can update children" on public.children;
create policy "Parents can update children" on public.children
  for update using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

drop policy if exists "Parents can delete children" on public.children;
create policy "Parents can delete children" on public.children
  for delete using (private.is_household_parent(household_id));

alter table public.child_commitments enable row level security;

drop policy if exists "Members can view commitments" on public.child_commitments;
create policy "Members can view commitments" on public.child_commitments
  for select using (private.is_household_member(household_id));

drop policy if exists "Parents can insert commitments" on public.child_commitments;
create policy "Parents can insert commitments" on public.child_commitments
  for insert with check (private.is_household_parent(household_id));

drop policy if exists "Parents can update commitments" on public.child_commitments;
create policy "Parents can update commitments" on public.child_commitments
  for update using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

drop policy if exists "Parents can delete commitments" on public.child_commitments;
create policy "Parents can delete commitments" on public.child_commitments
  for delete using (private.is_household_parent(household_id));

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_children_updated_at on public.children;
create trigger set_children_updated_at
  before update on public.children
  for each row execute function public.set_updated_at();

drop trigger if exists set_child_commitments_updated_at on public.child_commitments;
create trigger set_child_commitments_updated_at
  before update on public.child_commitments
  for each row execute function public.set_updated_at();
