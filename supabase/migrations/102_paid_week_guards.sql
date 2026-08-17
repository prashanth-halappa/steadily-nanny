-- 102 Paid-week guards — the three things `payments` never asked about
--
-- `docs/AS-BUILT-PAYMENT.md` §7 findings P1, P2 and P8, in one migration
-- because they are one hole seen from three sides: the ledger is bounded by a
-- week's frozen `gross_minor`, and NOTHING outside `record_timesheet_payment`
-- ever asked whether money had moved before rewriting that gross.
--
-- =========================================================================
-- P1 — BOTH WAYS OUT OF `approved` IGNORED THE LEDGER
-- =========================================================================
--
-- 077 put the over-gross gate inside the write, behind `select ... for
-- update` on the week's `timesheets` row, precisely because the invariant
-- anchors to THE ROW CARRYING THE FROZEN GROSS. But two paths take that row
-- back out of `approved`, and neither went near the lock or the ledger:
--
--   1. `timesheetCommandService.reopen` — the parent's undo. A CAS'd
--      PostgREST update that nulls all four snapshot columns.
--   2. `rollUpIntoTimesheet` — the nanny's clock-out. An UNCONDITIONAL
--      demotion to `submitted` with the snapshot cleared (D1's rule, and it
--      is the right rule for a week nobody has paid).
--
-- Run either on a week David has already paid £800.00 against and the gross
-- those payments were bounded by is gone, the balance the export prints goes
-- negative, and `payments` is APPEND-ONLY — nothing takes those rows back.
--
-- The two paths get DIFFERENT answers, because the two acts are different:
--
--   * A manual reopen is a decision someone is making right now, in front of
--     a screen that already shows what has been paid. It is REFUSED, by a
--     trigger, with the whole ledger as the reason. The client says "You've
--     paid £800.00 on this week. Adjust it in the next payment."
--   * A clock-out is NOT a decision — the hours already happened, and a
--     clock-out that can FAIL is the one thing this codebase has said
--     repeatedly it must never be (`rollUpIntoTimesheet`'s own rationale,
--     `notifyParentsOfSubmission`'s try/catch). So on a PAID week the
--     roll-up records the minutes, KEEPS the status, the approver and all
--     four snapshot columns, and raises a flag —
--     `hours_changed_after_payment_at` — that both week views render. The
--     approved total stays true to what was approved and paid; the flag is
--     what says it no longer covers every hour worked. On an UNPAID week the
--     roll-up behaves exactly as it does today: demote and clear.
--
-- =========================================================================
-- P2 — `approved ⇒ frozen snapshot` HAD NO CONSTRAINT
-- =========================================================================
--
-- 042:87 calls it "a service-layer invariant", and it was true only because
-- of what one call site passed to the generic, unconditional
-- `BaseRepository.update`. It is a CHECK below. `roll_up_timesheet_hours`
-- exists partly to keep it: the paid branch has to hold status and snapshot
-- together in ONE statement, and no PostgREST update can express that.
--
-- =========================================================================
-- P8 — A DOUBLE-TAPPED POST FILED TWO REAL PAYMENTS
-- =========================================================================
--
-- 077's header: "a double-tapped POST files two legitimate-looking rows and
-- is bounded only by the gross, which is the current, accepted behaviour",
-- and it explicitly RESERVED a `unique_violation` handler for the day a
-- dedupe index landed. This is that day. `idempotency_key` is a client uuid
-- minted per payment INTENT (when the sheet opens), reused across retries,
-- dropped on success. The reservation is claimed not with an exception
-- handler but with a read under the lock, which is strictly better: the
-- second call RETURNS THE FIRST ROW rather than an error the client would
-- have to interpret, so a retry after a response the phone never saw reads
-- as the success it actually was.
--
-- =========================================================================
-- PRE-FLIGHT — RUN THESE BEFORE APPLYING, NOT AFTER
-- =========================================================================
--
-- Both new constraints are added WITHOUT `not valid`, which validates every
-- existing row. That is safe only because of a fact about a moment, so here
-- are the queries that re-establish it rather than someone's memory of it:
--
--   select count(*) from public.timesheets where status = 'approved'
--     and (gross_minor is null or currency is null
--          or earnings is null or earnings_computed_at is null);
--   -- must be 0, or the CHECK below fails the migration.
--
--   select count(*) from public.payments;
--   -- prod is at 0; every idempotency_key is therefore null and the partial
--   -- unique index has nothing to collide on.
--
-- If the first query is ever non-zero, add the constraint `not valid`,
-- repair the rows, then `alter table public.timesheets validate constraint
-- timesheets_approved_has_snapshot;`. Do NOT relax the CHECK to fit the data.
--
-- =========================================================================
-- ROLLBACK, piece by piece
-- =========================================================================
--
--   drop trigger if exists timesheets_refuse_reopen_when_paid on public.timesheets;
--   drop function if exists public.timesheets_refuse_reopen_when_paid();
--   alter table public.timesheets drop constraint if exists timesheets_approved_has_snapshot;
--   drop function if exists public.roll_up_timesheet_hours(uuid, integer);
--   drop index if exists public.payments_idempotency_key_uidx;
--   alter table public.payments drop column if exists idempotency_key;
--   alter table public.timesheets drop column if exists hours_changed_after_payment_at;
--   -- and re-run 085's `record_timesheet_payment` block verbatim to restore
--   -- the five-arg function, after dropping this migration's six-arg one.
--
-- DEPLOY ORDER: this migration first, then the API. The API's roll-up calls
-- `roll_up_timesheet_hours`, which must exist before it does; every other
-- piece here is invisible to the old API (a defaulted sixth parameter, a
-- nullable column, a trigger the old reopen path only trips on a week that
-- has payments — which it should be refused on anyway).
--
-- Apply via the Supabase MCP `apply_migration`, in order after 101 — never
-- `supabase db push` (version-scheme mismatch; see docs/ROLLBACK-RUNBOOK.md).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- P8 — the idempotency key
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists idempotency_key text;

comment on column public.payments.idempotency_key is
  'Client-minted uuid identifying ONE payment INTENT, not one request: generated when the record-payment sheet opens, reused across every retry, dropped on success. NULL from any client that does not send one, which is why the unique index below is PARTIAL. record_timesheet_payment returns the EXISTING row for a repeat key rather than erroring.';

-- Partial, and that is the whole design: rows written before this migration,
-- and rows from any client that sends no key, all carry NULL and must never
-- collide with each other.
create unique index if not exists payments_idempotency_key_uidx
  on public.payments (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- record_timesheet_payment, re-issued with the key (077 + 085 + this header)
-- ---------------------------------------------------------------------------
--
-- D46 — THE OVERLOAD TRAP, AND WHY THE DROP BELOW IS MANDATORY. 085 could use
-- a bare `create or replace` because its argument list was BYTE-IDENTICAL to
-- 077's. This one adds a sixth parameter, so `create or replace` alone would
-- create a NEW OVERLOAD: the old five-arg function would stay live and
-- callable, the new one would inherit no grants, and an unqualified
-- `comment on function` would fail with 42725. Migration 029 is the template.
--
-- The body is 085's, with exactly one thing added: a keyed lookup AFTER the
-- lock. It has to be after the lock for the same reason the over-gross sum
-- is — a payment that committed while this call was queued is invisible to
-- anything reading the statement snapshot, and the whole point of a dedupe
-- key is to see the row the other request just wrote.

drop function if exists public.record_timesheet_payment(uuid, integer, date, text, uuid);

create or replace function public.record_timesheet_payment(
  p_timesheet_id uuid,
  p_amount_minor integer,
  p_paid_at date,
  p_method_note text,
  p_recorded_by uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_timesheet public.timesheets;
  v_existing public.payments;
  v_already_paid_minor bigint;
  v_payment public.payments;
begin
  -- The anchor. Unchanged from 077/085: everything below reads the week's
  -- frozen figures from this locked row, so a concurrent payment, correction,
  -- approve or reopen waits here.
  select * into v_timesheet
  from public.timesheets
  where id = p_timesheet_id
  for update;

  -- The dedupe read, and it is DELIBERATELY the first thing after the lock —
  -- before the payable re-check. A retry of a payment that already committed
  -- must answer with that payment even if the week has since been reopened;
  -- refusing it as 'not_payable' would tell the parent nothing happened about
  -- money that has already moved and is already on the ledger.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.payments
    where idempotency_key = p_idempotency_key;

    if found then
      return jsonb_build_object(
        'outcome', 'recorded',
        'payment', to_jsonb(v_existing)
      );
    end if;
  end if;

  -- Re-checked UNDER the lock, not merely re-stated: see 077's header. A
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

  -- DO NOT ADD A KIND FILTER TO THIS SUM. Correction rows carry a NEGATIVE
  -- amount_minor (085), so this plain signed sum IS paid-to-date-with-
  -- corrections. Narrowing it to actual payments would make this gate refuse
  -- a legitimate payment after a downward correction — David corrects his
  -- double entry, tries to record what he actually owes, and is told the week
  -- is already settled. `coalesce`, never a bare sum: a week nobody has paid
  -- must read 0, because the comparison below ADDS to this figure and a null
  -- is not > anything, which would silently pass the gate.
  select coalesce(sum(amount_minor), 0)
  into v_already_paid_minor
  from public.payments
  where timesheet_id = p_timesheet_id;

  -- Refused, never clamped, with the figures the lock actually saw
  -- (docs/11-MONEY.md §1). Writing the difference instead would record a
  -- payment for an amount nobody made.
  if v_already_paid_minor + p_amount_minor > v_timesheet.gross_minor then
    return jsonb_build_object(
      'outcome', 'exceeds_gross',
      'already_paid_minor', v_already_paid_minor,
      'gross_minor', v_timesheet.gross_minor
    );
  end if;

  -- Nothing describing the money comes from a caller argument: household,
  -- carer and currency are stamped from the LOCKED row (050/077 discipline),
  -- so a payload cannot file a payment against another household, credit
  -- another carer, or record a week in a currency it was not priced in.
  insert into public.payments (
    timesheet_id,
    household_id,
    carer_id,
    amount_minor,
    currency,
    paid_at,
    kind,
    method_note,
    recorded_by,
    idempotency_key
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
    p_recorded_by,
    p_idempotency_key
  )
  returning * into v_payment;

  return jsonb_build_object(
    'outcome', 'recorded',
    'payment', to_jsonb(v_payment)
  );
end;
$$;

revoke all on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid, text
) from public;
revoke all on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid, text
) from anon;
revoke all on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid, text
) from authenticated;
grant execute on function public.record_timesheet_payment(
  uuid, integer, date, text, uuid, text
) to service_role;

