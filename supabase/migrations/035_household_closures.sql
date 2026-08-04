-- 035 Parent-declared household closures ("we're away, no cover needed")
--
-- Distinct from `carer_time_off`, which is a carer's personal unavailability
-- spanning every household they work for. A household closure is scoped to
-- ONE household: parents say the family is away and no cover is needed.
-- Carers (nanny/helper) can read these so they know not to expect shifts;
-- only owner/parent may write.

create table if not exists public.household_closures (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  -- Optional note shown to household members ("Half-term in Cornwall").
  message       text,
  created_by    uuid references public.user_profiles(user_id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint household_closures_range check (ends_at > starts_at)
);

create index if not exists household_closures_household_range_idx
  on public.household_closures (household_id, starts_at, ends_at);

comment on table public.household_closures is
  'Parent-declared household closure ("we''re away"). Household-scoped; distinct from carer_time_off.';

alter table public.household_closures enable row level security;

-- Read: any active household member (carers need to see "no cover needed").
drop policy if exists "Members can view household closures" on public.household_closures;
create policy "Members can view household closures" on public.household_closures
  for select using (private.is_household_member(household_id));

-- Write: owner/parent only.
drop policy if exists "Parents can insert household closures" on public.household_closures;
create policy "Parents can insert household closures" on public.household_closures
  for insert with check (private.is_household_parent(household_id));

drop policy if exists "Parents can update household closures" on public.household_closures;
create policy "Parents can update household closures" on public.household_closures
  for update using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

drop policy if exists "Parents can delete household closures" on public.household_closures;
create policy "Parents can delete household closures" on public.household_closures
  for delete using (private.is_household_parent(household_id));

drop trigger if exists set_household_closures_updated_at on public.household_closures;
create trigger set_household_closures_updated_at
  before update on public.household_closures
  for each row execute function public.set_updated_at();
