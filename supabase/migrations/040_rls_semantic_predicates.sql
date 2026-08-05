-- 040 Semantic RLS predicates — private.can_read_household / can_write_household
--
-- WHAT THIS IS
-- Two pass-through wrappers over the authorisation helpers 009 defined, and a
-- verbatim re-creation of every policy that called those helpers directly so it
-- calls a wrapper instead. Nothing else changes.
--
-- WHY
-- `is_household_member` / `is_household_parent` name a MEMBERSHIP FACT. Every
-- policy in this repo uses them to express an ACCESS DECISION — "may this
-- caller read / write this household's rows?". Today those two things coincide.
-- They stop coinciding the moment an agency layer exists: an agency coordinator
-- will be allowed to read a client household's schedule without being a row in
-- that household's `household_members`, and a placement will grant write rights
-- that are not the `owner`/`parent` role. When that lands, the change must be
-- ONE function body, not 38 policy definitions spread across nine migration
-- files — because 38 hand-edited policies is 38 chances to quietly widen or
-- narrow access, and an RLS mistake is silent until it is a breach.
--
-- So: policies now say what they MEAN (`can_read_household`), and the wrappers
-- hold the current answer to how that is decided (membership). This migration
-- is a PURE REFACTOR — zero behaviour change. `can_read_household` returns
-- exactly what `is_household_member` returns, today and until deliberately
-- changed.
--
-- METHOD — verbatim reproduction
-- Each policy below was copied from its source migration file character for
-- character, with ONLY the helper name swapped:
--   private.is_household_member(  ->  private.can_read_household(
--   private.is_household_parent(  ->  private.can_write_household(
-- Where a later migration rewrote a policy, the LATER text is the source:
-- 018_optimize_rls_initplan.sql rewrote `time_entries` / `timesheets`
-- ("Members can view time entries" / "Members can view timesheets") to carry
-- the `(select auth.uid()) = carer_id` OR-arm, so 018's text is what appears
-- here, not 017's. `apps/api/tests/unit/migration040PolicyParity.test.ts`
-- re-derives that mapping from the migration files on every test run and fails
-- on any drift, so this file cannot silently diverge from what it claims to
-- reproduce.
--
-- Source migrations repointed: 009 (6), 010 (8), 014 (8), 015 (6),
-- 017 via 018 (2), 021 (3), 022 (1), 035 (4) — 38 policies in total.
-- 033 only mentions the helpers in a comment; 016's tables do not use them.
--
-- THREE TRAPS, ALL ALREADY PAID FOR IN THIS REPO
--
-- 1. GRANTS. A policy expression is evaluated with the CALLER's privileges.
--    SECURITY DEFINER changes who the function runs AS once entered; it does
--    not grant the right to enter it. A wrapper that `authenticated` cannot
--    EXECUTE turns every ordinary read into
--    `ERROR: 42501: permission denied for function can_read_household` — a 500,
--    not an empty result. That is exactly the 012 incident
--    (012_fix_rls_helper_grants.sql, GOLDEN-FIXES.md #16). The pattern is
--    therefore: revoke the implicit PUBLIC grant FIRST (anon and authenticated
--    inherit from PUBLIC, so naming only those two leaves the grant in place),
--    then grant back explicitly to anon, authenticated, service_role. anon is
--    included deliberately: an unauthenticated read then resolves to
--    `auth.uid() is null` -> false -> zero rows instead of raising.
--
-- 2. NO `(select ...)` AROUND THE HELPER CALLS. 018 deliberately left the
--    household-helper calls bare: the initplan optimisation lives INSIDE the
--    helper (009 wraps `(select auth.uid())` in the helper body), and a helper
--    taking a per-row `household_id` cannot be hoisted into an initplan
--    anyway. `(select private.can_read_household(household_id))` is a form
--    that has never existed in this repo and must not start here.
--
-- 3. `security definer`, `stable`, `set search_path = ''`, schema-qualified
--    body — 009's house style, copied exactly. The pinned empty search_path is
--    what stops a caller redirecting these lookups with their own search_path.
--
-- Repositories use the service role and bypass RLS entirely; the service layer
-- owns authorisation. These policies remain defence in depth for any direct
-- PostgREST access with a user JWT.

-- ---------------------------------------------------------------------------
-- The semantic predicates
-- ---------------------------------------------------------------------------

create or replace function private.can_read_household(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_household_member(hid);
$$;

comment on function private.can_read_household(uuid) is
  'Read-side access decision for a household. Today a pass-through to private.is_household_member; the single place to widen reads (e.g. an agency coordinator) without touching a policy.';

create or replace function private.can_write_household(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_household_parent(hid);
$$;

comment on function private.can_write_household(uuid) is
  'Write-side access decision for a household. Today a pass-through to private.is_household_parent; the single place to widen writes without touching a policy.';

-- GRANTS — see trap 1 in the header. Revoke from PUBLIC, then grant back.
grant usage on schema private to anon, authenticated, service_role;

revoke all on function private.can_read_household(uuid) from public;
revoke all on function private.can_write_household(uuid) from public;

grant execute on function private.can_read_household(uuid)
  to anon, authenticated, service_role;
grant execute on function private.can_write_household(uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 009_households.sql — households, household_members, household_invites
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view their households" on public.households;
create policy "Members can view their households" on public.households
  for select using (private.can_read_household(id));

drop policy if exists "Parents can update their household" on public.households;
create policy "Parents can update their household" on public.households
  for update using (private.can_write_household(id))
  with check (private.can_write_household(id));

drop policy if exists "Members can view co-members" on public.household_members;
create policy "Members can view co-members" on public.household_members
  for select using (private.can_read_household(household_id));

drop policy if exists "Parents can manage members" on public.household_members;
create policy "Parents can manage members" on public.household_members
  for update using (private.can_write_household(household_id))
  with check (private.can_write_household(household_id));

drop policy if exists "Parents can view invites" on public.household_invites;
create policy "Parents can view invites" on public.household_invites
  for select using (private.can_write_household(household_id));

drop policy if exists "Parents can manage invites" on public.household_invites;
create policy "Parents can manage invites" on public.household_invites
  for update using (private.can_write_household(household_id))
  with check (private.can_write_household(household_id));

-- ---------------------------------------------------------------------------
-- 010_children.sql — children, child_commitments
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view children" on public.children;
create policy "Members can view children" on public.children
  for select using (private.can_read_household(household_id));

drop policy if exists "Parents can insert children" on public.children;
create policy "Parents can insert children" on public.children
  for insert with check (private.can_write_household(household_id));

drop policy if exists "Parents can update children" on public.children;
create policy "Parents can update children" on public.children
  for update using (private.can_write_household(household_id))
  with check (private.can_write_household(household_id));

drop policy if exists "Parents can delete children" on public.children;
create policy "Parents can delete children" on public.children
  for delete using (private.can_write_household(household_id));

drop policy if exists "Members can view commitments" on public.child_commitments;
create policy "Members can view commitments" on public.child_commitments
  for select using (private.can_read_household(household_id));

drop policy if exists "Parents can insert commitments" on public.child_commitments;
create policy "Parents can insert commitments" on public.child_commitments
  for insert with check (private.can_write_household(household_id));

drop policy if exists "Parents can update commitments" on public.child_commitments;
create policy "Parents can update commitments" on public.child_commitments
  for update using (private.can_write_household(household_id))
  with check (private.can_write_household(household_id));

drop policy if exists "Parents can delete commitments" on public.child_commitments;
create policy "Parents can delete commitments" on public.child_commitments
  for delete using (private.can_write_household(household_id));

-- ---------------------------------------------------------------------------
-- 014_schedule_patterns.sql — schedule_patterns and its two child tables
-- ---------------------------------------------------------------------------
-- The child tables have no household_id of their own, so their policies reach
-- up through the parent row; the wrapper is called on the joined household_id
-- exactly as the helper was.

drop policy if exists "Members can view patterns" on public.schedule_patterns;
create policy "Members can view patterns" on public.schedule_patterns
  for select using (private.can_read_household(household_id));

drop policy if exists "Parents can insert patterns" on public.schedule_patterns;
create policy "Parents can insert patterns" on public.schedule_patterns
  for insert with check (private.can_write_household(household_id));

drop policy if exists "Parents can update patterns" on public.schedule_patterns;
create policy "Parents can update patterns" on public.schedule_patterns
  for update using (private.can_write_household(household_id))
  with check (private.can_write_household(household_id));

drop policy if exists "Parents can delete patterns" on public.schedule_patterns;
create policy "Parents can delete patterns" on public.schedule_patterns
  for delete using (private.can_write_household(household_id));

drop policy if exists "Members can view pattern days" on public.schedule_pattern_days;
create policy "Members can view pattern days" on public.schedule_pattern_days
  for select using (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = pattern_id and private.can_read_household(p.household_id)
    )
  );

drop policy if exists "Parents can write pattern days" on public.schedule_pattern_days;
create policy "Parents can write pattern days" on public.schedule_pattern_days
  for all using (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = pattern_id and private.can_write_household(p.household_id)
    )
  )
  with check (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = pattern_id and private.can_write_household(p.household_id)
    )
  );

drop policy if exists "Members can view pattern day children"
  on public.schedule_pattern_day_children;
create policy "Members can view pattern day children"
  on public.schedule_pattern_day_children
  for select using (
    exists (
      select 1
      from public.schedule_pattern_days d
      join public.schedule_patterns p on p.id = d.pattern_id
      where d.id = pattern_day_id and private.can_read_household(p.household_id)
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
      where d.id = pattern_day_id and private.can_write_household(p.household_id)
    )
  )
  with check (
    exists (
      select 1
      from public.schedule_pattern_days d
      join public.schedule_patterns p on p.id = d.pattern_id
      where d.id = pattern_day_id and private.can_write_household(p.household_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 015_shifts.sql — shifts, shift_children, shift_change_requests, shift_events
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view shifts" on public.shifts;
create policy "Members can view shifts" on public.shifts
  for select using (private.can_read_household(household_id));

drop policy if exists "Parents can write shifts" on public.shifts;
create policy "Parents can write shifts" on public.shifts
  for all using (private.can_write_household(household_id))
  with check (private.can_write_household(household_id));

drop policy if exists "Members can view shift children" on public.shift_children;
create policy "Members can view shift children" on public.shift_children
  for select using (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.can_read_household(s.household_id)
    )
  );

drop policy if exists "Parents can write shift children" on public.shift_children;
create policy "Parents can write shift children" on public.shift_children
  for all using (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.can_write_household(s.household_id)
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.can_write_household(s.household_id)
    )
  );

drop policy if exists "Members can view change requests" on public.shift_change_requests;
create policy "Members can view change requests" on public.shift_change_requests
  for select using (
    exists (
      select 1 from public.shifts s
      where s.id = shift_id and private.can_read_household(s.household_id)
    )
  );

drop policy if exists "Members can view day thread" on public.shift_events;
create policy "Members can view day thread" on public.shift_events
  for select using (private.can_read_household(household_id));

-- ---------------------------------------------------------------------------
-- 017_time_tracking.sql, as rewritten by 018_optimize_rls_initplan.sql
-- ---------------------------------------------------------------------------
-- 018's text, not 017's: the `(select auth.uid()) = carer_id` OR-arm is the
-- initplan form and is reproduced verbatim. It is what lets a carer read her
-- own hours across families.

drop policy if exists "Members can view time entries" on public.time_entries;
create policy "Members can view time entries" on public.time_entries
  for select using (
    private.can_read_household(household_id) or (select auth.uid()) = carer_id
  );

drop policy if exists "Members can view timesheets" on public.timesheets;
create policy "Members can view timesheets" on public.timesheets
  for select using (
    private.can_read_household(household_id) or (select auth.uid()) = carer_id
  );

-- ---------------------------------------------------------------------------
-- 021_handoff_notes.sql — handoff_notes
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view handoff notes" on public.handoff_notes;
create policy "Members can view handoff notes" on public.handoff_notes
  for select using (private.can_read_household(household_id));

drop policy if exists "Members can insert handoff notes" on public.handoff_notes;
create policy "Members can insert handoff notes" on public.handoff_notes
  for insert with check (private.can_read_household(household_id));

drop policy if exists "Authors or parents can update handoff notes" on public.handoff_notes;
create policy "Authors or parents can update handoff notes" on public.handoff_notes
  for update using (
    private.can_write_household(household_id)
    or author_id = (select auth.uid())
  )
  with check (
    private.can_write_household(household_id)
    or author_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 022_co_parent_approvals.sql — co_parent_approvals
-- ---------------------------------------------------------------------------

drop policy if exists "Parents can view co-parent approvals" on public.co_parent_approvals;
create policy "Parents can view co-parent approvals" on public.co_parent_approvals
  for select using (private.can_write_household(household_id));

-- ---------------------------------------------------------------------------
-- 035_household_closures.sql — household_closures
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view household closures" on public.household_closures;
create policy "Members can view household closures" on public.household_closures
  for select using (private.can_read_household(household_id));

drop policy if exists "Parents can insert household closures" on public.household_closures;
create policy "Parents can insert household closures" on public.household_closures
  for insert with check (private.can_write_household(household_id));

drop policy if exists "Parents can update household closures" on public.household_closures;
create policy "Parents can update household closures" on public.household_closures
  for update using (private.can_write_household(household_id))
  with check (private.can_write_household(household_id));

drop policy if exists "Parents can delete household closures" on public.household_closures;
create policy "Parents can delete household closures" on public.household_closures
  for delete using (private.can_write_household(household_id));
