-- 111 Previous approval — the receipt a reopened week used to destroy
--
-- `docs/DEFECT-LOG.md` D79. One column, and one line added to 102's
-- `roll_up_timesheet_hours`. Everything else in 102 stands exactly as it is.
--
-- =========================================================================
-- THE HOLE — A WEEK CAN BE UN-APPROVED WITH NO TRACE THAT IT EVER WAS
-- =========================================================================
--
-- 102 gave the clock-out two branches, and it was right about both:
--
--   * PAID week   → keep `approved`, keep the approver, keep all four
--                   snapshot columns, stamp `hours_changed_after_payment_at`.
--                   The payments were bounded by that gross.
--   * UNPAID week → demote to `submitted` and null all four (D1's rule, and
--                   still the right rule: a frozen gross outliving the hours
--                   it was computed from is D1's original hazard).
--
-- What the unpaid branch never asked is what the DEMOTION costs the two
-- people. An approval is not a status — it is a STATEMENT BETWEEN TWO
-- PEOPLE: "I looked at 38h 30m, I agreed £462.00, on 14 August." New hours
-- do not make that statement wrong. They create a TAIL. Destroying the
-- statement is the defect; reopening the week is not.
--
-- Today the demotion nulls `approved_at`, `approved_by` and the whole
-- snapshot, does NOT write `reopen_reason` (only the manual reopen does),
-- and emits no `shift_event`. `useReopenedNotice` on the client is
-- mount-scoped. So a parent who was not staring at the Hours screen when the
-- clock-out landed opens a week that is BYTE-IDENTICAL to one nobody ever
-- approved. There is nothing to compare the new total against, nothing that
-- says a first approval happened, and no figure for what changed.
--
-- `previous_approval` is that statement, kept. It is display/audit state —
-- never money the engine reads, never a second source of truth for what a
-- week is worth. The live snapshot columns remain the ONLY authority for
-- that, and this column is never summed, never exported, never priced.
--
-- =========================================================================
-- WHY THE `SET` LIST READS ITSELF, AND WHY THAT IS SAFE
-- =========================================================================
--
-- Bare column references on the RIGHT-hand side of an UPDATE's `SET` are the
-- OLD row's values — SQL's rule, not a Postgres quirk, and 102 already
-- depends on it in the same statement (`approved_by = case when v_paid then
-- approved_by end` is how the paid branch KEEPS its approver; the existing
-- integration test proves it). So the new arm reads exactly the four values
-- the very same statement is about to null. Atomic, no pre-read, no TOCTOU,
-- no second statement in which the row is inconsistent.
--
-- `else previous_approval` IS LOAD-BEARING. Sunday's clock-out must not wipe
-- the receipt Saturday's clock-out wrote: after the first roll-up the row is
-- `submitted`, so the `when status = 'approved'` arm no longer matches and
-- without the `else` the column would be nulled by the CASE's implicit NULL.
-- The FIRST demotion out of an approval is the one that owns the receipt.
--
-- The paid branch is untouched — it keeps `approved`, so there is no
-- approval to preserve a copy of.
--
-- =========================================================================
-- NO `drop function` HERE, AND THAT IS DELIBERATE
-- =========================================================================
--
-- 102's D46 note says the drop before `create or replace` is MANDATORY, and
-- it was — for `record_timesheet_payment`, which was gaining a SIXTH
-- PARAMETER. A changed argument list makes `create or replace` mint a NEW
-- OVERLOAD beside the old one: both callable, the new one inheriting no
-- grants, and an unqualified `comment on function` failing with 42725.
--
-- `roll_up_timesheet_hours(uuid, integer)` keeps a BYTE-IDENTICAL argument
-- list here, so `create or replace` replaces the body in place, preserves the
-- grants, and cannot create an overload. This is 085's situation, not 102's.
-- The grants and the comment are re-issued below anyway — they are idempotent
-- and re-running this migration must leave the same end state.
--
-- =========================================================================
-- CHECKED AGAINST 102'S OWN CONSTRAINTS
-- =========================================================================
--
--   * `timesheets_approved_has_snapshot` constrains `status = 'approved'` ⇒
--     the FOUR snapshot columns are non-null. `previous_approval` is not one
--     of them and is unmentioned by the CHECK; the arm that writes it sets
--     `status = 'submitted'`, where the CHECK is vacuous either way.
--   * `timesheets_refuse_reopen_when_paid` fires only when payments EXIST,
--     i.e. only on the `v_paid` branch — which does not touch this column.
--   * `set_timesheets_updated_at` (100) still bumps `updated_at`, because
--     this is not a `parent_viewed_at`-only write. Approve's compare-and-swap
--     is unaffected.
--
-- =========================================================================
-- PRE-FLIGHT
-- =========================================================================
--
-- None needed. The column is nullable with no default and no constraint, so
-- every existing row is valid the moment it is added; nothing is backfilled
-- (a week demoted before this migration has no receipt to recover — the
-- values were already gone, which is the whole defect).
--
--   select count(*) from public.timesheets where previous_approval is not null;
--   -- must be 0 immediately after this migration; > 0 only after a real
--   -- clock-out or manual reopen has run through the new code.
--
-- =========================================================================
-- ROLLBACK, piece by piece
-- =========================================================================
--
--   -- 1. Re-run 102's `roll_up_timesheet_hours` block VERBATIM. Argument list
--   --    is identical, so a bare `create or replace` restores it; no drop.
--   -- 2. alter table public.timesheets drop column if exists previous_approval;
--   --
--   -- Step 1 before step 2: dropping the column while the function still
--   -- names it makes every clock-out fail at runtime (plpgsql resolves column
--   -- names at first execution, not at definition).
--
-- DEPLOY ORDER: this migration first, then the API — 102's order, for 102's
-- reason. The API's `reopenFromApproved` writes `previous_approval`, which
-- must exist before it does; the roll-up change is invisible to the old API
-- (a column it never selects by name, on an RPC whose signature has not
-- moved).
--
-- Apply via the Supabase MCP `apply_migration`, in order after 110 — never
-- `supabase db push` (version-scheme mismatch; see docs/ROLLBACK-RUNBOOK.md).
-- ---------------------------------------------------------------------------

alter table public.timesheets
  add column if not exists previous_approval jsonb;

comment on column public.timesheets.previous_approval is
  'The approval this week USED to carry, kept when a clock-out or a manual reopen takes it back out of `approved` on an UNPAID week: {approved_at, approved_by, gross_minor, currency, worked_minutes}. An approval is a statement between two people, and new hours create a tail rather than making the statement wrong — without this the demoted week is byte-identical to one nobody ever approved, so neither side can see what changed or what it cost. DISPLAY AND AUDIT STATE ONLY: never summed, never exported, never read by the earnings engine, never a second source of truth for what a week is worth. Written by the FIRST demotion out of an approval (a later clock-out must not overwrite it) and cleared by the next approve, which supersedes it. The paid branch never writes it — that week keeps its real approval.';

-- ---------------------------------------------------------------------------
-- roll_up_timesheet_hours, re-issued with one arm added (102 + this header)
-- ---------------------------------------------------------------------------
--
-- The body is 102's, unchanged, with exactly one `SET` entry added. Every
-- comment 102 wrote about the lock, the kind-agnostic `exists`, the
-- unconditional clear and the `returns setof` is still true and still the
-- reason this is an RPC — see 102's header rather than a restatement here.

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
    hours_changed_after_payment_at = case when v_paid then now() else null end,
    -- 111. Every reference below is to the OLD row — the four values the
    -- lines above are nulling on this very branch. `else previous_approval`
    -- keeps Saturday's receipt when Sunday's clock-out lands on the
    -- already-`submitted` week; see this migration's header.
    previous_approval = case
      when v_paid then previous_approval
      when status = 'approved' then jsonb_build_object(
        'approved_at',    approved_at,
        'approved_by',    approved_by,
        'gross_minor',    gross_minor,
        'currency',       currency,
        -- NULL on a `no_arrangement` / `currency_change` snapshot, which has
        -- no such key. The wire schema makes it nullable for exactly that:
        -- an absent figure is never rendered as a zero one.
        'worked_minutes', (earnings->>'worked_minutes')::int)
      else previous_approval
    end
  where id = p_timesheet_id
  returning *;
end;
$$;

revoke all on function public.roll_up_timesheet_hours(uuid, integer) from public;
revoke all on function public.roll_up_timesheet_hours(uuid, integer) from anon;
revoke all on function public.roll_up_timesheet_hours(uuid, integer) from authenticated;
grant execute on function public.roll_up_timesheet_hours(uuid, integer) to service_role;

comment on function public.roll_up_timesheet_hours is
  'Set a week''s total_minutes from a clock-out. Locks the row, then asks whether it has payments: unpaid weeks demote to submitted with the snapshot cleared (D1) and the approval they are losing copied into previous_approval (111); PAID weeks keep status, approver and all four snapshot columns and get hours_changed_after_payment_at stamped instead. service_role only.';
