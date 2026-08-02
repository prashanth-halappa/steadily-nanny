-- 018 Optimize RLS policies: wrap auth.uid() in a sub-select
--
-- WHAT SUPABASE'S PERFORMANCE ADVISOR FLAGGED
-- 18 policies across 9 tables call `auth.uid()` directly inside a USING/WITH
-- CHECK expression. Postgres re-evaluates a bare `auth.uid()` call ONCE PER
-- ROW the policy is checked against, because the planner cannot prove it is
-- the same value across the whole scan. Wrapping it as `(select auth.uid())`
-- makes it an InitPlan: Postgres proves the sub-select is stable for the
-- statement and evaluates it exactly once, then reuses the result for every
-- row. Same boolean result either way — this is purely a planner hint, not a
-- semantic change. See:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- WHY THE HOUSEHOLD-SCOPED TABLES ARE NOT IN THIS FILE
-- Every table authorised through `private.is_household_member` /
-- `private.is_household_parent` / `private.shares_household_with`
-- (households, household_members, children, schedule_patterns, shifts, and
-- everything nested under them) is ALREADY optimal and does not appear
-- below. Those functions wrap `(select auth.uid())` internally (see
-- 009_households.sql, 011_availability.sql) — the wrapping happens once,
-- inside the helper, rather than needing to be repeated at every call site.
-- This is the non-obvious part: the advisor lint fires on the literal SQL
-- text of a policy expression, so a bare `auth.uid()` hidden inside a
-- SECURITY DEFINER function it calls is invisible to it. The 18 fixes below
-- are exactly the tables that do NOT go through those helpers — the ones
-- still using the template's original per-person `auth.uid() = user_id`
-- ownership pattern (still the *correct* model for genuinely person-owned
-- rows like a profile or a calendar account), just written in the
-- unoptimized form.
--
-- SCOPE
-- Policy definitions only, plus one index. No table, column, or constraint
-- changes. Every `drop policy if exists` + `create policy` pair reproduces
-- the existing policy's logic exactly (verified against live `pg_policies`
-- before writing this file) with only the `auth.uid()` calls rewritten.
--
-- APPLIED LIVE as version 20260802150139. All auth.uid() policies are stored
-- as (SELECT auth.uid()). The earlier hold-back note (device-test risk after
-- the 012 incident) is historical — do not re-apply; this migration is already
-- on the project.

-- ---------------------------------------------------------------------------
-- user_profiles (002_user_profiles.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own profile" on public.user_profiles;
create policy "Users can view own profile" on public.user_profiles
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own profile" on public.user_profiles;
create policy "Users can insert own profile" on public.user_profiles
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile" on public.user_profiles
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own profile" on public.user_profiles;
create policy "Users can delete own profile" on public.user_profiles
  for delete using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- user_device_info (003_user_device_info.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view own devices" on public.user_device_info;
create policy "Users can view own devices" on public.user_device_info
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own devices" on public.user_device_info;
create policy "Users can insert own devices" on public.user_device_info
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own devices" on public.user_device_info;
create policy "Users can update own devices" on public.user_device_info
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own devices" on public.user_device_info;
create policy "Users can delete own devices" on public.user_device_info
  for delete using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- carer_availability (011_availability.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Read own or shared availability" on public.carer_availability;
create policy "Read own or shared availability" on public.carer_availability
  for select using (
    (select auth.uid()) = user_id or private.shares_household_with(user_id)
  );

drop policy if exists "Write own availability" on public.carer_availability;
create policy "Write own availability" on public.carer_availability
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- carer_time_off (011_availability.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Read own or shared time off" on public.carer_time_off;
create policy "Read own or shared time off" on public.carer_time_off
  for select using (
    (select auth.uid()) = user_id or private.shares_household_with(user_id)
  );

drop policy if exists "Write own time off" on public.carer_time_off;
create policy "Write own time off" on public.carer_time_off
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- calendar_accounts (016_calendar_seams.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Own calendar accounts" on public.calendar_accounts;
create policy "Own calendar accounts" on public.calendar_accounts
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- calendar_event_links (016_calendar_seams.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Own calendar links" on public.calendar_event_links;
create policy "Own calendar links" on public.calendar_event_links
  for all using (
    exists (
      select 1 from public.calendar_accounts a
      where a.id = calendar_account_id and a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.calendar_accounts a
      where a.id = calendar_account_id and a.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- external_busy_blocks (016_calendar_seams.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Read own or shared busy blocks" on public.external_busy_blocks;
create policy "Read own or shared busy blocks" on public.external_busy_blocks
  for select using (
    (select auth.uid()) = user_id or private.shares_household_with(user_id)
  );

drop policy if exists "Write own busy blocks" on public.external_busy_blocks;
create policy "Write own busy blocks" on public.external_busy_blocks
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- time_entries (017_time_tracking.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view time entries" on public.time_entries;
create policy "Members can view time entries" on public.time_entries
  for select using (
    private.is_household_member(household_id) or (select auth.uid()) = carer_id
  );

-- ---------------------------------------------------------------------------
-- timesheets (017_time_tracking.sql)
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view timesheets" on public.timesheets;
create policy "Members can view timesheets" on public.timesheets
  for select using (
    private.is_household_member(household_id) or (select auth.uid()) = carer_id
  );

-- ---------------------------------------------------------------------------
-- unindexed_foreign_keys — one addition
-- ---------------------------------------------------------------------------
-- The performance advisor also flagged 13 unindexed foreign keys. Twelve are
-- `_by`/`actor_id` audit-trail columns never filtered on in the app today —
-- left alone. `timesheets.carer_id` is the one worth adding proactively: the
-- table's only other index is the compound
-- `timesheets_household_carer_week_idx (household_id, carer_id, week_start)`,
-- which cannot serve a query that filters on `carer_id` alone (not the
-- leading column) — exactly what the `(select auth.uid()) = carer_id` branch
-- of the policy above needs when a query isn't also scoped by household_id,
-- and the natural index for a future "my hours across every family" read.

create index if not exists timesheets_carer_id_idx
  on public.timesheets (carer_id);
