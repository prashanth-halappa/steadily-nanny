-- 086 Reimbursement settlements — the repayment record (D-14, gap P7)
--
-- 044 gave a carer a way to CLAIM an expense and a parent a way to APPROVE it.
-- Nothing then recorded that the family actually handed the money back.
-- Marisol fronts £24.60 for craft supplies, the app agrees she is owed it, and
-- six weeks later neither side can say whether it was ever repaid. Money owed
-- and tracked nowhere is the shape every dispute in this product starts as.
--
-- REIMBURSEMENT SETTLEMENTS ARE **NOT PAYMENTS**. They are excluded from
-- gross, from payable minutes and from the payment ceiling
-- (`earningsService.ts`, the REIMBURSEMENTS branch of the line fold) because
-- they are the family repaying money she ALREADY SPENT, not wages. That is why
-- this is a separate table with no `timesheet_id`: the payments ledger is
-- bounded by a week's frozen gross, and a reimbursement has nothing to do with
-- that ceiling. DO NOT MERGE THESE TABLES, and do not sum them into
-- paid-to-date. A settled reimbursement and a recorded payment look like the
-- same shape — date, amount, note, who recorded it — and "why are there two
-- tables for money going to the same person" is the question that precedes the
-- merge. The answer is that one of them is wages and one of them is not, and
-- the day they share a ceiling the money engine is wrong in the direction
-- nobody notices until a nanny is underpaid.
--
-- WHAT A ROW IS. One row = the family repaid this carer's approved
-- reimbursements for one household-local week. The amount is the week's
-- approved total AT SETTLEMENT TIME, computed server-side from the approved
-- expense rows; the client sends no figure, so there is nothing to spoof and
-- no way to record a repayment for an amount nobody agreed. `settled_at` is a
-- calendar day for the same reason `payments.paid_at` is — the money moved on
-- a day, and there is no timezone to get wrong.
--
-- ONE SETTLEMENT PER CARER-WEEK, AND THE DATABASE SAYS SO.
-- Two parents tapping "Mark reimbursed" in the same instant is the same race
-- 077 closed for payments — but the invariant here is "at most one row", not
-- "a cross-row SUM under a ceiling", and at-most-one is precisely what a
-- unique index is for. No plpgsql function, no `for update`: the index refuses
-- the second insert and `reimbursementSettlementRepository` translates the
-- 23505 into a typed conflict, exactly as `expenseRepository.create` does with
-- 051's partial index. Reaching for a locked function here would be copying
-- 077's shape without 077's reason.
--
-- APPEND-ONLY, LIKE 041/043/067. No `updated_at`, no trigger, no update or
-- delete path in the service. NO CORRECTION MECHANISM IS BUILT — spec §4.2 is
-- explicit that this is YAGNI: the correction path exists one table over (085)
-- if a reimbursement ever needs unwinding, and copying it here before anyone
-- has needed it would double the surface for nothing. Stated so the absence is
-- a decision rather than an oversight.
--
-- LIFECYCLE (033 DISCIPLINE). `household_id` CASCADEs — a settlement is
-- meaningless without the household. `carer_id`/`recorded_by` are SET NULL,
-- never cascade: a carer or parent deleting their account must not delete the
-- household's record of having repaid her.
--
-- RLS: SELECT-ONLY, MONEY-TABLE READ CIRCLE (044/067 shape, verbatim).
-- Parents/owners plus the carer herself; helpers and other carers denied —
-- NOT `can_read_household`, which would hand a helper someone else's money
-- (041's header: a policy looser than the service is not belt-and-braces, it
-- is the hole the service was written to close). `private.can_write_household`
-- is called BARE (040 trap 2); the carer self-arm keeps 018's
-- `(select auth.uid())` initplan form. No insert/update/delete policy of any
-- kind — writes go through the API under the service role.

create table if not exists public.reimbursement_settlements (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id)
                  on delete cascade,
  carer_id      uuid references public.user_profiles(user_id)
                  on delete set null,
  -- The household-local first day of the week these claims fall in. A date,
  -- not a timesheet reference: expenses exist on weeks with no hours at all.
  week_start    date not null,
  -- Bounded on both sides: >= 1 because repaying nothing is not a repayment,
  -- <= the shared ceiling 063 pins on every other money column.
  amount_minor  integer not null
                  check (amount_minor >= 1 and amount_minor <= 99999999),
  currency      char(3) not null
                  check (currency ~ '^[A-Z]{3}$'),
  -- The calendar day the family says the money went back.
  settled_at    date not null,
  -- Optional free text ("Cash on Friday"). A note, not an enum.
  note          text,
  recorded_by   uuid references public.user_profiles(user_id)
                  on delete set null,
  created_at    timestamptz not null default now()
);

-- The double-tap guard AND the read path (the card asks "is this week
-- settled?" by exactly this key), in one index.
create unique index if not exists reimbursement_settlements_week_idx
  on public.reimbursement_settlements (household_id, carer_id, week_start);

comment on table public.reimbursement_settlements is
  'Append-only record that a household repaid one carer''s approved reimbursements for one household-local week. NOT payments: excluded from gross, payable minutes and the payment ceiling. Do not merge with public.payments.';

-- ---------------------------------------------------------------------------
-- RLS — select-only, service-role writes (see header for the full argument)
-- ---------------------------------------------------------------------------

alter table public.reimbursement_settlements enable row level security;

drop policy if exists "Parents and the carer can view settlements"
  on public.reimbursement_settlements;
create policy "Parents and the carer can view settlements"
  on public.reimbursement_settlements
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );
