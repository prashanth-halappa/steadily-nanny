-- 044 Expenses & mileage — carer-submitted reimbursements, reviewed by parents
--
-- The third money table (after 041 pay_arrangements, 043 pto_ledger) and the
-- first one that is genuinely MUTABLE: a row starts `pending` and a parent
-- moves it to `approved` or `rejected` — review is the only mutation this
-- table ever undergoes. That single difference is why, UNLIKE 041 and 043,
-- this table keeps `updated_at` and the `set_updated_at` trigger (017/035's
-- shape) instead of the append-only no-trigger contract those two pin.
-- Binding sources: TIER0-PLAN.md Phase 4, "Independent review — folded in"
-- findings 1/3/7/18, and docs/11-MONEY.md §6, §8, §9.
--
-- REIMBURSEMENTS ARE NOT WAGES (docs/11-MONEY.md §6)
-- Expenses and mileage are excluded from gross pay and from the overtime
-- calculation entirely: no `regular`/`overtime`/`cancellation_paid`/
-- `guaranteed_topup`/`pto` line in the earnings engine ever includes a
-- reimbursement penny. They appear on the weekly statement as their own,
-- separately-summed reimbursement section. This matches how payroll and tax
-- treat the two categories — wages are earned income; a reimbursement pays
-- back money the carer already spent on the family's behalf.
--
-- MILEAGE IS COMPUTED AT APPROVAL, NOT AT SUBMISSION
-- A mileage row is submitted with `miles` only; `amount_minor` stays null
-- until a parent approves it. The approval write is what computes the
-- amount — miles x the arrangement's `mileage_rate_per_mile_minor` effective
-- on `local_date` (via `payArrangementRepository.effectiveOn`, 041's rule) —
-- and the result is frozen into amount_minor at that moment, same discipline
-- as every other approved money figure in this schema (docs/11-MONEY.md §3).
-- This is exactly why the third check below exists: it DB-enforces "no indicative amount before approval" (spec §10.6)
-- — a pre-approval number would imply a rate that hasn't actually been
-- locked in and could still change before review happens.
--
-- WHY THE THREE CHECKS ARE IMPLICATIONS, NEVER EQUIVALENCES
-- (Independent review, finding 1 — a ship-blocker.) A first draft wrote the
-- column-to-kind relationship as an EQUIVALENCE:
--   (kind = 'expense') = (amount_minor is not null)
-- which reads "expense rows have an amount, mileage rows don't" — but that
-- also FORBIDS a kind='mileage' row from EVER holding a non-null
-- amount_minor, which is exactly what the approval write above does. Every
-- single mileage approval would violate its own row's constraint and 500.
-- The fix is three one-directional implications instead, each only
-- constraining the arm it names:
--   check (kind <> 'expense' or amount_minor is not null)
--     -- an expense row always has an amount; says nothing about mileage rows
--   check (kind <> 'mileage' or miles is not null)
--     -- a mileage row always has miles; says nothing about expense rows
--   check (kind <> 'mileage' or status = 'approved' or amount_minor is null)
--     -- a mileage row may only carry an amount once approved; the row this
--     -- lets through — approved mileage with amount_minor set — is exactly
--     -- the row the approval write produces
--
-- PENDING ROWS ARE EDITABLE/WITHDRAWABLE BY THEIR OWN CARER; REVIEWED ROWS
-- ARE IMMUTABLE (review finding 18)
-- While `status = 'pending'` the submitting carer may edit or hard-delete
-- (withdraw) her own row — service-gated to `carer_id = caller` and
-- `status = 'pending'`; nothing downstream references a pending row, so a
-- withdraw is a clean delete. Once a parent reviews it (approved or
-- rejected) the row is immutable; a mistake discovered after approval is
-- corrected through the parent's `manual_adjustment` escape hatch, never by
-- mutating this row.
--
-- RLS: SELECT-ONLY, EVEN THOUGH THIS IS THE ONE TIER 0 MONEY TABLE A CARER
-- ACTUALLY WRITES TO
-- Submitting her own expense makes a client-exercisable insert policy the
-- most tempting shortcut anywhere in this plan — and the independent
-- review's motivating example for the whole select-only stance (finding 3)
-- is this exact table: a carer-self insert policy would let a nanny insert
-- a row with `status = 'approved'` and an arbitrary `amount_minor` directly,
-- self-approving her own money with no parent involved, no membership
-- check, no currency check, nothing. So this table follows the house
-- pattern for API-mediated money tables (041, 043): one SELECT policy, and
-- NO insert/update/delete policy of any kind. The carer writes through the
-- API like every other mutation in this app — the service enforces
-- carer-role + household membership (D12-class assertion), `status =
-- 'pending'` on create, and that the currency matches the effective
-- arrangement's currency. RLS here is the backstop against a misbehaving
-- client, not the check itself (docs/11-MONEY.md §8-9).
--
-- WHO MAY READ: parents and owners, plus the carer reading her own rows —
-- the same shape as 041/043, copied verbatim, not `can_read_household`
-- (every active member, which would hand a helper or a second nanny
-- someone else's money — Phase 1 review finding 2). Helpers and other carers are denied.
-- `private.can_write_household` is called BARE, never
-- `(select ...)`-wrapped (040's trap 2: the initplan optimisation lives
-- inside the helper, and a helper taking a per-row household_id cannot be
-- hoisted into an initplan anyway); the `carer_id = (select auth.uid())`
-- self-arm keeps 018's `(select ...)` form, where the sub-select IS the
-- optimisation (auth.uid() takes no per-row argument, so it hoists into a
-- once-per-scan initplan).
--
-- 033 DISCIPLINE
-- `carer_id` and `reviewed_by` -> user_profiles(user_id) on delete set
-- null, never cascade: a carer or a reviewing parent deleting their account
-- must not delete the household's expense/reimbursement history — that
-- record belongs to both parties. `carer_display_name` is snapshotted at
-- insert (review finding 7, same as 041/043) so the row stays legible after
-- the carer's profile is gone.

create table if not exists public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households(id)
                         on delete cascade,
  carer_id            uuid references public.user_profiles(user_id)
                         on delete set null,
  local_date          date not null,
  -- expense   a flat amount entered directly by the carer
  -- mileage   miles driven; amount_minor is priced at approval, see header
  kind                text not null check (kind in ('expense', 'mileage')),
  description         text not null,
  -- Nullable at the column level on purpose: whether it must be set, and
  -- when, is entirely conditional on kind/status — see the three checks
  -- below, which are the real constraint, never an unconditional not null.
  amount_minor        integer check (amount_minor >= 0),
  miles               numeric(6,1) check (miles > 0),
  currency            char(3) not null default 'GBP'
                         check (currency ~ '^[A-Z]{3}$'),
  status              text not null default 'pending'
                         check (status in ('pending', 'approved', 'rejected')),
  reviewed_by         uuid references public.user_profiles(user_id)
                         on delete set null,
  reviewed_at         timestamptz,
  review_note         text,
  -- Snapshot at insert (033 discipline, review finding 7).
  carer_display_name  text not null,
  created_at          timestamptz not null default now(),
  -- UNLIKE 041/043: this table is genuinely mutated by review, so it keeps
  -- updated_at + the set_updated_at trigger below (017/035's shape).
  updated_at          timestamptz not null default now(),
  -- The three implications from the header — pinned there verbatim, kept
  -- here in the same order. Each only constrains the arm it names; none of
  -- them is a two-directional equivalence.
  constraint expenses_expense_has_amount
    check (kind <> 'expense' or amount_minor is not null),
  constraint expenses_mileage_has_miles
    check (kind <> 'mileage' or miles is not null),
  constraint expenses_mileage_amount_after_approval
    check (kind <> 'mileage' or status = 'approved' or amount_minor is null)
);

-- Query patterns the query service needs: a household's week / reimbursement
-- section (household_id, local_date), and a carer's own list plus the
-- parent-facing "pending expenses" row (carer_id, status).
create index if not exists expenses_household_date_idx
  on public.expenses (household_id, local_date);

create index if not exists expenses_carer_status_idx
  on public.expenses (carer_id, status);

comment on table public.expenses is
  'Carer-submitted expense/mileage reimbursement claims, reviewed by parents. Mutable (pending -> approved/rejected); mileage amount is computed and frozen at approval. Reimbursements are not wages — excluded from gross pay and overtime.';

-- ---------------------------------------------------------------------------
-- RLS — select-only, service-role writes (see header for the full argument)
-- ---------------------------------------------------------------------------

alter table public.expenses enable row level security;

drop policy if exists "Parents and the carer can view expenses" on public.expenses;
create policy "Parents and the carer can view expenses" on public.expenses
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );

-- No insert/update/delete policy of any kind — see the header's RLS section.
-- Writes (create/edit/withdraw/approve/reject) all go through the API under
-- the service role.

-- ---------------------------------------------------------------------------
-- updated_at trigger — mutable table, unlike 041/043
-- ---------------------------------------------------------------------------

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();
