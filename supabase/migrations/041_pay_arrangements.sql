-- 041 Pay arrangements — the effective-dated terms a nanny is paid under
--
-- The first money table in this schema. Every convention it sets is copied by
-- the ones that follow (042 timesheet earnings, 043 pto_ledger, 044 expenses),
-- so the choices here are written down rather than left to be re-derived.
-- Binding sources: TIER0-PLAN.md ("Design decisions locked by this plan",
-- "Owner decisions — 2026-08-04", Phase 1) and docs/11-MONEY.md §1-2, §8.
--
-- THE ARRANGEMENT CONCEPT
-- Pay terms are not a column on the household and not a column on the carer:
-- they are one row per household-carer pair per effective date. Two nannies in
-- the same household can have completely different deals, and a raise usually
-- renegotiates several terms at once — rate, overtime, guaranteed hours — so
-- the rate and everything that travels with it live on the same row and move
-- together. That is also why roadmap 0.1 and 0.3's configuration collapse into
-- this one table instead of three.
--
-- APPEND-ONLY
-- A change is a NEW row with a later `valid_from`. Nothing here is ever
-- UPDATEd or DELETEd: no `updated_at` column, no `set_updated_at` trigger, and
-- (see the RLS section) no write policy of any kind. Pay history is evidence
-- in exactly the dispute this product exists to prevent — the same discipline
-- as `time_entries.scheduled_minutes` being frozen at clock-out (017) and
-- `shift_events` being append-only (015). Immutability is enforced by the
-- absence of any update/delete path anywhere in the stack, not by a trigger.
--
-- HOW A DATE RESOLVES TO AN ARRANGEMENT (the `effectiveOn` rule)
-- The arrangement effective on a date is the row with the greatest
-- valid_from <= date, with ties broken by created_at desc.
--   * "greatest valid_from <= date" is what makes a backdated change recompute
--     an open week and leave an approved week frozen (docs/11-MONEY.md §3).
--   * "ties broken by created_at desc" is the ONLY correction mechanism for a
--     same-day mistake: insert a second row with the same `valid_from` and the
--     right rate, and the newer row supersedes the typo without mutating it.
-- This rule is implemented in exactly one place —
-- `payArrangementRepository.effectiveOn(householdId, carerId, date)` — and
-- every caller (earnings engine, pay screens, mid-week-split preview) goes
-- through it rather than re-deriving it.
--
-- `valid_from` must be the household's LOCAL today or earlier; there are no
-- future-dated arrangements in v1 (owner decision 4, review finding 11). That
-- is a service-layer check — the household's timezone is not available to a
-- CHECK constraint, and server-UTC "today" would wrongly reject a legitimate
-- morning "today" east of UTC — not a constraint here.
--
-- WHY THERE IS NO UNIQUE CONSTRAINT ON (household_id, carer_id, valid_from)
-- It was drafted, then dropped in the independent review (finding 2). Under
-- append-only + no-future-dates, uniqueness would make a same-day rate typo
-- PERMANENTLY UNCORRECTABLE: the wrong row cannot be updated, and the same-day
-- fix cannot be inserted. The created_at desc tie-break above is the correction
-- mechanism, and it needs duplicates on that triple to be legal. Do not re-add
-- the constraint. A plain, non-unique index on
-- (household_id, carer_id, valid_from desc) serves the lookup instead.