comment on function public.record_timesheet_payment is
  'Lock the week''s timesheet FOR UPDATE, return the existing row for a repeated idempotency_key, re-check approved-and-priced, sum existing payments SIGNED, refuse over-gross, then insert stamping household/carer/currency from the locked row. service_role only.';

-- ---------------------------------------------------------------------------
-- P1a — the flag a paid week wears when hours arrive after the money
-- ---------------------------------------------------------------------------

alter table public.timesheets
  add column if not exists hours_changed_after_payment_at timestamptz;

comment on column public.timesheets.hours_changed_after_payment_at is
  'Set by roll_up_timesheet_hours when minutes rolled into a week that ALREADY has payment rows. The week keeps status approved, its approver and all four snapshot columns — the payments were bounded by that gross — so this timestamp is the only thing saying the approved total no longer covers every hour worked. Cleared by the next approve, and by any roll-up onto an unpaid week.';

-- ---------------------------------------------------------------------------
-- P1a — roll_up_timesheet_hours: the clock-out write, made ledger-aware
-- ---------------------------------------------------------------------------
--
-- WHY THIS IS AN RPC AND NOT A POSTGREST UPDATE. Two independent reasons,
-- either one sufficient:
--
--   1. PostgREST cannot express the write. Seven columns each need a CASE on
--      the same "has this week been paid" answer, and that answer is a
--      cross-row EXISTS. A read-then-update in TypeScript is the P1 race one
--      level down, over the identical append-only table.
--   2. Even in SQL, a plain `update ... set status = case when exists (...)`
--      would not close it. A subquery inside an UPDATE reads the STATEMENT
--      snapshot, which was taken before the row lock was granted — so a
--      payment that committed while this statement waited on the lock is
--      invisible, and the week gets demoted out from under it anyway. In
--      plpgsql the `for update` COMPLETES first, and every read after it sees
--      what the winner committed. That is 077's rule, applied to the other
--      side of the same lock.
--
-- The clear on the unpaid branch stays UNCONDITIONAL (D1, and
-- `rollUpIntoTimesheet`'s 40-line rationale): every unpaid write here sets
-- `status = 'submitted'`, and a submitted week has no snapshot and no
-- approver, full stop. Writing nulls over nulls is idempotent and depends on
-- nothing read earlier. What changes is only that the condition is now read
-- INSIDE the lock instead of from a stale `existing.status` the service
-- fetched in a previous statement.
--
-- This function never trips the reopen trigger below, and that is structural
-- rather than lucky: on a paid week `status` is written back as itself.
--
-- `returns setof public.timesheets` rather than the jsonb 077/085 use: there
-- is no outcome to branch on here — the caller needs the row, and the row's
-- own status tells it which branch happened.

create or replace function public.roll_up_timesheet_hours(p_timesheet_id uuid, p_total_minutes integer)
returns setof public.timesheets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_paid boolean;
begin
  -- The same anchor 077 takes, for the same reason: this write rewrites the
  -- frozen gross that every payment against this week was bounded by.
  perform 1 from public.timesheets where id = p_timesheet_id for update;

  -- After the lock, therefore true. Kind-agnostic on purpose: a week whose
  -- payments have all been reversed still HAS payment rows, and a parent who
  -- has recorded and corrected money on a week is still someone whose
  -- approved total must not be silently rewritten underneath them.
  select exists(select 1 from public.payments where timesheet_id = p_timesheet_id) into v_paid;

  return query update public.timesheets set
    total_minutes = p_total_minutes,
    status = case when v_paid then status else 'submitted' end,
    approved_by = case when v_paid then approved_by end,
    approved_at = case when v_paid then approved_at end,
    gross_minor = case when v_paid then gross_minor end,
    currency = case when v_paid then currency end,
    earnings = case when v_paid then earnings end,
    earnings_computed_at = case when v_paid then earnings_computed_at end,
    hours_changed_after_payment_at = case when v_paid then now() else null end
  where id = p_timesheet_id
  returning *;
end;
$$;

revoke all on function public.roll_up_timesheet_hours(uuid, integer) from public;
revoke all on function public.roll_up_timesheet_hours(uuid, integer) from anon;
revoke all on function public.roll_up_timesheet_hours(uuid, integer) from authenticated;
grant execute on function public.roll_up_timesheet_hours(uuid, integer) to service_role;

comment on function public.roll_up_timesheet_hours is
  'Set a week''s total_minutes from a clock-out. Locks the row, then asks whether it has payments: unpaid weeks demote to submitted with the snapshot cleared (D1); PAID weeks keep status, approver and all four snapshot columns and get hours_changed_after_payment_at stamped instead. service_role only.';

-- ---------------------------------------------------------------------------
-- P1b — a week with payments cannot be taken out of `approved`
-- ---------------------------------------------------------------------------
--
-- The manual reopen, refused in the database rather than in the service,
-- because the service check would be a read in one statement and a write in
-- the next — the same TOCTOU this whole migration is about. Here the EXISTS
-- runs inside the updating transaction, on a row that update already holds a
-- lock on, so a payment cannot land between the check and the write.
--
-- SQLSTATE P0001 with a recognisable message rather than a silent no-op: the
-- repository translates it into the 409 the client branches on, and a reopen
-- that silently did nothing would be indistinguishable from a lost CAS.
--
-- `roll_up_timesheet_hours` never trips this — on a paid week it writes
-- `status` back as itself, so `new.status <> 'approved'` is false.
--
-- MIGRATION 100'S `set_timesheets_updated_at` IS NOT TOUCHED. It is also a
-- BEFORE UPDATE trigger on this table, it preserves OLD.updated_at for a
-- `parent_viewed_at`-only write, and approve compare-and-swaps on that
-- column. Two BEFORE UPDATE triggers fire in name order (s before t); this
-- one only ever raises, so the order is immaterial. NEVER redefine that
-- function as a shortcut here — see GOLDEN-FIXES.

create or replace function public.timesheets_refuse_reopen_when_paid() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'approved' and new.status <> 'approved'
     and exists (select 1 from public.payments where timesheet_id = old.id) then
    raise exception 'TIMESHEET_HAS_PAYMENTS' using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists timesheets_refuse_reopen_when_paid on public.timesheets;
create trigger timesheets_refuse_reopen_when_paid before update on public.timesheets
  for each row execute function public.timesheets_refuse_reopen_when_paid();

-- ---------------------------------------------------------------------------
-- P2 — an approved week carries its frozen snapshot, in the database
-- ---------------------------------------------------------------------------
--
-- 042's contract, finally asserted: all four columns are set together and
-- cleared together, and `status = 'approved'` is what makes them mandatory.
-- Dropped by name first so the migration is re-runnable. See the pre-flight
-- block in the header for why this does not need `not valid` today, and for
-- the two-step to use if it ever does.

alter table public.timesheets
  drop constraint if exists timesheets_approved_has_snapshot;
alter table public.timesheets
  add constraint timesheets_approved_has_snapshot
  check (status <> 'approved' or (gross_minor is not null and currency is not null and earnings is not null and earnings_computed_at is not null));
