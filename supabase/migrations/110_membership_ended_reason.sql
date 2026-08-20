-- ---------------------------------------------------------------------------
-- 110_membership_ended_reason.sql — why a membership ended (Phase 2, the notice)
--
-- NOT yet applied to prod. Apply via the Supabase MCP `apply_migration` in
-- order after 109 — never `supabase db push` (version-scheme mismatch; see
-- 092's header and the note in docs/ROLLBACK-RUNBOOK.md).
--
-- Wire: packages/shared-types/src/schemas/household.schema.ts
--         (`HouseholdMemberSchema.ended_reason`)
--       packages/shared-types/src/schemas/notification.schema.ts
--         (`MEMBERSHIP_ENDED` — the push that carries the same fact)
-- Write: apps/api/src/domains/user/services/userService.ts
--          (`closeHouseholdWithoutWriters` -> 'household_closed')
--        apps/api/src/domains/household/services/householdCommandService.ts
--          (`removeMember` -> 'removed_by_parent')
--
-- =========================================================================
-- THE GAP
-- =========================================================================
--
-- A membership ends two ways that mean opposite things to the person it
-- happens to:
--
--   1. THE HOUSEHOLD CLOSED UNDER HER. The last parent deleted their account,
--      so `userService.closeHouseholdWithoutWriters` flips every remaining
--      membership to `removed`. Nobody removed her; the family is gone.
--   2. A PARENT REMOVED HER. Somebody made a decision about her.
--
-- `status = 'removed'` records that it ended and says nothing about which. The
-- push (`membership_ended`) carries the reason in its payload, but a push is
-- delivered once, to a device that may be off, to a person who may open the
-- app three days later — and then the Today card has no way to tell the two
-- apart and has to fall back on neutral wording forever. This column is the
-- fact at READ time.
--
-- =========================================================================
-- SHAPE
-- =========================================================================
--
-- NULLABLE, and null is the honest answer for every row written before today:
-- backfilling a guess would be inventing a reason for a decision nobody
-- recorded. Readers must treat null as "we don't know" and use the neutral
-- copy — never as "removed by a parent".
--
-- A POSITIVE `check (... in (...))` list, like every other status/role
-- constraint in this schema (009's role/status checks, 093's widened status).
-- The constraint is `not valid`-free because the column is new: no existing
-- row can violate it, and null passes a `check` regardless.
--
-- No index: nothing filters on it. Every read that reaches it has already
-- found the row by `(household_id, user_id)` or by `id`.
-- ---------------------------------------------------------------------------

alter table public.household_members
  add column if not exists ended_reason text;

alter table public.household_members
  drop constraint if exists household_members_ended_reason_check;

alter table public.household_members
  add constraint household_members_ended_reason_check
  check (ended_reason is null or ended_reason in ('household_closed', 'removed_by_parent'));

comment on column public.household_members.ended_reason is
  'household_closed | removed_by_parent | null. WHY this membership ended, stamped alongside the status flip so a reader who missed the `membership_ended` push can still be told which happened. null means unknown (every row that predates this column, and every membership that has not ended) — render the neutral wording, never "removed by a parent". Says nothing about pay: whether she is owed anything is the payroll record''s answer, not this column''s.';