create table if not exists public.pay_arrangements (
  id                          uuid primary key default gen_random_uuid(),
  household_id                uuid not null references public.households(id)
                                on delete cascade,
  -- 033 discipline: nullable with `on delete set null`, never cascade. A nanny
  -- deleting her own account must not delete the parent's record of what she
  -- was paid — that record belongs to both parties. `carer_display_name` below
  -- keeps the orphaned row legible.
  carer_id                    uuid references public.user_profiles(user_id)
                                on delete set null,
  -- Money is integer minor units (pence/cents) plus an ISO-4217 code, never a
  -- float and never a bare numeric — docs/11-MONEY.md §1. Per hour.
  rate_minor                  integer not null check (rate_minor >= 0),
  -- bill_rate_minor is DORMANT ON PURPOSE: what an agency bills the client
  -- household per hour, as opposed to what the carer is paid. Nothing reads or
  -- writes it in Tier 0 — it exists so agency invoicing (AGENCY-ROADMAP.md)
  -- does not need a migration that rewrites live pay rows. It carries the same
  -- non-negative floor as every other amount here so it cannot be woken up
  -- holding nonsense.
  bill_rate_minor             integer check (bill_rate_minor >= 0),
  -- ISO-4217: three UPPERCASE letters, checked, not merely three characters
  -- (review finding 4). `char(3)` alone accepted 'ab1' and '   ', and the
  -- code is not decoration — the phone hands it to Intl.NumberFormat, which
  -- throws a RangeError on a malformed code. formatMoney now degrades to
  -- inert text rather than blanking the pay screen, but a bad code should
  -- never reach a row in the first place. The same shape is pinned on the
  -- wire in packages/shared-types/src/schemas/payArrangement.schema.ts.
  currency                    char(3) not null default 'GBP'
                                check (currency ~ '^[A-Z]{3}$'),
  -- Weekly overtime threshold; null = this arrangement has no overtime. V1
  -- ships a weekly threshold + multiplier deliberately: US state rules (CA
  -- daily overtime and friends) become presets that POPULATE these fields
  -- later, so nothing anywhere hardcodes 40 hours.
  overtime_threshold_minutes  integer check (overtime_threshold_minutes > 0),
  overtime_multiplier         numeric(3, 2) not null default 1.50
                                check (overtime_multiplier >= 1),
  -- Guaranteed weekly hours; null = none. Phase 2 tops up ONLY the minutes lost
  -- to household closures (owner decision 7).
  guaranteed_minutes_per_week integer check (guaranteed_minutes_per_week >= 0),
  -- Paid-leave entitlement for the calendar year; null = none. Captured in the
  -- Phase 1 setup flow, priced by the Phase 3 pto_ledger.
  pto_entitlement_minutes_per_year integer
                                check (pto_entitlement_minutes_per_year >= 0),
  -- Per-mile reimbursement; null = none. Captured in Phase 1, priced by the
  -- Phase 4 expenses table. Reimbursements are not wages (docs/11-MONEY.md §6)
  -- — this rate never feeds overtime or the gross-pay line.
  mileage_rate_per_mile_minor integer check (mileage_rate_per_mile_minor >= 0),
  -- Per-nanny cancellation policy (owner decision 5). A number means "a
  -- cancellation within N hours of the start is paid".
  -- NULL MEANS NO CANCELLATION PAY — a real setting, not "unset", and the
  -- setup flow offers it as an explicit choice.
  -- When an arrangement exists its value ALWAYS wins, including when it is
  -- null: it overrides households.cancellation_paid_within_hours (009), which
  -- survives only as the fallback for a carer with no arrangement at all, and
  -- is flagged for deprecation rather than dropped. The single decision site
  -- is shiftChangeRequestCommandService.
  cancellation_paid_within_hours integer
                                check (cancellation_paid_within_hours > 0),
  -- Household-local date these terms take effect from. Backdating is allowed;
  -- future dates are rejected by the command service (see the header).
  valid_from                  date not null,
  -- Snapshot at insert, like 033 did for time_entries/timesheets (review
  -- finding 7): the history stays readable after the carer's profile is gone.
  carer_display_name          text not null,
  -- Free text shown in the history list ("annual review", "living wage rise").
  note                        text,
  created_by                  uuid references public.user_profiles(user_id)
                                on delete set null,
  created_at                  timestamptz not null default now()
);

