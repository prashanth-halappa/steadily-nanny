-- 075 Household week start
--
-- One column on the already-existing `public.households` table (009): which
-- day a pay week begins on for this family. No new table, no new policy —
-- the existing household RLS (009) already scopes every read/write on this
-- table to a member.
--
-- WHY PER-HOUSEHOLD, NOT PER-USER
-- `user_profiles.week_starts_on` (011_availability.sql) already exists, but
-- it answers a different question: which day THAT PERSON's calendar display
-- starts on (presentation only — `lib/weekdayOrder.ts`). This column answers
-- a household-level, legally-anchored question instead — where a FIXED
-- WORKWEEK begins for FLSA overtime purposes (29 CFR 778.105: a fixed and
-- regularly recurring 168-hour period, set by the employer, not the
-- individual). Two nannies working the same household must be priced
-- against the same week boundary, so the value has to live on the
-- household, not on either of them.
--
-- 0=Sunday..6=Saturday, matching Postgres `extract(dow)` — the identical
-- convention `user_profiles.week_starts_on` already uses, so both columns
-- read the same way despite answering different questions.
--
-- STORAGE ONLY, FOR NOW
-- Nothing in the engine reads this yet — `timesheets.week_start` and every
-- pay/overtime calculation still derive their week boundary elsewhere. This
-- column becomes the engine's actual source of truth in a later slice, once
-- the read side is threaded through; landing the column now avoids a second
-- migration + onboarding round-trip when that slice ships.

alter table public.households
  add column if not exists week_starts_on smallint not null default 1
    check (week_starts_on between 0 and 6);
