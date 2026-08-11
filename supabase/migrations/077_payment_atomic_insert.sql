-- 077 Atomic payment insert — the over-payment gate moves into the write
--
-- 067's header states the invariant and admits where it lived: "sum(payments
-- per timesheet) <= that week's frozen gross_minor ... a cross-row SUM cannot
-- be a row CHECK constraint, so the gate is `paymentCommandService.create`".
-- The service read the sum, compared, and THEN inserted, with nothing holding
-- a lock in between. Interleave two parents tapping "Record payment" on the
-- same week in the same instant and both succeed:
--
--   payment A  reads sum = 0, gross = 80000, amount 80000   -- passes
--   payment B  reads sum = 0, gross = 80000, amount 80000   -- passes
--   payment A  inserts 80000
--   payment B  inserts 80000
--
-- The week is now settled at twice its frozen gross, both parents were told
-- it worked, and `payments` is APPEND-ONLY — there is no edit path to take
-- the second row back (067's header, docs/11-MONEY.md §1). Sequential retries
-- never reach it, so this is not a bug anyone hits by hand; it is the one a
-- flaky network and two phones produce, over real money, exactly once.
--
-- `record_timesheet_payment` below puts the sum, the refusal and the insert in
-- ONE body behind a lock, following 050's and 051's shape: plpgsql, security
-- invoker, pinned search_path, `select ... for update` on the ANCHOR row
-- first, and an outcome jsonb returned rather than an exception raised, so the
-- TS layer maps each outcome to the typed domain error the client already
-- knows (`PaymentExceedsGrossError`, `PaymentWeekNotApprovedError`).
--
-- WHY THE TIMESHEET ROW IS THE ANCHOR, AND NOT AN ADVISORY LOCK. An advisory
-- lock keyed on the timesheet id would serialise payments against each other
-- and nothing else. The invariant does not anchor to "payments of this week" —
-- it anchors to the row CARRYING THE FROZEN GROSS, which a concurrent approve
-- or reopen rewrites. Locking `timesheets` therefore buys the second half for
-- free: a reopen that is in-flight but uncommitted is invisible to any
-- predicate read at READ COMMITTED (051's header makes the same argument), so
-- only the lock stops a payment landing against a gross that is being cleared
-- underneath it. Row-lock discipline is also discoverable in the schema —
-- an advisory key is a convention living in whichever call sites remember it.
--
-- THE RE-CHECK UNDER THE LOCK IS NOT BELT-AND-BRACES. The service still runs
-- its own gate 3 (approved, with a frozen gross) before calling, for the
-- correct 409 shape and to keep authorization in TypeScript. But that read is
-- unlocked: a reopen can commit between it and this lock, which nulls
-- `gross_minor`/`currency` and moves the status back. Re-reading the LOCKED
-- row and answering 'not_payable' is what makes the pre-check safe to keep.
--
-- REFUSED, NEVER CLAMPED. Over-gross returns 'exceeds_gross' with the figures
-- the lock actually saw (`already_paid_minor`, `gross_minor`) so the client
-- can say "£500.00 of £800.00 is already recorded" without re-deriving it.
-- Writing the difference instead would record a payment for an amount nobody
-- made, and the ledger's whole job is to answer "what has actually been paid"
-- (docs/11-MONEY.md §1, the same rule as TimesheetGrossTooLargeError).
--
-- NOTHING FROM THE CALLER DESCRIBES THE WEEK. `timesheet_id`, `household_id`,
-- `carer_id` and `currency` are stamped from the LOCKED `v_timesheet` row, not
-- from parameters — 050's discipline, for the same reason: a payload cannot
-- then file a payment against another household, credit another carer, or
-- record a week in a currency it was not priced in. The function takes no
-- household, carer or currency parameter at all, so there is nothing to spoof.
--
-- NO 23505 PATH TODAY. `payments` (067) has no unique index beyond its primary
-- key, so no insert here can raise `unique_violation` — a double-tapped POST
-- files two legitimate-looking rows and is bounded only by the gross, which is
-- the current, accepted behaviour. If a dedupe index is ever added (051's
-- `expenses_one_pending_claim_idx` is the model), this function grows an
-- `exception when unique_violation` handler returning a 'duplicate' outcome,
-- and the repository translates it the way `expenseRepository.create` does.
-- Stated so the absence is a decision rather than an oversight; NOT built.
--
-- AUTHORIZATION STAYS IN TYPESCRIPT (050/051 precedent). This function
-- re-verifies FROZEN-STATE invariants under a lock; it does not ask who the
-- caller is. Gates 1-3 in `paymentCommandService` — the week exists and is the
-- caller's, parents only, approved and priced — are unchanged and still own
-- the 404/403/409 shapes. SECURITY INVOKER, service_role EXECUTE only.
--
-- D46 — `record_timesheet_payment` IS A NEW FUNCTION NAME, so there is no old
-- signature to collide with here. Any FUTURE change to its argument list must
-- `drop function if exists public.record_timesheet_payment(<exact old type
-- list>)` first: `create or replace` with a different argument list creates a
-- NEW OVERLOAD rather than replacing, the old function stays live and
-- callable, the new one inherits no grants, and an unqualified
-- `comment on function` fails with 42725. Migration 029 is the template.

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
  -- The anchor. Everything below reads the week's frozen figures from this
  -- locked row, so a concurrent payment, approve or reopen waits here.
  select * into v_timesheet
  from public.timesheets
  where id = p_timesheet_id
  for update;

  -- Re-checked UNDER the lock, not merely re-stated: see the header. A
  -- missing row lands here too — the week was deleted between the service's
  -- read and this call, and there is nothing to pay against either way.
  if v_timesheet.id is null
     or v_timesheet.status <> 'approved'
     or v_timesheet.gross_minor is null
     or v_timesheet.currency is null then
    return jsonb_build_object(
      'outcome', 'not_payable',
      'status', v_timesheet.status
    );
  end if;

  -- `coalesce`, never a bare sum: a week nobody has paid against must read 0,
  -- because the comparison below ADDS to this figure and a null would make it
  -- null — which is not > anything, and would silently pass the gate.
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
  'Lock the week''s timesheet FOR UPDATE, re-check approved-and-priced, sum existing payments, refuse over-gross, then insert stamping household/carer/currency from the locked row. service_role only.';