-- The `effectiveOn` lookup: newest applicable row for one household-carer pair.
-- NON-UNIQUE by design — see the header. `valid_from desc` matches the scan
-- direction of "greatest valid_from <= date"; `created_at` is deliberately left
-- out of the index, because same-day duplicates are rare and few, so the
-- tie-break is cheaper as a sort over the handful of matching rows than as an
-- extra column carried on every entry.
create index if not exists pay_arrangements_household_carer_valid_from_idx
  on public.pay_arrangements (household_id, carer_id, valid_from desc);

comment on table public.pay_arrangements is
  'Effective-dated pay terms for one household-carer pair. Append-only: a change is a new row, and the effective row for a date is the greatest valid_from <= date, ties broken by created_at desc.';

-- ---------------------------------------------------------------------------
-- RLS — select-only, service-role writes
-- ---------------------------------------------------------------------------
-- The house pattern for API-mediated money tables (review finding 3,
-- docs/11-MONEY.md §8), and the same stance as shifts (015) and time_entries
-- (017): one SELECT policy, and NO insert/update/delete policy at all. Every
-- write goes through the API under the service role.
--
-- WHY THIS IS NOT "TIGHTEN IT LATER". Repositories run as the service role and
-- bypass RLS entirely, so on a write path the service layer is the only gate. A
-- client-exercisable insert or update policy would let a caller write a row
-- with the anon key and her own JWT, bypassing every rule the service enforces:
-- the no-future-dates check (owner decision 4), the D12-class assertion that
-- `carer_id` is an active nanny OF THIS household, and append-only itself.
-- Those rules are only real because the service layer is the only way in; RLS
-- here is the backstop against a misbehaving client, not the check.
--
-- WHO CAN READ: parents and owners, plus the carer reading HER OWN ROWS.
-- HELPERS AND OTHER CARERS ARE DENIED (review finding 2). An earlier draft used
-- `private.can_read_household` — every active member — which was wider than the
-- product rule in docs/TIER0-CX-SPEC.md and wider than the service that already
-- implements it (`payArrangementQueryService`: a helper never sees pay, and one
-- nanny never sees another's rate). PostgREST is a real door: a policy looser
-- than the service is not "belt and braces", it is the hole the service was
-- written to close.
--
-- Two arms, and both are deliberate:
--   * `private.can_write_household(household_id)` — 040's semantic wrapper for
--     "parent or owner". Write-capability is the right predicate for reading
--     pay: the people who may SET the terms are exactly the people who may see
--     everyone's. Never 009's `private.is_household_parent` — the point of 040
--     is that widening this later (an agency coordinator) is one function body,
--     not N policies. It is called BARE: `(select private.can_write_household(
--     household_id))` is a form that has never existed in this repo (040's trap
--     2). The initplan optimisation lives inside the helper, and a helper
--     taking a per-row household_id cannot be hoisted into an initplan anyway.
--   * `carer_id = (select auth.uid())` — the carer's own rows, and the reason
--     opaque pay is not the outcome here: she can always see her own terms.
--     Same shape and same sub-select form as 017's time_entries self-arm (018),
--     where `(select auth.uid())` IS correct — auth.uid() takes no per-row
--     argument, so Postgres hoists it into a once-per-scan initplan.
--
-- The two arms are not redundant: a carer is not a writer, and a parent is not
-- the carer_id on anyone's row.
--
-- GRANTS: none needed here, and none given — same as 017 and 035. Supabase's
-- stock grants already give anon/authenticated table privileges on the public
-- schema, so PostgREST access to this table is gated by the policy below alone.
-- The grants that ARE load-bearing are EXECUTE on the private helpers, and 040
-- (and 009 before it) already issued those to anon, authenticated and
-- service_role; a caller who cannot enter can_write_household gets a 500, not
-- an empty result (GOLDEN-FIXES.md #16).

alter table public.pay_arrangements enable row level security;

drop policy if exists "Parents and the carer can view pay arrangements" on public.pay_arrangements;
create policy "Parents and the carer can view pay arrangements" on public.pay_arrangements
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );

-- No updated_at trigger, deliberately: there is no updated_at column and no
-- update path. See the APPEND-ONLY section of the header.
