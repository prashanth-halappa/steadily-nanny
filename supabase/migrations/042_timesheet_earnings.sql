-- 042 Timesheet earnings — the frozen weekly pay snapshot
--
-- Four nullable columns on the already-existing `public.timesheets`. No new
-- table, no new policy (the existing "Members can view timesheets" SELECT
-- policy from 017, re-optimised in 018, already covers reads — a snapshot
-- column is just more data on a row a member could already see), no trigger
-- change. Binding sources: TIER0-PLAN.md ("Design decisions locked" 4, Phase
-- 2's migration section) and docs/11-MONEY.md §3.
--
-- THE FREEZE-AT-APPROVAL CONTRACT
-- Earnings are DERIVED, not stored, while a timesheet is `open`, `submitted`
-- or `queried`: minutes × the arrangement effective on each entry's
-- `local_date`, computed fresh on every read by
-- `apps/api/src/domains/pay/services/earningsService.ts`. All four columns
-- below are NULL WHILE a week is open — there is nothing to freeze yet. At
-- approval, inside the same conditional update that flips `status` (`...
-- where status = 'submitted'`, so a concurrent clock-out roll-up cannot slip
-- hours in between compute and freeze), the computed breakdown is
-- SNAPSHOTTED onto this row. From then the approved figure is read from the
-- snapshot, never recomputed, even if the arrangement later changes.
--
-- REOPEN CLEARS THE SNAPSHOT (D1)
-- The existing D1 reopen path — new hours landing in an approved week flip
-- it back to `submitted` and null out `approved_by`/`approved_at`
-- (docs/DEFECT-LOG.md D1) — must, in the same transaction, ALSO null out all
-- four columns added here. Skipping this leaves a frozen number on screen
-- that no longer matches the now-mutated hours: the exact class of
-- stale-authoritative-number bug D1 fixed for status, worse here because it
-- is a number people get paid against. That behaviour lives in
-- `timesheetCommandService`, not in this migration — this migration only
-- adds the columns and documents the contract they must honour.
--
-- THE LEGACY ARM
-- A timesheet approved before this migration renders hours-only; never backfilled.
-- Its snapshot columns are NULL forever, and a NULL snapshot under an
-- "Approved" label must never be papered over with a live-computed number
-- — that would silently show today's arrangement standing in for
-- whatever was actually in force when the week was signed off
-- (docs/11-MONEY.md §3, review finding 5). The query service is responsible
-- for rendering hours-only in this case, exactly as it does for an open week
-- with no arrangement at all (docs/11-MONEY.md §4).
--
-- THE COLUMNS
--   * `gross_minor` — integer minor units (pence/cents), never a float
--     (docs/11-MONEY.md §1). Same non-negative floor as every other amount
--     column in this schema.
--   * `currency` — ISO-4217 shape, checked, same regex as
--     `pay_arrangements.currency` (041). Deliberately carries NO DEFAULT,
--     unlike that column's `default 'GBP'`: a null snapshot has no currency
--     to default to before a week has ever been approved, and a stray
--     default here would let a half-written row look like a priced one.
--   * `earnings` — jsonb. The full frozen breakdown (line items with
--     minutes, rate used, arrangement id), so an approved week is
--     self-describing even if arrangements change later — the reader never
--     needs to re-resolve `effectiveOn` to see how a past figure was made.
--   * `earnings_computed_at` — timestamptz. When the snapshot was taken, for
--     display and for distinguishing "never computed" (open week) from "computed
--     just now" in the audit trail.
--
-- All four are populated together, at the single point of approval, and
-- cleared together, at the single point of reopen — there is no state where
-- only some of them are set. Nothing here enforces that as a group
-- constraint; it is a service-layer invariant, the same trust the append-only
-- discipline on `pay_arrangements` (041) places in the service layer rather
-- than a trigger.

alter table public.timesheets
  add column if not exists gross_minor integer
    check (gross_minor >= 0),
  add column if not exists currency char(3)
    check (currency ~ '^[A-Z]{3}$'),
  add column if not exists earnings jsonb,
  add column if not exists earnings_computed_at timestamptz;
