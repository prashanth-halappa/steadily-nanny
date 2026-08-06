-- 051 Expense pending dedupe + the week-freeze guard inside the review write
--
-- Two audit findings, one migration, because both live in the same write path
-- on `public.expenses` (044).
--
-- ===========================================================================
-- F-B4-1 (S0) — APPROVING AN EXPENSE RACED THE TIMESHEET FREEZE
-- ===========================================================================
-- `expenseCommandService.review` asked "is this week's timesheet already
-- approved?" with a plain read (`assertWeekNotFrozen`), then wrote with a CAS
-- whose WHERE clause knew nothing about timesheets:
--
--     update expenses set status = 'approved'
--     where id = ? and household_id = ? and status = 'pending'
--
-- Interleave the two requests and both succeed:
--
--   expense review   reads the timesheet as 'submitted'          -- unlocked
--   timesheet approve computes earnings (approved expenses only) -- misses it
--   timesheet approve CAS commits 'approved' with frozen earnings
--   expense review   CAS still matches 'pending', commits 'approved'
--
-- The result is a reimbursement that is genuinely owed, sits on a row, and
-- appears on NO statement anyone reads — docs/11-MONEY.md §3 says an approved
-- week's earnings are frozen and never recomputed. `expenseRepository`'s own
-- header states the rule the pre-check broke: "the guard lives in the WHERE
-- clause of the write itself, not just in a pre-check".
--
-- `review_pending_expense` below puts it there. It follows 024's house
-- pattern: plpgsql, security invoker, pinned search_path, `select ... for
-- update` on the ANCHOR row first, the status CAS carried in the write, and
-- an outcome jsonb returned rather than an exception raised.
--
-- WHY A LOCK AND NOT JUST A SUBQUERY PREDICATE. A `not exists (select 1 from
-- timesheets where ... status = 'approved')` predicate reads the same
-- READ COMMITTED snapshot the pre-check did: a timesheet approve that is
-- in-flight but uncommitted is invisible to it, so the identical interleaving
-- survives. Only a lock on the shared anchor row — the week's timesheet —
-- serialises the two writes. `timesheets_household_carer_week_idx` (017) makes
-- (household_id, carer_id, week_start) a single row to lock.
--
-- AND THE OTHER DIRECTION, which the lock alone does NOT close. If the expense
-- wins the lock, the timesheet approve merely waits — and its own CAS
-- (`timesheetRepository.approveSubmittedWithEarnings`, guarded on
-- `updated_at`) would then match, because approving an expense never used to
-- bump `timesheets.updated_at`. It would freeze earnings computed BEFORE this
-- reimbursement existed. So a successful review also TOUCHES the week's
-- timesheet row. `set_timesheets_updated_at` (017) rewrites `updated_at` on
-- every update of that row, so the touch invalidates exactly the version token
-- the approve pinned: the parent's approve loses its CAS, and the retry
-- recomputes with the reimbursement in it. One extra tap, never a wrong
-- statement — the same side `approveSubmittedWithEarnings` already errs on.
--
-- The touch is skipped when the caller passes no week (a rejection, which
-- moves no money, and a carer-less row from 033's account-deletion
-- discipline, which has no week to strand money in).
--
-- ===========================================================================
-- F-B4-6 (S1) — A DOUBLE-TAPPED POST CREATED TWO PAYABLE ROWS
-- ===========================================================================
-- `expenseCommandService.create` had no idempotency key and no dedupe. A
-- double-tap on a flaky network filed the same claim twice, and a parent
-- approving both doubled `reimbursements_minor` at freeze — real money, paid
-- twice, from one tap the carer only meant to make once.
--
-- The wire contract (`packages/shared-types/src/schemas/expense.schema.ts`)
-- carries no client-supplied idempotency key and its request variants are
-- `.strict()`, so there is nothing on the request to dedupe on. The key here
-- is therefore the CLAIM'S OWN IDENTITY: household, carer, date, kind,
-- description, currency, and whichever of the two kind-conditional money
-- columns the row uses.
--
-- WHY IT WILL NOT REJECT A LEGITIMATE DUPLICATE. A carer genuinely can file
-- two identical-looking claims — two identical parking fees on the same day —
-- so the index is deliberately narrow in three ways:
--   * PARTIAL on `status = 'pending'`. The moment a parent reviews the first
--     claim it leaves the index and the identity is free again, so the
--     constraint only ever applies to two UNREVIEWED claims.
--   * `description` is IN the key. A retry replays byte-identical text; two
--     genuinely separate claims are told apart by a word ("Parking, morning"
--     vs "Parking, afternoon"), which is a keystroke, not a workaround.
--   * `currency` is in the key too, so a same-amount claim in another
--     currency is never mistaken for a replay.
-- The loser gets a typed `DUPLICATE_PENDING_CLAIM` from the repository's
-- 23505 translation (the same shape 039/043/045 use), not a 500.
--
-- COALESCE ON THE TWO MONEY COLUMNS is load-bearing: NULLs are DISTINCT in a
-- unique index, and 044's implication checks leave `miles` null on every
-- `expense` row and `amount_minor` null on every unapproved `mileage` row. A
-- bare column list would therefore never fire for either kind.
--
-- ADDITIVE: no column dropped, no row rewritten, no RLS policy touched (044's
-- select-only stance is unchanged). The index is created `if not exists` and
-- the function is `create or replace`.

