-- 058 Give payroll rows a per-membership identity that outlives the account
--
-- WHY THIS MIGRATION EXISTS
-- `033_preserve_payroll_on_carer_deletion.sql` keeps the parent's payroll
-- record when a carer deletes her account: `carer_id` goes NULL (on delete
-- set null) and the NOT NULL `carer_display_name` snapshot is what is left to
-- identify her by. That works for one departed carer. It stops working for
-- two: every parent surface groups rows by `carer_id ?? carer_display_name`,
-- so two departed carers who happened to share a display name collapse into a
-- single bucket — one tab, one summed total, and an "Approve the week" button
-- pointed at whichever of their timesheets sorted first. A parent freezes a
-- pay record against a figure that is not its own.
--
-- The missing piece is an identity that is on the row BEFORE the account is
-- deleted. `household_members.id` (009_households.sql:70) is exactly that: a
-- surrogate key, unique per (user, household) via
-- `household_members_user_household_idx`, and never reused.
--
-- NO FOREIGN KEY — deliberate, and the whole point.
-- `household_members.user_id` keeps `on delete cascade` (033's header says so
-- explicitly: a membership row states who is CURRENTLY on the roster, and a
-- departed carer correctly stops being a member). So the membership row is
-- GONE the moment this identity starts to matter. A foreign key would either
-- block that delete or null the column with it; this is a pure bucketing key,
-- not a reference, and it is stored as such.
--
-- INSERT-ONLY, for the same reason.
-- Account deletion fires `on delete set null` on `carer_id` — an UPDATE. A
-- trigger that also ran on update would re-resolve the membership at exactly
-- the moment it can no longer be resolved. The stamp is written once, at
-- insert, from a `carer_id` that is still live, and is never revisited.
--
-- NULL-SAFE. `carer_id` is nullable on all five tables. `hm.user_id =
-- new.carer_id` with a NULL carer_id is NULL, never true, so the subselect
-- returns no row and the column stays NULL — no exception, no wrong match.
-- A row inserted with no carer at all simply has no bucket key, and the
-- display-name fallback still applies to it.
--
-- NO INDEX, on purpose. Nothing filters or joins on this column server-side;
-- it travels out on the wire and is used as a grouping key by the client.
-- Five more btrees on five hot tables would be pure write cost.
--
-- TWO ACCEPTED LIMITS, so nobody has to rediscover them:
--   1. FORWARD-ONLY. Rows whose `carer_id` was already NULLed before this
--      migration ran cannot be backfilled — their membership rows were
--      cascade-deleted with the account. They keep the display-name fallback
--      and stay merged if two of them share a name. The backfill below only
--      reaches rows whose carer is still a member.
--   2. IDENTITY PER ENGAGEMENT. The unique index makes at most one membership
--      row exist per (user, household) at a time, so the lookup is
--      unambiguous — but a carer whose row went away (account deletion, then
--      a fresh account later) is a new person as far as this key is
--      concerned, and gets one bucket per engagement. That is still strictly
--      better than merging two different humans under one name.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

alter table public.time_entries
  add column if not exists household_member_id uuid;

alter table public.timesheets
  add column if not exists household_member_id uuid;

alter table public.pay_arrangements
  add column if not exists household_member_id uuid;

alter table public.pto_ledger
  add column if not exists household_member_id uuid;

alter table public.expenses
  add column if not exists household_member_id uuid;

-- ---------------------------------------------------------------------------
-- One stamping function, five triggers
-- ---------------------------------------------------------------------------
-- In the DB rather than in the API because there are already several insert
-- sites per table (clock-in, retroactive entry, cancellation fragments,
-- roll-up, accruals, corrections) and more will be added; one trigger covers
-- every current and future one, and cannot be forgotten by a new caller.
--
-- `coalesce` first, so an explicitly supplied value always wins — a future
-- backfill or data-repair script can set the bucket by hand.

create or replace function private.stamp_household_member_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.household_member_id := coalesce(
    new.household_member_id,
    (
      select id
      from public.household_members hm
      where hm.household_id = new.household_id
        and hm.user_id = new.carer_id
    )
  );
  return new;
end;
$$;

revoke all on function private.stamp_household_member_id() from public;

drop trigger if exists time_entries_stamp_household_member_id
  on public.time_entries;
create trigger time_entries_stamp_household_member_id
  before insert on public.time_entries
  for each row execute function private.stamp_household_member_id();

drop trigger if exists timesheets_stamp_household_member_id
  on public.timesheets;
create trigger timesheets_stamp_household_member_id
  before insert on public.timesheets
  for each row execute function private.stamp_household_member_id();

drop trigger if exists pay_arrangements_stamp_household_member_id
  on public.pay_arrangements;
create trigger pay_arrangements_stamp_household_member_id
  before insert on public.pay_arrangements
  for each row execute function private.stamp_household_member_id();

drop trigger if exists pto_ledger_stamp_household_member_id
  on public.pto_ledger;
create trigger pto_ledger_stamp_household_member_id
  before insert on public.pto_ledger
  for each row execute function private.stamp_household_member_id();

drop trigger if exists expenses_stamp_household_member_id
  on public.expenses;
create trigger expenses_stamp_household_member_id
  before insert on public.expenses
  for each row execute function private.stamp_household_member_id();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Every row whose carer is still a member of the household gets its identity
-- now, so the split works for carers who leave AFTER this migration rather
-- than only for rows written after it. `household_member_id is null` keeps
-- this re-runnable and stops it from overwriting anything.

update public.time_entries t
set household_member_id = hm.id
from public.household_members hm
where t.carer_id = hm.user_id
  and t.household_id = hm.household_id
  and t.household_member_id is null;

update public.timesheets t
set household_member_id = hm.id
from public.household_members hm
where t.carer_id = hm.user_id
  and t.household_id = hm.household_id
  and t.household_member_id is null;

update public.pay_arrangements t
set household_member_id = hm.id
from public.household_members hm
where t.carer_id = hm.user_id
  and t.household_id = hm.household_id
  and t.household_member_id is null;

update public.pto_ledger t
set household_member_id = hm.id
from public.household_members hm
where t.carer_id = hm.user_id
  and t.household_id = hm.household_id
  and t.household_member_id is null;

update public.expenses t
set household_member_id = hm.id
from public.household_members hm
where t.carer_id = hm.user_id
  and t.household_id = hm.household_id
  and t.household_member_id is null;

-- ---------------------------------------------------------------------------
-- RLS — reviewed, not changed
-- ---------------------------------------------------------------------------
-- No policy on any of the five tables reads `household_member_id`, and none
-- is added here: the column is a grouping key on data the reader can already
-- see, never a permission input. Adding it to a policy would be a real
-- change of who sees what, and is not what this migration does.
