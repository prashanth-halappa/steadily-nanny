-- 078 Daily overtime, double time, and the seventh consecutive day
--
-- Five nullable columns on 041's `public.pay_arrangements`. No new table, no
-- new policy — 041's select-only RLS already scopes this row to the parents
-- and the carer herself, and more terms on a row a member could already see
-- needs no new predicate.
--
-- WHY THESE COLUMNS EXIST
-- 041 shipped ONE overtime tier: a weekly threshold and a multiplier. 041's
-- own header already anticipated this migration —
--
--   "V1 ships a weekly threshold + multiplier deliberately: US state rules
--    (CA daily overtime and friends) become presets that POPULATE these
--    fields later, so nothing anywhere hardcodes 40 hours."
--
-- — and this is that migration. A daily 8h/12h rule and a seventh-consecutive-
-- day rule were simply inexpressible before it (playbook §2.4 blocker 2, §2b
-- T2). Every one of these columns is a NUMBER on the arrangement, never a
-- rule baked into the engine: the engine reads thresholds and multipliers off
-- the row, and a jurisdiction preset is a data file that POPULATES them
-- (`packages/shared-types/src/payTermsPresets.ts`). Nothing here, and nothing
-- in the engine, hardcodes 8 hours any more than 041 hardcoded 40.
--
-- NULL MEANS AN EXPLICIT NO, EVERYWHERE (playbook §2.9)
--   overtime_daily_threshold_minutes    null = no daily overtime tier
--   doubletime_daily_threshold_minutes  null = no daily double-time tier
--   doubletime_multiplier               null = no double time at all
--   seventh_day_multiplier              null = no seventh-day rule
--   seventh_day_doubletime_after_minutes null = seventh day is single-tier
-- A pre-078 arrangement therefore reads, correctly and silently, as "weekly
-- overtime only" — exactly the terms it was agreed under. That is the whole
-- backward-compatibility story: no backfill, no default, no grandfathering
-- (§5 D-9 — the app is pre-launch).
--
-- WHY THE SEVENTH DAY IS NOT A BOOLEAN
-- `docs/design/screens-pay-terms.md` §3 (owner decision D2) settled this:
-- California's seventh consecutive day is TWO tiers — the first 8 hours at
-- 1.5x and everything beyond 8 hours at 2x. A boolean can only say "on",
-- which would have priced a long seventh day at a flat 1.5x and underpaid it
-- in the one state the preset library exists for. So the seventh day gets the
-- same three-value shape as the daily tiers — a multiplier, a second-tier
-- threshold, and the shared `doubletime_multiplier` for that second tier —
-- and the engine implements ONE pattern rather than two.
--
-- WHY `doubletime_multiplier` IS SHARED
-- It is the rate of the top tier, whether that tier is reached by working a
-- 13-hour Tuesday or by working a seventh day. Two columns holding the same
-- number is two columns that eventually disagree, and a nanny reading "2x"
-- on one row and "1.75x" on another for the same week would be reading a
-- defect. Hence the pairing checks below: any tier that PAYS double time
-- requires the multiplier to exist.
--
-- ORDERING IS A CONSTRAINT, NOT A CONVENTION
-- `doubletime_daily_threshold_minutes > overtime_daily_threshold_minutes`
-- when both are set. Inverted thresholds are not a preference the engine
-- should quietly resolve — "double time after 6h, overtime after 8h" is
-- either a typo or a term nobody meant, and the house rule is refuse, never
-- clamp (playbook §2.9). Postgres is the last place that can still say no.
--
-- NULLS AND CHECKS (the 063 note, restated because it applies to all five)
-- A CHECK only fails when its expression evaluates to FALSE. `null > 0` is
-- NULL, not FALSE, so every plain comparison below already lets its own NULL
-- through with no `is null or` guard. The guards that ARE written below are
-- the cross-column ones, where a NULL on one side must not silently pass a
-- rule about the other.
--
-- DEPLOY RISK: none. Adding a nullable column with no default rewrites no
-- rows, and every constraint here is vacuously true for every existing row
-- (all five columns are null on all of them).

alter table public.pay_arrangements
  add column if not exists overtime_daily_threshold_minutes integer;

alter table public.pay_arrangements
  add column if not exists doubletime_daily_threshold_minutes integer;

alter table public.pay_arrangements
  add column if not exists doubletime_multiplier numeric(3, 2);

alter table public.pay_arrangements
  add column if not exists seventh_day_multiplier numeric(3, 2);

alter table public.pay_arrangements
  add column if not exists seventh_day_doubletime_after_minutes integer;

-- --------------------------------------------------------------------------
-- Domain floors — the same shapes 041 gave the weekly pair.
-- --------------------------------------------------------------------------

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_overtime_daily_threshold_positive;

alter table public.pay_arrangements
  add constraint pay_arrangements_overtime_daily_threshold_positive
  check (overtime_daily_threshold_minutes > 0);

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_doubletime_daily_threshold_positive;

alter table public.pay_arrangements
  add constraint pay_arrangements_doubletime_daily_threshold_positive
  check (doubletime_daily_threshold_minutes > 0);

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_doubletime_multiplier_min;

alter table public.pay_arrangements
  add constraint pay_arrangements_doubletime_multiplier_min
  check (doubletime_multiplier >= 1);

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_seventh_day_multiplier_min;

alter table public.pay_arrangements
  add constraint pay_arrangements_seventh_day_multiplier_min
  check (seventh_day_multiplier >= 1);

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_seventh_day_doubletime_after_positive;

alter table public.pay_arrangements
  add constraint pay_arrangements_seventh_day_doubletime_after_positive
  check (seventh_day_doubletime_after_minutes > 0);

-- --------------------------------------------------------------------------
-- Cross-column rules — see the header. A tier that pays double time must have
-- a double-time multiplier to pay it at, and the daily tiers must be ordered.
-- --------------------------------------------------------------------------

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_daily_tiers_ordered;

alter table public.pay_arrangements
  add constraint pay_arrangements_daily_tiers_ordered
  check (
    doubletime_daily_threshold_minutes is null
    or overtime_daily_threshold_minutes is null
    or doubletime_daily_threshold_minutes > overtime_daily_threshold_minutes
  );

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_doubletime_daily_needs_multiplier;

alter table public.pay_arrangements
  add constraint pay_arrangements_doubletime_daily_needs_multiplier
  check (
    doubletime_daily_threshold_minutes is null
    or doubletime_multiplier is not null
  );

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_seventh_day_second_tier_needs_multiplier;

alter table public.pay_arrangements
  add constraint pay_arrangements_seventh_day_second_tier_needs_multiplier
  check (
    seventh_day_doubletime_after_minutes is null
    or (
      seventh_day_multiplier is not null
      and doubletime_multiplier is not null
    )
  );
