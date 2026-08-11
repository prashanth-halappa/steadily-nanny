-- 085 Payment corrections — the offsetting row 067 forbade (D-20, gap P3)
--
-- `PaymentDetailSheet` has told the parent, in production, that "payments
-- can't be edited or removed; a correction is recorded as another payment" —
-- while 067's `check (amount_minor >= 1)` made that other payment impossible
-- to write. David records one Zelle transfer twice and the ledger says he paid
-- the week twice; there is no edit path (`payments` is APPEND-ONLY) and there
-- was no offsetting path either. D-20 gives him the second one.
--
-- THE MODEL: A CORRECTION IS A ROW, NOT AN EDIT.
-- `kind = 'correction'`, `corrects_payment_id` pointing at the payment it
-- reverses, `correction_reason` saying why, and a NEGATIVE `amount_minor`.
-- The original row keeps its full amount forever. Append-only is preserved in
-- the strongest sense available: nothing here adds an update or delete path,
-- and a ledger that quietly restates history is worse than one that cannot be
-- corrected at all (attention spec §4.1 — "a record that can't be corrected is
-- evidence against me", and a record that silently rewrites itself is worse).
--
-- WHY SIGNED AMOUNTS, AND WHY THAT DECIDES THE WHOLE MIGRATION.
-- Paid-to-date must become "sum WITH corrections" everywhere it is computed —
-- 077's atomic over-gross gate, `paymentRepository.sumForTimesheet`, the CSV's
-- `paid_to_date_minor`, the mobile paid-state. Storing the reversal as a
-- negative number makes all four the SAME expression they already are:
-- `sum(amount_minor)`. The alternative — a positive magnitude plus a kind
-- discriminator — would require every one of those sites to learn the sign
-- rule, and the day one of them forgot, the week's balance would be wrong by
-- twice the correction. One representation, no per-site arithmetic.
--
-- THE TRAP THIS CREATES, STATED HERE AND AGAIN AT THE EMIT SITE.
-- `sum(amount_minor)` now silently spans two kinds, and "shouldn't this only
-- count actual payments?" is one `where kind = 'payment'` away. Adding it
-- would make the over-gross gate refuse legitimate payments after a downward
-- correction — David corrects his double-entry, tries to record the payment he
-- actually owes, and is told the week is already settled. That is why
-- `record_timesheet_payment` is RE-ISSUED below rather than left alone: the
-- warning belongs in the body a future reader is editing, not only in a
-- migration header they will never open.
--
-- ONE LEVEL, NO CHAINS. A correction corrects a `payment`; a correction is
-- never itself correctable (`v_original.kind <> 'payment'` below). Correcting
-- a correction is a new payment (spec §4.1). The check constraint cannot say
-- this — it is a cross-row fact — so `record_payment_correction` owns it, and
-- that function is the only write path into a `correction` row.
--
-- REFUSED, NEVER CLAMPED, AT BOTH ENDS. A reversal larger than what is LEFT of
-- the original is refused with the figures the lock saw, never trimmed to fit
-- (`docs/11-MONEY.md` §1). Bounding each original's reversals by that original
-- is also what makes the week's floor free: since every correction is bounded
-- by the row it corrects, `sum(amount_minor)` over the week can never go below
-- zero, so "you cannot un-pay more than you paid" needs no separate gate.
--
-- CORRECTIONS ARE ATOMIC FOR THE SAME REASON PAYMENTS ARE (P5).
-- Two parents reversing the same payment in the same instant each read
-- "nothing reversed yet" and both commit, reversing it twice — the identical
-- race 077 closed, over the identical append-only table with no edit path
-- back. Same anchor, same reason: `select ... for update` on the WEEK's
-- timesheet row, which serialises corrections against each other AND against
-- concurrent payments on the same week.
--
-- A REOPENED WEEK IS STILL CORRECTABLE. Unlike `record_timesheet_payment`,
-- this function does NOT re-check `status = 'approved'` under the lock. P16
-- keeps a reopened week's payment rows visible and states no balance; spec
-- §4.1 is explicit that a correction on a reopened week is still recordable.
-- That is also why the correction's `household_id`/`carer_id`/`currency` are
-- stamped from the ORIGINAL PAYMENT rather than from the timesheet: a reopened
-- week has `currency` NULL, and a correction is by definition in the same
-- currency as the payment it reverses. The anti-spoof discipline is unchanged
-- (050/077) — nothing describing the money comes from a caller argument; the
-- source row is simply the payment, which is itself pinned to the locked week.
--
-- D46 — THE OVERLOAD TRAP, AND WHY NO `drop function` APPEARS BELOW.
-- `record_timesheet_payment` is re-issued with its argument list BYTE-IDENTICAL
-- to 077's `(uuid, integer, date, text, uuid)`. `create or replace` with the
-- same signature is a genuine replace: the old body is gone, the grants
-- survive, and `comment on function` resolves. A `drop function` would only be
-- required had the arg list changed — which is precisely why the correction
-- path is a SEPARATE function with a NEW NAME rather than two extra parameters
-- on this one. `record_payment_correction` has no prior signature to collide
-- with. Grants are restated for both anyway (GOLDEN #16): a reader auditing
-- who may execute these should find the answer in the migration that last
-- touched them.
--
-- 077 RESERVED A `unique_violation` HANDLER should a dedupe index ever land on
-- `payments`. This migration adds no unique index, so that reservation still
-- stands unclaimed and neither function grows the handler. Restated so the
-- absence stays a decision.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.payments
  -- Defaulted, so every row 067 through 084 wrote is a `payment` with no
  -- backfill and no rewrite of history.
  add column if not exists kind text not null default 'payment',
  -- Cascade, not restrict: 067 cascades payments off the timesheet, and a
  -- correction whose original has gone is a row about nothing.
  add column if not exists corrects_payment_id uuid
    references public.payments(id) on delete cascade,
  -- Required on a correction (see the shape check). "recorded twice", "wrong
  -- week" — the only thing that makes a reversal readable a year later.
  add column if not exists correction_reason text;

alter table public.payments
  drop constraint if exists payments_kind_chk;
alter table public.payments
  add constraint payments_kind_chk
  check (kind in ('payment', 'correction'));

-- ---------------------------------------------------------------------------
-- The amount check relaxes to SIGNED — and to nothing more than signed
-- ---------------------------------------------------------------------------
--
-- 067 wrote `check (amount_minor >= 1 and amount_minor <= 99999999)` inline on
-- the column, which Postgres auto-named `payments_amount_minor_check`. Dropped
-- by that exact name and replaced, rather than merely adding a second check:
-- leaving the old one in place would make every correction fail the insert.

alter table public.payments
  drop constraint if exists payments_amount_minor_check;
alter table public.payments
  drop constraint if exists payments_amount_minor_signed_chk;
alter table public.payments
  add constraint payments_amount_minor_signed_chk
  check (
    amount_minor <> 0
    and amount_minor >= -99999999
    and amount_minor <= 99999999
  );

-- Sign, reason and back-reference all follow from the kind, so they are one
-- constraint: a `payment` that carries a `corrects_payment_id`, or a
-- `correction` with no reason, is a row nobody can read correctly later.
alter table public.payments
  drop constraint if exists payments_kind_shape_chk;
alter table public.payments
  add constraint payments_kind_shape_chk
  check (
    (
      kind = 'payment' and corrects_payment_id is null
      and correction_reason is null and amount_minor >= 1
    )
    or (
      kind = 'correction' and corrects_payment_id is not null
      and correction_reason is not null and amount_minor <= -1
    )
  );

-- Summing one payment's reversals is on the write path of every correction.
create index if not exists payments_corrects_idx
  on public.payments (corrects_payment_id)
  where corrects_payment_id is not null;

comment on column public.payments.kind is
  'payment (positive, standalone) or correction (negative, pointed at the payment it reverses). Paid-to-date is the SIGNED sum across both — see 085''s header.';

comment on column public.payments.corrects_payment_id is
  'The payment this row reverses. NULL on a payment. One level only: a correction is never itself correctable (record_payment_correction refuses it).';

-- ---------------------------------------------------------------------------
-- record_payment_correction — the ONLY write path into a correction row
-- ---------------------------------------------------------------------------

create or replace function public.record_payment_correction(
  p_timesheet_id uuid,
  p_corrects_payment_id uuid,
  p_amount_minor integer,
  p_paid_at date,
  p_reason text,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_timesheet public.timesheets;
  v_original public.payments;
  v_already_reversed_minor bigint;
  v_remaining_minor bigint;
  v_correction public.payments;
begin
  -- The anchor, and the same one 077 takes: the WEEK's row, not the payment's
  -- and not an advisory key. Two parents reversing one payment at the same
  -- instant, and a payment landing against a week being corrected, both wait
  -- here. Deliberately NOT followed by an `approved` re-check — a reopened
  -- week is still correctable (spec §4.1, P16).
  select * into v_timesheet
  from public.timesheets
  where id = p_timesheet_id
  for update;

  if v_timesheet.id is null then
    return jsonb_build_object('outcome', 'not_correctable', 'reason', 'week_missing');
  end if;

  -- The original, pinned to the week the caller named: a payment id from
  -- another household's week cannot be reached even if it is guessed.
  select * into v_original
  from public.payments
  where id = p_corrects_payment_id
    and timesheet_id = p_timesheet_id
  for update;

  if v_original.id is null then
    return jsonb_build_object('outcome', 'not_correctable', 'reason', 'payment_missing');
  end if;

  -- One level, no chains (spec §4.1). Correcting a correction is a new
  -- payment, not a second reversal.
  if v_original.kind <> 'payment' then
    return jsonb_build_object('outcome', 'not_correctable', 'reason', 'not_a_payment');
  end if;

  -- Negative or zero, because every row pointing here is a correction and
  -- every correction is negative. `coalesce`, never a bare sum: an
  -- uncorrected payment must read 0, or the arithmetic below goes null and
  -- silently passes the gate (077's argument, same trap).
  select coalesce(sum(amount_minor), 0)
  into v_already_reversed_minor
  from public.payments
  where corrects_payment_id = v_original.id;

  v_remaining_minor := v_original.amount_minor + v_already_reversed_minor;

  -- REFUSED, NEVER CLAMPED, and with the figures the lock actually saw so the
  -- sheet can say "£120.00 of £462.00 is already reversed" without re-deriving
  -- it. A positive argument is refused here too: this function reverses, and a
  -- correction that ADDS money is a payment, which has its own path and its
  -- own gross ceiling.
  if p_amount_minor >= 0 or p_amount_minor < -v_remaining_minor then
    return jsonb_build_object(
      'outcome', 'exceeds_original',
      'original_amount_minor', v_original.amount_minor,
      'remaining_minor', v_remaining_minor
    );
  end if;

  insert into public.payments (
    timesheet_id,
    household_id,
    carer_id,
    amount_minor,
    currency,
    paid_at,
    kind,
    corrects_payment_id,
    correction_reason,
    recorded_by
  )
  values (
    v_original.timesheet_id,
    v_original.household_id,
    v_original.carer_id,
    p_amount_minor,
    v_original.currency,
    p_paid_at,
    'correction',
    v_original.id,
    p_reason,
    p_recorded_by
  )
  returning * into v_correction;

  return jsonb_build_object(
    'outcome', 'recorded',
    'correction', to_jsonb(v_correction)
  );
end;
$$;

revoke all on function public.record_payment_correction(
  uuid, uuid, integer, date, text, uuid
) from public;
revoke all on function public.record_payment_correction(
  uuid, uuid, integer, date, text, uuid
) from anon;
revoke all on function public.record_payment_correction(
  uuid, uuid, integer, date, text, uuid
) from authenticated;
grant execute on function public.record_payment_correction(
  uuid, uuid, integer, date, text, uuid
) to service_role;

comment on function public.record_payment_correction is
  'Lock the week FOR UPDATE, load the original payment on that week, refuse a chain or an over-reversal, then insert a negative correction stamping household/carer/currency from the original. Reopened weeks allowed. service_role only.';

-- ---------------------------------------------------------------------------
-- record_timesheet_payment, re-issued correction-aware (077 + this header)
-- ---------------------------------------------------------------------------
--
-- IDENTICAL ARGUMENT LIST to 077's, so this is a replace and not an overload
-- (D46 — see the header). The only substantive change is that `kind` is now
-- written explicitly on the inserted row and the sum carries the warning that
-- makes it stay correct.

create or replace function public.record_timesheet_payment(
  p_timesheet_id uuid,
  p_amount_minor integer,
  p_paid_at date,
  p_method_note text,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_timesheet public.timesheets;
  v_already_paid_minor bigint;
  v_payment public.payments;
begin
  -- The anchor. Unchanged from 077: everything below reads the week's frozen
  -- figures from this locked row, so a concurrent payment, correction,
  -- approve or reopen waits here.
  select * into v_timesheet
  from public.timesheets
  where id = p_timesheet_id
  for update;

  if v_timesheet.id is null
     or v_timesheet.status <> 'approved'
     or v_timesheet.gross_minor is null
     or v_timesheet.currency is null then
    return jsonb_build_object(
      'outcome', 'not_payable',
      'status', v_timesheet.status
    );
  end if;

  -- PAID-TO-DATE IS THE SIGNED SUM OF PAYMENTS AND CORRECTIONS (085, D-20).
  -- DO NOT ADD A KIND FILTER TO THIS SUM. `where kind = 'payment'` reads like
  -- a tidy-up and is the one edit that breaks this gate: after a downward
  -- correction the week would still be counted as fully paid, and the next
  -- legitimate payment — the whole reason the parent corrected the record —
  -- would be refused as over-gross. Corrections are stored negative precisely
  -- so this stays one expression.
  select coalesce(sum(amount_minor), 0)
  into v_already_paid_minor
  from public.payments
  where timesheet_id = p_timesheet_id;

  if v_already_paid_minor + p_amount_minor > v_timesheet.gross_minor then
    return jsonb_build_object(
      'outcome', 'exceeds_gross',
      'already_paid_minor', v_already_paid_minor,
      'gross_minor', v_timesheet.gross_minor
    );
  end if;

  insert into public.payments (
    timesheet_id,
    household_id,
    carer_id,
    amount_minor,
    currency,
    paid_at,
    kind,
    method_note,
    recorded_by
  )
  values (
    v_timesheet.id,
    v_timesheet.household_id,
    v_timesheet.carer_id,
    p_amount_minor,
    v_timesheet.currency,
    p_paid_at,
    'payment',
    p_method_note,
    p_recorded_by
  )
  returning * into v_payment;

  return jsonb_build_object(
    'outcome', 'recorded',
    'payment', to_jsonb(v_payment)
  );
end;
$$;

revoke all on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid
) from public;
revoke all on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid
) from anon;
revoke all on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid
) from authenticated;
grant execute on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid
) to service_role;

comment on function public.record_timesheet_payment is
  'Lock the week''s timesheet FOR UPDATE, re-check approved-and-priced, sum payments AND corrections (signed), refuse over-gross, then insert stamping household/carer/currency from the locked row. service_role only.';
