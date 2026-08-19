-- 107 Household country, and custom holidays the family names themselves
--
-- Apply via the Supabase MCP `apply_migration`, in order after 106 — never
-- `supabase db push` (version-scheme mismatch; see 092's header and the note
-- in docs/ROLLBACK-RUNBOOK.md).

-- WHY THIS MIGRATION EXISTS
-- 080's calendar is a toggle over a TypeScript-versioned US federal key list.
-- Two things that list cannot say: which COUNTRY's public holidays this
-- household actually uses, and a day the family observes that is not on any
-- public list — a birthday, a culturally specific feast, a day of mourning.
-- This file adds both. It does not touch 080, 094 or 096; those are applied
-- to production and frozen.

-- --------------------------------------------------------------------------
-- 1. `public.households.country`
-- --------------------------------------------------------------------------
--
-- A shape-checked ISO-3166 alpha-2 (`char(2)` matching `^[A-Z]{2}$`), NOT an
-- enum CHECK of country codes. Same reasoning as `household_holidays.holiday_key`
-- having no CHECK enum: the valid list is versioned in TypeScript, and a CHECK
-- here would mean shipping a migration to add a country.
--
-- Default 'US', and NOT device-derived, because every existing household
-- already has 11 US federal holiday rows seeded (080, via
-- `householdCommandService.create`). A disagreeing default would orphan that
-- real data on migration day. No backfill is needed for the same reason —
-- existing rows already mean the United States.

-- --------------------------------------------------------------------------
-- 2. `public.household_custom_holidays`
-- --------------------------------------------------------------------------
--
-- WHY A DATES ARRAY RATHER THAN A ROW PER DATE
-- One row per custom day, keyed on (household, name), with a `dates date[]`
-- of the calendar days it falls on. A family that observes "Diwali" or
-- "Grandma's birthday" has ONE named day, which may land on different dates
-- across years or span consecutive days; the array keeps the name in one
-- place. A row per date would either duplicate the name (and then
-- `unique (household_id, name)` could not hold) or lose the grouping, so a
-- delete-to-opt-out could not remove the whole day in one write. Cap of 12
-- is a year of monthly observances, or a decade-plus of annual dates — enough,
-- and bounded so a client cannot park an unbounded array on the row.
--
-- WHY THERE IS NO `observed` COLUMN
-- 080 needed `observed` because the federal set is seeded and families toggle
-- a key off without deleting it. A custom holiday is opt-in by writing the
-- row: the row existing IS the observance. Delete to opt out, which also
-- means removing it actually removes the string — there is no `observed =
-- false` row left behind still naming the day.
--
-- CARDINALITY, NOT array_length. `cardinality('{}'::date[])` is 0, so a
-- CHECK of `between 1 and 12` fails the empty array. `array_length('{}', 1)`
-- is NULL, and a NULL CHECK PASSES, which would let an empty array through.
-- `date[] not null` is 010's `exdates` house style.
--
-- NO EXTRA INDEX. The unique constraint's index already serves the only
-- query there is ("this household's custom days").
--
-- RLS FOLLOWS 052, NOT 080. 080 predates the client-write lock and still
-- carries parent insert/update/delete policies. 052's current house posture
-- is: client write policies are dropped; the API writes on the service role.
-- This table enables row level security and has exactly ONE policy — members
-- can SELECT. No client insert, update, or delete policy at all.
--
-- PRIVACY NOTE
-- A custom holiday name can disclose religion. It is member-select-only,
-- service-role-write-only, and must never reach a payroll export.

-- --------------------------------------------------------------------------
-- 1. Country on the household.
-- --------------------------------------------------------------------------

alter table public.households add column if not exists country char(2) not null default 'US' check (country ~ '^[A-Z]{2}$');

-- --------------------------------------------------------------------------
-- 2. The family's named custom days.
-- --------------------------------------------------------------------------

create table if not exists public.household_custom_holidays (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  -- Trimmed 1–60 chars: empty and whitespace-only names are not names.
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  -- 010's `exdates` house style. cardinality, never array_length — see header.
  dates         date[] not null check (cardinality(dates) between 1 and 12),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Two rows for one name would be two lists of dates for the same day.
  unique (household_id, name)
);

alter table public.household_custom_holidays enable row level security;

-- Read: any active household member. Write: none — 052 posture; the API
-- writes on the service role.
drop policy if exists "Members can view household custom holidays"
  on public.household_custom_holidays;
create policy "Members can view household custom holidays"
  on public.household_custom_holidays
  for select using (private.is_household_member(household_id));

drop trigger if exists set_household_custom_holidays_updated_at
  on public.household_custom_holidays;
create trigger set_household_custom_holidays_updated_at
  before update on public.household_custom_holidays
  for each row execute function public.set_updated_at();
