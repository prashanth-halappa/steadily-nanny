-- 052 Lock remaining client writes — finish what 049 started
--
-- 049 closed the household and schedule write surfaces (audit F-B3-1, F-B3-2).
-- A full enumeration of every write policy still standing afterwards turned up
-- three more worth closing, one of them a tenant-isolation break the original
-- audit never found. This migration only DROPS policies. It creates nothing,
-- grants nothing, and alters no table.
--
-- WHY THIS IS SAFE, RE-VERIFIED
-- Unchanged from 049 and re-checked before writing this file. Every repository
-- call in `apps/api` runs on SUPABASE_SERVICE_KEY, so RLS never applies to the
-- API path. And `apps/mobile` has zero `supabase.from(`, `.rpc(`, `.storage`
-- and `.channel` calls anywhere in the app — its only Supabase client is
-- consumed by `apps/mobile/src/store/auth.ts`, every use `supabase.auth.*`,
-- with all data travelling over the REST API via `src/api/client.ts`. Nothing
-- this product ships exercises the policies below; the only caller who can
-- reach them is someone pointing PostgREST at the bundled anon key with their
-- own JWT.
--
-- 1. handoff_notes UPDATE WAS A CROSS-TENANT WRITE (new finding, S1)
-- `"Authors or parents can update handoff notes"` carried
--   can_write_household(household_id) or author_id = (select auth.uid())
-- in BOTH `using` and `with check`. The trap is the `with check`: it is
-- satisfiable by the author arm ALONE, and that arm says nothing whatsoever
-- about `household_id`. So the new row's household was unconstrained:
--
--   PATCH /rest/v1/handoff_notes?id=eq.<a note I wrote>
--   {"household_id": "<any household I am not a member of>"}
--
-- USING passes on the old row (I am the author), WITH CHECK passes on the new
-- row (I am still the author), and the note lands in a stranger's household
-- where their `Members can view handoff notes` renders it. A carer removed
-- from a family — or one who merely kept the uuid — could inject content into
-- that family's handoff feed. An OR-arm that does not constrain the tenant
-- column is not a narrowing of the household arm, it is an escape from it.
--
-- `"Members can insert handoff notes"` had the mirror defect: membership was
-- checked via can_read_household, but `author_id` was free and 021's only
-- trigger sets `updated_at`, so any member could post a note attributed to a
-- parent.
--
-- 2. "Parents can delete children" CONTRADICTED THE SCHEMA'S OWN INVARIANT
-- `010_children.sql` documents `archived_at` as a soft delete, because a child
-- who leaves the arrangement must not vanish from last month's approved
-- timesheet. The DELETE policy permitted a hard delete anyway, cascading
-- through `shift_children`, `schedule_pattern_day_children` and
-- `child_commitments` — silently stripping children off historical shifts that
-- back an approved timesheet. The API only ever archives; PostgREST would
-- delete. That is destruction of financial history through a supported client
-- call.
--
-- 3. carer_time_off "Write own time off" DESYNCED THE MONEY LEDGER
-- It was `for all`, so it carried INSERT/UPDATE/DELETE. `apply_pto_correction`
-- exists precisely to lock `carer_time_off` FOR UPDATE and CAS the household's
-- netted PTO total; a direct `PATCH /rest/v1/carer_time_off?id=eq.X` bypasses
-- that lock and `reconcilePtoUsage` entirely, letting a carer move the dates
-- of leave already paid out in `pto_ledger`. This one is person-scoped rather
-- than household-scoped, so it was checked separately: the API is the sole
-- writer, and its sibling `"Read own or shared time off"` is a SEPARATE select
-- policy, so dropping the write policy leaves the carer's own read intact. No
-- policy needs recreating.
--
-- SAME SHAPE, LOWER STAKES
-- `child_commitments` and `household_closures` carry the ordinary parent
-- insert/update/delete trio and were simply missed by 049's scope.
--
-- children IS A DELIBERATE PARTIAL
-- It is the one table here that does NOT end up select-only. Only its DELETE
-- policy is dropped — that is the one with a documented invariant behind it.
-- INSERT and UPDATE remain, and both are `can_write_household(household_id)`
-- on the old AND the new row, so neither is cross-tenant the way the
-- handoff_notes update was. `migration052LockRemainingClientWrites.test.ts`
-- pins the three survivors by name so this asymmetry stays visible and
-- deliberate instead of reading as an oversight.
--
-- LEFT ALONE, VERIFIED CORRECT
-- `carer_availability`, `external_busy_blocks`, `calendar_accounts`,
-- `calendar_event_links`, `user_profiles`, `user_device_info` and
-- `notification_prefs` are all genuinely person-scoped: no `household_id`, no
-- role column, nothing a second party's money or tenancy hangs off.
--
-- RLS STAYS ON, and that is load-bearing: "no policy" only means "deny" while
-- row level security is enabled. A table with RLS disabled and zero policies
-- is world-writable through PostgREST — the exact inverse of this file's
-- intent. 010, 011, 021 and 035 already enabled it and nothing here turns it
-- off.
--
-- GRANTS: none issued, none revoked — the 041 grant model, as in 049.
--
-- READS ARE UNTOUCHED. There is no SELECT policy change in this migration, on
-- these tables or anywhere else. Only write policies come out.

-- ---------------------------------------------------------------------------
-- 021_handoff_notes.sql — the cross-tenant write
-- ---------------------------------------------------------------------------

drop policy if exists "Authors or parents can update handoff notes" on public.handoff_notes;

drop policy if exists "Members can insert handoff notes" on public.handoff_notes;

-- ---------------------------------------------------------------------------
-- 010_children.sql — children (DELETE only) and child_commitments
-- ---------------------------------------------------------------------------

-- Soft delete is the contract; `archived_at` is the supported path.
drop policy if exists "Parents can delete children" on public.children;

drop policy if exists "Parents can insert commitments" on public.child_commitments;
drop policy if exists "Parents can update commitments" on public.child_commitments;
drop policy if exists "Parents can delete commitments" on public.child_commitments;

-- ---------------------------------------------------------------------------
-- 011_availability.sql / 018_optimize_rls_initplan.sql — carer_time_off
-- ---------------------------------------------------------------------------

-- `for all`. "Read own or shared time off" survives untouched beside it.
drop policy if exists "Write own time off" on public.carer_time_off;

-- ---------------------------------------------------------------------------
-- 035_household_closures.sql — household_closures
-- ---------------------------------------------------------------------------

drop policy if exists "Parents can insert household closures" on public.household_closures;
drop policy if exists "Parents can update household closures" on public.household_closures;
drop policy if exists "Parents can delete household closures" on public.household_closures;