-- ---------------------------------------------------------------------------
-- F-B4-6 — one pending claim per claim identity
-- ---------------------------------------------------------------------------

create unique index if not exists expenses_one_pending_claim_idx
  on public.expenses (
    household_id,
    carer_id,
    local_date,
    kind,
    description,
    currency,
    coalesce(amount_minor, -1),
    coalesce(miles, -1)
  )
  where status = 'pending';

comment on index public.expenses_one_pending_claim_idx is
  'Dedupes a double-tapped claim submission. Partial on pending: a reviewed claim frees the identity again.';

-- ---------------------------------------------------------------------------
-- F-B4-1 — review_pending_expense: the freeze guard inside the write
-- ---------------------------------------------------------------------------

create or replace function public.review_pending_expense(
  p_expense_id uuid,
  p_household_id uuid,
  p_status text,
  p_reviewed_by uuid,
  p_reviewed_at timestamptz,
  p_review_note text,
  p_amount_minor integer,
  p_carer_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_timesheet public.timesheets;
  v_reviewed public.expenses;
begin
  -- Anchor row first (024's pattern). Skipped entirely when the caller passes
  -- no week: a rejection moves no money, and a carer-less row has no week.
  if p_week_start is not null and p_carer_id is not null then
    select * into v_timesheet
    from public.timesheets
    where household_id = p_household_id
      and carer_id = p_carer_id
      and week_start = p_week_start
    for update;

    if v_timesheet.id is not null and v_timesheet.status = 'approved' then
      return jsonb_build_object(
        'outcome', 'week_locked',
        'week_start', p_week_start,
        'timesheet_status', v_timesheet.status
      );
    end if;
  end if;

  -- `coalesce(p_amount_minor, amount_minor)`: only a MILEAGE approval computes
  -- an amount. A rejection, and an ordinary expense approval whose amount was
  -- fixed at submission, must leave the column exactly as it stands.
  update public.expenses
  set
    status = p_status,
    reviewed_by = p_reviewed_by,
    reviewed_at = p_reviewed_at,
    review_note = p_review_note,
    amount_minor = coalesce(p_amount_minor, amount_minor)
  where id = p_expense_id
    and household_id = p_household_id
    and status = 'pending'
  returning * into v_reviewed;

  if v_reviewed.id is null then
    return jsonb_build_object('outcome', 'not_pending');
  end if;

  -- Invalidate the week's version token so an in-flight timesheet approve
  -- loses its `updated_at` CAS and recomputes with this reimbursement in it.
  -- `set_timesheets_updated_at` (017) owns the column; this update just makes
  -- it fire.
  if v_timesheet.id is not null then
    update public.timesheets
    set updated_at = now()
    where id = v_timesheet.id;
  end if;

  return jsonb_build_object(
    'outcome', 'reviewed',
    'expense', to_jsonb(v_reviewed)
  );
end;
$$;

revoke all on function public.review_pending_expense(
  uuid, uuid, text, uuid, timestamptz, text, integer, uuid, date
) from public;
revoke all on function public.review_pending_expense(
  uuid, uuid, text, uuid, timestamptz, text, integer, uuid, date
) from anon;
revoke all on function public.review_pending_expense(
  uuid, uuid, text, uuid, timestamptz, text, integer, uuid, date
) from authenticated;
grant execute on function public.review_pending_expense(
  uuid, uuid, text, uuid, timestamptz, text, integer, uuid, date
) to service_role;

comment on function public.review_pending_expense is
  'Lock the week timesheet, refuse if frozen, CAS-review one pending expense, then bump the week version. service_role only.';
