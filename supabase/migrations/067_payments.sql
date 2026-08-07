-- 067 Payments — the settlement ledger for approved weeks
--
-- The fourth money table (after 041 pay_arrangements, 043 pto_ledger,
-- 044 expenses) and the missing half of the pay loop: 042 freezes what a
-- week is WORTH at approval, but nothing recorded that it was PAID. "Have I
-- paid week 12?" was unanswerable for the parent who paid it and invisible
-- to the carer who was paid. One row here = one real-world payment (bank
-- transfer, cash) a parent RECORDS against an approved week's frozen gross.
-- Partial payments are allowed — several rows can settle one week.
--
-- APPEND-ONLY, LIKE 041/043 — NOT 044
-- A payment row is a fact about money that already moved outside the app,
-- not app state under review. Nothing ever mutates one: no updated_at, no
-- set_updated_at trigger, no update path in the service. A mistake is
-- prevented at write time (see below), never corrected by editing history.
--
-- THE OVER-PAYMENT GATE LIVES IN THE SERVICE, NOT A CHECK
-- The real invariant is sum(payments per timesheet) <= that week's frozen
-- gross_minor. A cross-row SUM cannot be a row CHECK constraint, so the
-- gate is `paymentCommandService.create`: it re-reads the timesheet (must
-- be status = 'approved'), sums existing rows, and REFUSES anything that
-- would exceed the frozen figure — refuses, never clamps, docs/11-MONEY.md
-- discipline. The per-row CHECK below only bounds a single amount to the
-- same ceiling 063 pinned on every other money column.
--
-- CURRENCY IS STAMPED, NEVER CHOSEN
-- The service copies the timesheet's frozen currency (042) into each row;
-- the wire's CreatePaymentSchema has no currency field. A payment can never
-- be recorded in a currency the week wasn't priced in.
--
-- LIFECYCLE (033 DISCIPLINE)
-- timesheet_id CASCADEs: a payment is meaningless without the week it
-- settles. carer_id / recorded_by -> user_profiles(user_id) ON DELETE SET
-- NULL, never cascade: a carer or parent deleting their account must not
-- delete the household's settlement record — that history belongs to both
-- parties, same as every money table since 033.
--
-- RLS: SELECT-ONLY, MONEY-TABLE READ CIRCLE (041/043/044 shape, verbatim)
-- Parents/owners plus the paid carer read; helpers and other carers are
-- denied — NOT can_read_household, which would hand a helper someone
-- else's money. No insert/update/delete policy of any kind: writes go
-- through the API under the service role, where the membership, role,
-- approved-status, and over-payment gates live (docs/11-MONEY.md §8-9).
-- `private.can_write_household` is called BARE (040 trap 2); the carer
-- self-arm keeps 018's `(select auth.uid())` initplan form.

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  timesheet_id  uuid not null references public.timesheets(id)
                  on delete cascade,
  household_id  uuid not null references public.households(id)
                  on delete cascade,
  carer_id      uuid references public.user_profiles(user_id)
                  on delete set null,
  -- Bounded on both sides: >= 1 because a payment of nothing is not a
  -- payment, <= the shared ceiling 063 pins everywhere else.
  amount_minor  integer not null
                  check (amount_minor >= 1 and amount_minor <= 99999999),
  currency      char(3) not null
                  check (currency ~ '^[A-Z]{3}$'),
  -- The calendar day the parent says the money moved — a settlement date,
  -- not an instant; there is no timezone to get wrong.
  paid_at       date not null,
  -- Free-text "how" ("Bank transfer", "Cash") — a note, not an enum. The
  -- wire caps it at 200 chars (payment.schema.ts).
  method_note   text,
  recorded_by   uuid references public.user_profiles(user_id)
                  on delete set null,
  created_at    timestamptz not null default now()
);

-- Read paths: a week's settlement state (timesheet_id), and the household
-- payment history screen (household_id, paid_at).
create index if not exists payments_timesheet_idx
  on public.payments (timesheet_id);

create index if not exists payments_household_paid_at_idx
  on public.payments (household_id, paid_at);

comment on table public.payments is
  'Settlement ledger: parent-recorded real-world payments against an approved week''s frozen gross. Append-only; partial payments allowed; over-payment refused in the service (sum <= gross_minor).';

-- ---------------------------------------------------------------------------
-- RLS — select-only, service-role writes (see header for the full argument)
-- ---------------------------------------------------------------------------

alter table public.payments enable row level security;

drop policy if exists "Parents and the carer can view payments" on public.payments;
create policy "Parents and the carer can view payments" on public.payments
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );

-- No insert/update/delete policy of any kind — see the header's RLS section.
