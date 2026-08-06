-- 049 Lock client writes — remove the client-facing write policies
--
-- Closes audit findings F-B3-1 (S0, role escalation) and F-B3-2 (S1, direct
-- schedule writes). This migration only DROPS policies. It creates nothing,
-- grants nothing, and alters no table.
--
-- WHY THESE POLICIES ARE PURE ATTACK SURFACE
-- Every repository call in `apps/api` runs on SUPABASE_SERVICE_KEY
-- (`apps/api/src/config/supabase.ts`, `apps/api/src/shared/repositories/
-- baseRepository.ts`), so RLS never applies to the API path — all API
-- authorisation is TypeScript, in the command services. And `apps/mobile` has
-- zero `supabase.from(` calls: its only Supabase client
-- (`apps/mobile/src/lib/supabase.ts`) is consumed solely by
-- `apps/mobile/src/store/auth.ts`, and every use is `supabase.auth.*`. All app
-- data travels over the REST API via `apps/mobile/src/api/client.ts`.
--
-- So nothing this product ships exercises the write policies below. The only
-- caller who can reach them is someone pointing PostgREST at the bundled anon
-- key with their own JWT — i.e. an attacker, by construction. Removing them is
-- a deletion, not a redesign, and it takes away no capability any client has.
--
-- F-B3-1 (S0) — ROLE ESCALATION VIA household_members
-- `"Parents can manage members"` was an unqualified `for update` on
-- `household_members` (009, repointed by 040). No column list, no column-level
-- revoke, no transition CHECK — 009's only CHECK constrains `role` to the
-- valid domain, and 'parent' is in that domain — and the sole trigger is
-- `set_household_members_updated_at`. A parent could therefore PATCH ANY
-- column on any membership row in their household: `status`, to remove the
-- owner; `user_id`, to repoint a membership at an arbitrary profile; and,
-- worst, `role` — to promote a nanny to parent.
--
-- The API then trusts that column. `householdMemberRepository
-- .findActiveMembership` returns the row verbatim and
-- `timesheetCommandService.assertWriteMember` gates on
-- `WRITE_ROLES.has(membership.role)`. The escalated carer goes on to approve
-- her own timesheet and freeze her own `gross_minor` — she can approve her own
-- pay, with no second person involved anywhere in the flow. That is the whole
-- separation-of-duties model of this schema, defeated by one PATCH.
--
-- F-B3-2 (S1) — DIRECT SCHEDULE WRITES
-- `"Parents can write shifts"` (015) and the pattern-table policies (014) are
-- `for all`, which is easy to misread as a read policy: `for all` covers
-- INSERT, UPDATE and DELETE too. 015's own header says "Writes go through the
-- API under the service role" while the policy underneath it said otherwise.
-- These bypass `shiftCommandService` entirely — the co-parent approval gate,
-- the audited RPCs, the shift_events trail — none of which exist in the
-- database's own constraints, because they were never meant to have to.
--
-- WIDENED BEYOND THE TWO FINDINGS
-- The same open shape appears on `households`, `household_invites` (a parent
-- could rewrite a pending invite's `role` before it was redeemed),
-- `shift_children`, `schedule_pattern_days` and
-- `schedule_pattern_day_children`. All are dropped here as well: leaving a
-- known-identical hole open next to a closed one is how the closed one gets
-- quietly reopened later by someone copying the neighbour.
--
-- THE TARGET SHAPE — select-only RLS
-- Copied from the money tables, which already do this correctly:
-- `041_pay_arrangements.sql` and `044_expenses.sql` each enable RLS, declare
-- exactly ONE `for select` policy, and declare no write policy at all. 044's
-- header states the rule and its motivating example — a carer self-approving
-- her own money — in terms that apply here without modification. After this
-- migration all eight tables below have that shape.
--
-- RLS STAYS ON. That is load-bearing: "no policy" only means "deny" while row
-- level security is enabled. A table with RLS disabled and zero policies is
-- world-writable through PostgREST — the exact inverse of this file's intent.
-- 009, 014 and 015 already enabled it on all eight tables and nothing here
-- turns it off.
--
-- GRANTS: none issued, none revoked — the 041 grant model. This repo relies on
-- Supabase's stock privileges to anon/authenticated and controls access purely
-- through policies, except where a migration explicitly revokes (004, 005,
-- 006). Dropping the policy is the whole mechanism.
--
-- READS ARE UNTOUCHED. There is no SELECT policy change in this migration, on
-- these tables or anywhere else. Only write policies come out.

-- ---------------------------------------------------------------------------
-- 009_households.sql — households, household_members, household_invites
-- ---------------------------------------------------------------------------

-- F-B3-1 (S0). The escalation path itself. Membership changes — invite,
-- accept, change role, deactivate — belong to the API, which owns the
-- invariants the database cannot see: that a household keeps at least one
-- active parent, and that nobody edits their own role.
drop policy if exists "Parents can manage members" on public.household_members;

-- Renaming a household is an API write like any other; there is no reason for
-- a second path to it that skips the service layer.
drop policy if exists "Parents can update their household" on public.households;

-- An open `for update` here let a parent rewrite a PENDING invite's `role`,
-- so the row the redeemer accepted was not the row the household created.
drop policy if exists "Parents can manage invites" on public.household_invites;

-- ---------------------------------------------------------------------------
-- 014_schedule_patterns.sql — patterns and its two child tables
-- ---------------------------------------------------------------------------

drop policy if exists "Parents can insert patterns" on public.schedule_patterns;
drop policy if exists "Parents can update patterns" on public.schedule_patterns;
drop policy if exists "Parents can delete patterns" on public.schedule_patterns;

drop policy if exists "Parents can write pattern days" on public.schedule_pattern_days;

drop policy if exists "Parents can write pattern day children" on public.schedule_pattern_day_children;

-- ---------------------------------------------------------------------------
-- 015_shifts.sql — shifts and shift_children
-- ---------------------------------------------------------------------------

-- F-B3-2 (S1). Both are `for all`, so both carried INSERT/UPDATE/DELETE.
drop policy if exists "Parents can write shifts" on public.shifts;

drop policy if exists "Parents can write shift children" on public.shift_children;
