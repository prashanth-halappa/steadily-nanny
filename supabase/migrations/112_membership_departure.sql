-- ---------------------------------------------------------------------------
-- 112_membership_departure.sql — a third way a membership ends, and the two
-- facts a card needs to report it
--
-- NOT yet applied to prod. Apply via the Supabase MCP `apply_migration` in
-- order after 111 — never `supabase db push` (version-scheme mismatch; see
-- 092's header and the note in docs/ROLLBACK-RUNBOOK.md).
--
-- Wire: packages/shared-types/src/schemas/household.schema.ts
--         (`MEMBERSHIP_ENDED_REASONS.LEFT`, `HouseholdMemberSchema`)
-- Write: apps/api/src/domains/household/services/householdCommandService.ts
--          (`leave` -> 'left', `removeMember` -> 'removed_by_parent')
--        apps/api/src/domains/user/services/userService.ts
--          (`closeHouseholdWithoutWriters` -> 'household_closed')
-- Read:  apps/api/src/domains/household/repositories/householdMemberRepository.ts
--          (`listDepartedSince` — the parent's departure card)
--
-- =========================================================================
-- THE GAP
-- =========================================================================
--
-- 110 named two ways a membership ends: the household closed under her, or a
-- parent removed her. There is a third, and until now it has been invisible:
-- SHE LEFT. `leave()` flips the row and stamps nothing, so a self-departure is
-- indistinguishable from a row written before 110 existed — both are null, and
-- 110's own header says null must render as "we don't know".
--
-- That was tolerable while nothing read the column. It stops being tolerable
-- the moment the FAMILY is told: a card that says "Priya left your household"
-- must never appear because a parent removed her, and a card at all must never
-- be shown to the person who caused it. Neither fact is currently recorded.
--
-- =========================================================================
-- SHAPE
-- =========================================================================
--
-- Three additions, all nullable, no backfill. Every membership that already
-- ended keeps null across all three, which reads correctly everywhere: no
-- reason we can vouch for, no departure instant, and therefore no card. Old
-- departures stay quiet, which is what we want — nobody should open the app
-- after this ships and be told about someone who left last year.
--
--   ended_reason  widened to add 'left'. A POSITIVE `check (... in (...))`
--                 list, like 110's and like every other status/role
--                 constraint in this schema. MATCHED PAIR with
--                 MEMBERSHIP_ENDED_REASONS — the two only ever change
--                 together, in one migration plus one shared-types change.
--
--   ended_at      WHEN it ended. Deliberately NOT `updated_at`: that column is
--                 maintained by `set_household_members_updated_at` (009) on
--                 every write, so a later touch to a removed row — a display
--                 name edit, a backfill, anything — would silently make a
--                 year-old departure look like it happened today and put the
--                 card back on the parent's screen. The mirror event on the
--                 joining side gates on a real `joined_at` column for exactly
--                 this reason; this is its opposite number.
--
--   ended_by      WHO ended it. `on delete set null`, matching every other
--                 actor column in this schema (`approved_by` in 017,
--                 `created_by` in 014/015/035). This is what lets a read
--                 exclude the person who acted: telling a parent that they
--                 removed someone is noise, and telling the leaver that she
--                 left is worse.
--
-- No index on any of them. The departure read is `(household_id, status)`
-- filtered and then narrowed in memory over a household's handful of rows;
-- an index on a nullable column with two non-null values per household per
-- year would never be chosen.
-- ---------------------------------------------------------------------------

alter table public.household_members
  drop constraint if exists household_members_ended_reason_check;

alter table public.household_members
  add constraint household_members_ended_reason_check
  check (ended_reason is null or ended_reason in ('household_closed', 'removed_by_parent', 'left'));

alter table public.household_members
  add column if not exists ended_at timestamptz;

alter table public.household_members
  add column if not exists ended_by uuid
    references public.user_profiles(user_id) on delete set null;

comment on column public.household_members.ended_reason is
  'household_closed | removed_by_parent | left | null. WHY this membership ended, stamped alongside the status flip so a reader who missed the `membership_ended` push can still be told which happened. null means unknown (every row that predates 110, and every membership that has not ended) — render the neutral wording, never "removed by a parent". Says nothing about pay: whether she is owed anything is the payroll record''s answer, not this column''s.';

comment on column public.household_members.ended_at is
  'WHEN this membership ended, stamped alongside the status flip. null for every row that predates 112 and for every membership still live. Not derivable from updated_at, which the 009 trigger bumps on any write and would therefore resurrect a stale departure card. Consumers window on this (the parent-side departure card shows 7 days); nothing filters on it in SQL.';

comment on column public.household_members.ended_by is
  'WHO ended this membership: the parent who removed them, the member who left (themselves), or the departing owner whose account closure took the household down. null for every row that predates 112 and whenever the actor''s profile has since been deleted. Read only to EXCLUDE the actor from being told about their own action — never to attribute a removal to a named parent in copy.';
