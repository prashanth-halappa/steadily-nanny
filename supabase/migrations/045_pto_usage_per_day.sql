-- 045 PTO usage is recorded per DAY, not per time off
--
-- Binding sources: the Phase 3/4 adversarial review (finding 15b),
-- TIER0-PLAN.md Phase 3, docs/11-MONEY.md §5. Amends one index created by
-- 043_pto_ledger.sql; 043 itself is committed and is NOT edited.
--
-- WHAT WAS WRONG
-- 043 pinned "at most one usage row per time off per household" as the
-- partial unique index pto_ledger_one_usage_per_time_off_idx — the 039
-- pattern, and the right shape while a marking WAS a single row. The review
-- showed that single row is a defect: `markTimeOffPaid` wrote the whole
-- marking on the time off's START date, so a two-week holiday marked 80h
-- paid put all 4800 minutes in week one. Week one then priced an 80h PTO
-- line and an inflated gross, week two priced nothing, and approving week
-- one FROZE that split (docs/11-MONEY.md §3 — approved weeks never
-- recompute). The money was not lost, it was attributed to the wrong week,
-- which in a weekly-paid product is the same problem wearing a smaller hat.
--
-- WHAT CHANGES
-- The service now writes one usage row per covered day, so the uniqueness
-- guarantee moves to the grain the marking actually has:
-- (household_id, time_off_id, effective_date). Nothing else about the table
-- changes.
--
-- THE GUARANTEE IS NARROWED, NOT DROPPED
-- The old index existed so two concurrent "mark paid" taps could not
-- double-pay the same time off (043's header). They still cannot: two
-- concurrent taps compute the same covered-day set from the same time off,
-- so the loser still collides on the first day and still surfaces as
-- PtoAlreadyMarkedPaidError rather than a second set of usage rows. What the
-- new index additionally permits — several usage rows for one time off — is
-- exactly the fix, and each of those rows is still unique for its own day.
--
-- ADJUSTMENT ROWS STAY UNCONSTRAINED, DELIBERATELY
-- No unique index is added over kind = 'adjustment', here or ever, without
-- re-reading docs/11-MONEY.md §5: unlimited adjustment rows per
-- (household, time_off) are what make the mark-paid correction flow
-- (8h -> 6h -> 7h) and the netted reversal possible. An index that allowed
-- only one would make a mis-marked figure permanently uncorrectable in an
-- append-only ledger, which is the trap review finding 2 already sprang on
-- 041's arrangements.
--
-- ADDITIVE AND SAFE ON A LIVE TABLE
-- No column is dropped, no data is deleted or rewritten, and every row that
-- satisfied the old index satisfies the new one (the new key is a superset
-- of the old key's columns, so it is a strictly weaker constraint). Existing
-- single-row markings keep working untouched: they are simply markings whose
-- covered-day set had one member. Both statements are idempotent.

drop index if exists public.pto_ledger_one_usage_per_time_off_idx;

create unique index if not exists pto_ledger_one_usage_per_time_off_day_idx
  on public.pto_ledger (household_id, time_off_id, effective_date)
  where kind = 'usage';

comment on index public.pto_ledger_one_usage_per_time_off_day_idx is
  'At most one usage row per (household, time off, day). Replaces 043''s per-time-off index so a multi-day marking can record one row per covered day (review finding 15b) while two concurrent mark-paid taps still collide.';
