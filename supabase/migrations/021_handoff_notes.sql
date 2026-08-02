-- 021 Daily handoff notes (design flow 1i)
--
-- Morning (parent) and evening (nanny) chip-based notes for a household day.
-- No AI/voice in v1 — chips + optional body. `moment_saved_at` marks a parent
-- "save as moment" action. Writes go through the API (service role); RLS is the
-- membership-scoped read floor.

create table if not exists public.handoff_notes (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  local_date      date not null,
  author_id       uuid references public.user_profiles(user_id) on delete set null,
  phase           text not null
                    check (phase in ('morning', 'evening')),
  chips           jsonb not null default '[]'::jsonb,
  body            text,
  moment_saved_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists handoff_notes_household_date_idx
  on public.handoff_notes (household_id, local_date, phase);

alter table public.handoff_notes enable row level security;

drop policy if exists "Members can view handoff notes" on public.handoff_notes;
create policy "Members can view handoff notes" on public.handoff_notes
  for select using (private.is_household_member(household_id));

drop policy if exists "Members can insert handoff notes" on public.handoff_notes;
create policy "Members can insert handoff notes" on public.handoff_notes
  for insert with check (private.is_household_member(household_id));

drop policy if exists "Authors or parents can update handoff notes" on public.handoff_notes;
create policy "Authors or parents can update handoff notes" on public.handoff_notes
  for update using (
    private.is_household_parent(household_id)
    or author_id = (select auth.uid())
  )
  with check (
    private.is_household_parent(household_id)
    or author_id = (select auth.uid())
  );

drop trigger if exists set_handoff_notes_updated_at on public.handoff_notes;
create trigger set_handoff_notes_updated_at
  before update on public.handoff_notes
  for each row execute function public.set_updated_at();
