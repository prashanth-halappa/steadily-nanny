-- 082 Pay frequency + pay day — presentation only (D-17, T7 reversal)
--
-- REPO FILE ONLY — never applied to any environment as part of Phase 3 slice
-- 3-U3 (TRUST-AND-TERMS-PLAYBOOK.md §3). Phase 6 applies the rehearsed
-- migration chain via the Supabase MCP, in order, never `supabase db push`.
--
-- WHY THIS MIGRATION EXISTS (§5 D-17, gap T7)
-- T7 shipped nothing: "No pay frequency/pay day; the Monday week IS the pay
-- period." D-17 reverses that deferral — "frequency + pay-day on the
-- arrangement; weeks grouped into pay periods in presentation. FLSA OT
-- computation stays weekly regardless." Three nullable columns on 041's
-- `public.pay_arrangements`, exactly like 078/080 before them: no new table,
-- no new policy, because 041's select-only RLS already scopes this row to
-- the parents and the carer herself, and one more term on a row a member
-- could already see needs no new predicate.
--
-- PRESENTATION ONLY, NOT PRICING
-- `docs/design/screens-pay-terms.md` §4.3: "This is how weeks are grouped for
-- you to look at. Overtime is always figured week by week, whatever the pay
-- schedule." The earnings engine (`earningsService.ts`) never reads these
-- three columns — a fact pinned by a case in the engine's own test table
-- ("pricing ignores pay_frequency/pay_day") rather than left to convention.
--
-- NULL MEANS AN EXPLICIT NO, EVERYWHERE (playbook §2.9)
--   pay_frequency      null = no pay schedule stated
--   pay_day_of_week     null = not applicable / not stated (weekly, biweekly)
--   pay_day_of_month    null = not applicable / not stated (semimonthly, monthly)
-- A pre-082 arrangement therefore reads, correctly and silently, as "no pay
-- schedule stated" — the week CSV's `period_end` field is simply omitted for
-- it. No backfill, no default, no grandfathering (§5 D-9 — the app is
-- pre-launch).
--
-- WHY TWO DAY COLUMNS, NOT ONE
-- `docs/design/screens-pay-terms.md` §4.3's mock: weekly/biweekly pick a day
-- OF THE WEEK ("Pay day: Mon..Sun"); semimonthly/monthly pick a day OF THE
-- MONTH ("15 and last day"). One integer column would have to mean 0-6 in one
-- frequency and 1-31 in another, which is the "a number means two different
-- things depending on a sibling column" trap CHECK constraints exist to
-- catch. Two columns, each independently bounded, and the wire/service layer
-- decides which one a given `pay_frequency` reads (same division of labour as
-- 078's daily-tier pair).
--
-- SEMIMONTHLY'S SECOND CUTOFF IS NOT STORED
-- The mock shows "[ 15 ] and [ last day ]" — the SECOND cutoff is always the
-- calendar's own last day of the month, never a second typed value, so there
-- is nothing to store for it. `pay_day_of_month` carries only the FIRST
-- cutoff (default meaning "15" in the mock, but never defaulted here — see
-- the null-is-an-explicit-no rule above).
--
-- DEPLOY RISK: none. Three new nullable columns with no default on
-- `pay_arrangements` — adding them rewrites no rows, and every CHECK below is
-- vacuously true for a NULL.

alter table public.pay_arrangements
  add column if not exists pay_frequency text;

alter table public.pay_arrangements
  add column if not exists pay_day_of_week smallint;

alter table public.pay_arrangements
  add column if not exists pay_day_of_month smallint;

-- House pattern (053/055/063/064/068/078/080): drop-if-exists then add, so
-- the migration is re-runnable and `db reset` never dies on the second pass.
alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_pay_frequency_valid;
alter table public.pay_arrangements
  add constraint pay_arrangements_pay_frequency_valid
  check (pay_frequency is null or pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly'));

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_pay_day_of_week_range;
alter table public.pay_arrangements
  add constraint pay_arrangements_pay_day_of_week_range
  check (pay_day_of_week is null or pay_day_of_week between 0 and 6);

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_pay_day_of_month_range;
alter table public.pay_arrangements
  add constraint pay_arrangements_pay_day_of_month_range
  check (pay_day_of_month is null or pay_day_of_month between 1 and 31);

comment on column public.pay_arrangements.pay_frequency is
  'How often this family pays (D-17). PRESENTATION ONLY — the earnings engine never reads it; weeks are always priced and frozen one at a time, week by week. Null = no pay schedule stated.';
comment on column public.pay_arrangements.pay_day_of_week is
  '0=Sunday..6=Saturday. Read only when pay_frequency is weekly/biweekly; null otherwise. Presentation only, same as pay_frequency.';
comment on column public.pay_arrangements.pay_day_of_month is
  '1-31, the FIRST payday-of-month cutoff. Read only when pay_frequency is semimonthly/monthly; null otherwise. Semimonthly''s second cutoff is always the calendar''s own last day of the month and is never stored. Presentation only, same as pay_frequency.';
