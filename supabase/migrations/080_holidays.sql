-- 080 The holiday calendar, and what a worked holiday pays
--
-- APPLIED TO PROD 2026-08-12 (Phase 6) via Supabase MCP `apply_migration`,
-- in order with the rest of the 074→096 chain — never `supabase db push`
-- (version-scheme mismatch). Live tip after apply:
-- `redeem_draft_invite_week_starts_on`. Do not re-apply.

-- WHY THIS MIGRATION EXISTS (§5 D-12, gap T6)
-- A paid holiday was only fakeable as PTO, and a worked holiday paid the
-- ordinary rate with no way to say otherwise. D-12: "Holiday calendar in:
-- household list seeded from the federal set, per-family toggles, optional
-- worked-holiday premium multiplier", owner note: "all these should be
-- configurable by the parent."
--
-- TWO PIECES, TWO HOMES — and `docs/design/screens-pay-terms.md` §3/§4.3
-- picks both, verbatim: "The list is household-level; the premium multiplier
-- is on the arrangement (it is a term of *her* employment, and a second carer
-- may have a different one)."
--   1. `public.household_holidays` — the family's calendar. One list, every
--      carer, one row per (household, holiday_key).
--   2. `pay_arrangements.worked_holiday_multiplier` — this carer's premium.
--      Null = a worked holiday pays the normal rate.
--
-- WHY A KEY AND NOT A DATE
-- Six of the eleven federal holidays have no fixed date — "the third Monday
-- in January" is a rule, and Memorial Day is the LAST Monday in May, which is
-- the fourth in most years and the fifth in 2027. Storing dates would be
-- eleven rows a year, per household, forever, AND a second copy of a rule
-- that already lives in `packages/shared-types/src/usFederalHolidays.ts` and
-- is free to disagree with it. The row stores the toggle; the date is
-- resolved at pricing time for the year the week falls in.
--
-- ABSENT MEANS NOT OBSERVED
-- Three states, not two: no row = nothing agreed; `observed = true` = the
-- family treats the day as a holiday; `observed = false` = the family
-- explicitly opted it out. That is the null-is-an-explicit-no rule (§2.9)
-- applied to a row set, and it is the safe direction — reading absence as
-- "observed" would have every household predating this migration silently
-- start paying a premium on eleven dates nobody chose. No backfill (§5 D-9:
-- the app is pre-launch and every account is wiped in Phase 6).
--
-- WHY THE SEED IS NOT A TRIGGER, AND WHY THIS FILE ADDS NO FUNCTION
-- New households are seeded with the federal set at creation, so a parent
-- opening the Holidays group for the first time sees the list all switched
-- on (spec §4.3). That seed is ONE insert in `householdCommandService.create`,
-- off the TypeScript key list the engine and the terms screen already share.
-- A SQL trigger would need a second copy of those eleven keys inside this
-- file, and two lists of eleven keys are two lists that eventually disagree.
-- Because nothing here is a function, GOLDEN-FIXES #16's `revoke ... from
-- public` has no surface to apply to — a deliberate absence, pinned by a test.
--
-- DEPLOY RISK: none. One new table with no dependents, and one nullable
-- column with no default on `pay_arrangements` (adding it rewrites no rows,
-- and its CHECK is vacuously true for every existing row).

-- --------------------------------------------------------------------------
-- 1. The family's calendar.
-- --------------------------------------------------------------------------

create table if not exists public.household_holidays (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  -- A key from `usFederalHolidays.ts` ('independence_day', 'memorial_day',
  -- …), never a date. Deliberately NOT a check-constrained enum: the list is
  -- versioned in TypeScript, and a CHECK here would mean shipping a migration
  -- to add a state holiday. The wire schema is the gate that keeps an
  -- unresolvable key out (`householdHoliday.schema.ts` refuses one on WRITE
  -- while tolerating one on READ).
  holiday_key   text not null,
  -- True = this family treats the day as a holiday, so a worked-holiday
  -- premium applies to hours worked on it. False = explicitly opted out.
  observed      boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Two rows for one day would be two contradictory answers to "does this
  -- family observe it", and the engine would have to pick one.
  unique (household_id, holiday_key)
);

comment on table public.household_holidays is
  'Which federal holidays THIS household observes (D-12). One row per (household, holiday_key); the DATE is a rule resolved per year by usFederalHolidays.ts, never stored. No row = nothing agreed.';

-- The unique constraint's index already serves the only query there is
-- ("this household's toggles"), so no second index is created here.

alter table public.household_holidays enable row level security;

-- Read: any active household member. What the family observes is a term of
-- the nanny's employment and she is entitled to see it — spec §2, "there is
-- one terms document and both people read the same one".
drop policy if exists "Members can view household holidays" on public.household_holidays;
create policy "Members can view household holidays" on public.household_holidays
  for select using (private.is_household_member(household_id));

-- Write: owner/parent only, the same shape as 035's closures. D-12's owner
-- note is "configurable by the parent"; the nanny reads and, from 3-O, may
-- PROPOSE terms — a proposal is not a write to this table.
drop policy if exists "Parents can insert household holidays" on public.household_holidays;
create policy "Parents can insert household holidays" on public.household_holidays
  for insert with check (private.is_household_parent(household_id));

drop policy if exists "Parents can update household holidays" on public.household_holidays;
create policy "Parents can update household holidays" on public.household_holidays
  for update using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

drop policy if exists "Parents can delete household holidays" on public.household_holidays;
create policy "Parents can delete household holidays" on public.household_holidays
  for delete using (private.is_household_parent(household_id));

drop trigger if exists set_household_holidays_updated_at on public.household_holidays;
create trigger set_household_holidays_updated_at
  before update on public.household_holidays
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 2. What a worked holiday pays, on 041's `public.pay_arrangements`.
--
-- No new policy — 041's select-only RLS already scopes this row to the
-- parents and the carer herself, and one more term on a row a member could
-- already see needs no new predicate (the 078 note, restated).
--
-- NULL MEANS AN EXPLICIT NO (§2.9): a worked holiday pays the normal rate.
-- That is the screen's own copy ("Leave blank if a worked holiday pays the
-- normal rate", spec §4.3), and it is why there is no default here — a
-- default of 1.5 would promise every family a premium nobody agreed to,
-- which is the exact liability D-7's preset posture exists to avoid.
-- --------------------------------------------------------------------------

alter table public.pay_arrangements
  add column if not exists worked_holiday_multiplier numeric(3, 2);

-- House pattern (053/055/063/064/068/078): drop-if-exists then add, so the
-- migration is re-runnable and `db reset` never dies on the second pass.
alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_worked_holiday_multiplier_min;

-- A "premium" below 1 would pay LESS for working a holiday, which is either a
-- typo or a term nobody meant. Refuse, never clamp (§2.9) — Postgres is the
-- last place that can still say no. A plain comparison already lets NULL
-- through: `null >= 1` is NULL, not FALSE, and a CHECK only fails on FALSE.
alter table public.pay_arrangements
  add constraint pay_arrangements_worked_holiday_multiplier_min
  check (worked_holiday_multiplier >= 1);

comment on column public.pay_arrangements.worked_holiday_multiplier is
  'What hours WORKED on a household-observed holiday pay, as a multiple of rate_minor (D-12). Null = the normal rate, an explicit no. The engine emits the premium as an INCREMENT line (rate x (multiplier - 1)) on top of whatever tier the hour already priced at — it never re-prices the hour.';
