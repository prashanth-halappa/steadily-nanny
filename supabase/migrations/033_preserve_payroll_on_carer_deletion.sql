-- 033 Preserve payroll history when a carer deletes their account
--
-- WHY THIS MIGRATION EXISTS
-- `UserService.deleteUser` (apps/api/src/domains/user/services/userService.ts)
-- deletes the `user_profiles` row and lets FK cascades take care of the rest.
-- `time_entries.carer_id` and `timesheets.carer_id` were both
-- `not null ... on delete cascade` (017_time_tracking.sql), so a nanny
-- deleting her OWN account silently destroyed the PARENT's record of every
-- hour she ever worked and every timesheet ever approved — the shared record
-- two parties are meant to trust, gone at the request of only one of them.
--
-- PRODUCT DECISION (not a design call made here): the parent's payroll
-- record survives a carer's account deletion. The carer's own account does
-- not. Two changes deliver that:
--   1. `carer_id` becomes nullable with `on delete set null` instead of
--      `on delete cascade` — the row survives, orphaned of its FK.
--   2. A new `carer_display_name` column snapshots the carer's display name
--      so the record stays legible once the profile it would otherwise join
--      against is gone. Backfilled here for existing rows; written by the
--      API at record-creation time for every row from now on (see
--      `apps/api/src/domains/timesheet/services/timesheetCommandService.ts`
--      — `clockIn` and `rollUpIntoTimesheet`).
--
-- `household_members.user_id` (009_households.sql) is deliberately NOT
-- touched here and keeps `on delete cascade`. A membership row states who is
-- CURRENTLY on the roster, not what happened — unlike `time_entries`/
-- `timesheets`, there is no "record" for a dangling membership to preserve,
-- and a nanny who has deleted her account correctly stops appearing as an
-- active member. The payroll history that actually matters is carried by
-- the two tables this migration changes, independently of membership.

-- ---------------------------------------------------------------------------
-- time_entries
-- ---------------------------------------------------------------------------

alter table public.time_entries
  add column if not exists carer_display_name text;

-- Backfill from the still-live profile before anything relies on this column.
update public.time_entries te
set carer_display_name = up.name
from public.user_profiles up
where te.carer_id = up.user_id
  and te.carer_display_name is null;

-- Belt-and-braces: a profile with no `name` set (nullable on user_profiles,
-- 002_user_profiles.sql) must not leave the snapshot NULL either. Matches the
-- fallback the API writes going forward (see timesheetCommandService.ts).
update public.time_entries
set carer_display_name = 'Carer'
where carer_display_name is null;

alter table public.time_entries
  alter column carer_display_name set not null;

alter table public.time_entries
  drop constraint if exists time_entries_carer_id_fkey;

alter table public.time_entries
  alter column carer_id drop not null;

alter table public.time_entries
  add constraint time_entries_carer_id_fkey
    foreign key (carer_id) references public.user_profiles(user_id)
    on delete set null;

-- ---------------------------------------------------------------------------
-- timesheets
-- ---------------------------------------------------------------------------

alter table public.timesheets
  add column if not exists carer_display_name text;

update public.timesheets ts
set carer_display_name = up.name
from public.user_profiles up
where ts.carer_id = up.user_id
  and ts.carer_display_name is null;

update public.timesheets
set carer_display_name = 'Carer'
where carer_display_name is null;

alter table public.timesheets
  alter column carer_display_name set not null;

alter table public.timesheets
  drop constraint if exists timesheets_carer_id_fkey;

alter table public.timesheets
  alter column carer_id drop not null;

alter table public.timesheets
  add constraint timesheets_carer_id_fkey
    foreign key (carer_id) references public.user_profiles(user_id)
    on delete set null;

-- ---------------------------------------------------------------------------
-- RLS — reviewed, not changed
-- ---------------------------------------------------------------------------
-- "Members can view time entries" / "Members can view timesheets"
-- (017_time_tracking.sql, re-optimised in 018_optimize_rls_initplan.sql) read:
--
--   private.is_household_member(household_id) or (select auth.uid()) = carer_id
--
-- `auth.uid() = carer_id` is NULL (never TRUE) for every session once
-- `carer_id` is NULL, so a row orphaned by this migration's `set null` falls
-- back to being visible to household members only — exactly the parent-side
-- payroll record this migration exists to keep, and nothing wider: no policy
-- on either table is written the other way (e.g. matching on
-- `carer_id is null`), so a nullable `carer_id` cannot newly expose a row to
-- anyone who could not already see it. Neither table has an insert/update/
-- delete policy — those tables are written only by the API under the
-- service role (see 017's RLS section header). No policy change needed.
