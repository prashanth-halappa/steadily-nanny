-- 043 PTO ledger — the household-side record of paid-leave accrual and usage
--
-- Binding sources: TIER0-PLAN.md ("Owner decisions — 2026-08-04" #3, "Phase 3
-- — PTO ledger") and docs/11-MONEY.md §5, §8. Copies 041_pay_arrangements.sql's
-- house style — comment density, select-only RLS stance, append-only
-- rationale — as the second money table in this schema.
--
-- THE LEDGER CONCEPT
-- pto_ledger is an append-only ledger, not a running-balance column: every
-- grant, usage and correction is its own signed row — `accrual` positive,
-- `usage` negative, `adjustment` either, never zero — and a carer's PTO
-- balance for one household is simply balance = sum(minutes) over that
-- household's rows for that carer. The ledger is the source of truth, not a
-- cache a bug can desync from it; the same discipline as 041's pay history
-- and 033's frozen time_entries.
--
-- WHY PAID PTO CAN NEVER BE A FLAG ON carer_time_off
-- `carer_time_off` (011_availability.sql) deliberately carries
-- no household reference at all — that absence is what makes cross-family
-- leakage of a nanny's time off structurally impossible. It is also exactly why "paid"
-- can never be a column there: a shared time-off row spans every family a
-- carer works for at once, so "this time off is paid" begs the question
-- paid by whom? — there is no single household to attribute a payment to on
-- that row. A household-scoped `pto_ledger` row answers the question by
-- construction, because it lives IN one household's scope. This also just
-- works for a nanny with two families, one paying PTO and one not: each
-- household's ledger is independent and neither can see the other's.
--
-- THE time_off_id FK — ANONYMITY ANALYSIS
-- `time_off_id` is the one place a household-scoped table in this schema
-- references a row outside its own household (`carer_time_off` has no
-- household_id to scope by, so there is no other way to point at it). That
-- is narrow and deliberate: the household can already see this specific
-- time off's existence — its dates and its impact counts, via the carer's
-- own schedule — so the FK on a `usage` row adds no new fact for THAT
-- household. And because carer_time_off itself carries no household
-- reference, the FK reveals nothing about the carer's other households:
-- nothing here lets one family learn that a second family exists, let alone
-- what it did with this same time off. Don't generalize this pattern
-- elsewhere without repeating this argument.
--
-- V1 GRANT MODEL — annual calendar-year grant, not per-hour accrual
-- Owner decision 3 (2026-08-04): PTO entitlement is set on the arrangement
-- at nanny setup (`pay_arrangements.pto_entitlement_minutes_per_year`), and
-- the PTO year is the calendar year for v1. One `accrual` row per
-- household-carer-year, for the entitlement minutes of the arrangement
-- effective at grant time. The row is created LAZILY by the API on first
-- read of a year that has no accrual row yet — a write-on-GET, deliberately,
-- so nothing has to pre-provision every carer's every year up front. Two v1
-- simplifications, both intentional and both correctable only via a new
-- adjustment row (kind = 'adjustment'), never by mutating the grant:
--   * no pro-rating for a carer who joins mid-year — she is lazily granted
--     the full annual amount the first time her year is read;
--   * a mid-year change to `pto_entitlement_minutes_per_year` does not retro-adjust
--     a year's grant already made — the grant amount is frozen at grant
--     time, the same freeze-on-read discipline as everything else in this
--     schema.
-- Per-hour accrual is a later mode, not a v1 branch.
--
-- APPEND-ONLY
-- No `updated_at` column, no update trigger, and (see the RLS section) no
-- update/delete policy of any kind — corrections are new `adjustment` rows,
-- exactly 041's discipline. A carer cancelling a time off a household
-- already marked paid does not delete or edit the `usage` row; the service
-- inserts a reversing `adjustment` row and the balance self-heals, silently
-- unpaying nobody.
--
-- THE TWO PARTIAL UNIQUE INDEXES
-- * (household_id, time_off_id) where kind = 'usage' — the 039 pattern
--   (`time_entries_one_cancellation_paid_per_shift`): at most one `usage`
--   row per time off per household, enforced by the database so two
--   concurrent "mark paid" taps cannot double-pay the same time off. A
--   service-level find-first is an optimisation; this index is the source
--   of truth under a race.
-- * (household_id, carer_id, effective_date) where kind = 'accrual' — makes
--   the lazy write-on-GET annual grant idempotent: two concurrent reads of a
--   carer's un-granted year race to insert the same accrual row, the
--   loser's insert raises 23505 instead of double-granting a year's
--   entitlement, and the service re-fetches the winner.
-- Neither is a table-level UNIQUE constraint: both must allow unlimited rows
-- of the OTHER kinds sharing the same key — many `adjustment` rows, many
-- `usage` rows across different time offs for the same carer.
--
-- A third, plain (non-unique, non-partial) index on (household_id,
-- carer_id) serves the balance read itself — summing every kind of row for
-- one carer in one household, not filtered to a single kind the way the two
-- unique indexes above are.
--
-- RLS — select-only, service-role writes, 041's exact rule
-- (docs/11-MONEY.md §8.) One SELECT policy and no insert/update/delete
-- policy at all: every write goes through the API under the service role,
-- same stance as pay_arrangements and shifts/time_entries before it. WHO CAN
-- READ: parents and owners via `private.can_write_household(household_id)`,
-- plus the carer reading her OWN rows via `carer_id = (select auth.uid())`.
-- HELPERS AND OTHER CARERS ARE DENIED (Phase 1 review, finding 2) — this is
-- NOT `private.can_read_household`, which is every active member and would
-- hand a helper, or one nanny, another carer's PTO balance. The household
-- helper is called BARE, never `(select private.can_write_household(...))`
-- — 040's trap 2: the initplan optimisation lives inside the helper, which
-- takes a per-row household_id and cannot be hoisted into an initplan
-- regardless. The self arm uses 018's `(select auth.uid())` form, the one
-- place the sub-select IS the optimisation, because auth.uid() takes no
-- per-row argument and Postgres hoists it into a once-per-scan initplan.
--
-- WHY THIS IS NOT "TIGHTEN IT LATER" — same argument as 041: repositories
-- run as the service role and bypass RLS entirely, so on a write path the
-- service layer is the only gate. A client-exercisable insert policy would
-- let a caller write a ledger row with the anon key and her own JWT,
-- bypassing the D12-class membership assertion that a time-off's carer is
-- an active nanny of this household, the confirmed-only markable rule, and
-- the partial unique indexes' race protection alike. RLS here is the
-- backstop against a misbehaving client, not the check.

create table if not exists public.pto_ledger (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households(id)
                         on delete cascade,
  -- 033 discipline: nullable with `on delete set null`, never cascade. A
  -- nanny deleting her own account must not delete the household's ledger of
  -- what she accrued and used — `carer_display_name` below keeps an orphaned
  -- row legible.
  carer_id            uuid references public.user_profiles(user_id)
                         on delete set null,
  kind                text not null
                         check (kind in ('accrual', 'usage', 'adjustment')),
  -- Signed minutes: accrual positive, usage negative, adjustment either —
  -- never zero, so every row moves the balance by a real amount.
  minutes             integer not null check (minutes <> 0),
  -- Household-local date this row is effective from — the accrual year for
  -- an `accrual` row, the day the leave was taken for a `usage` row.
  effective_date      date not null,
  -- Usage rows only. The one household-scoped -> cross-household FK in this
  -- schema — see the ANONYMITY ANALYSIS above.
  time_off_id         uuid references public.carer_time_off(id)
                         on delete set null,
  -- Snapshot at insert, like 033 and 041 (review finding 7): the ledger
  -- stays readable after the carer's profile is gone.
  carer_display_name  text not null,
  -- Free text shown in the ledger history ("2026 annual grant",
  -- "cancelled 12 Aug time off — reversing").
  note                text,
  created_by          uuid references public.user_profiles(user_id)
                         on delete set null,
  created_at          timestamptz not null default now()
);

-- Partial unique: at most one `usage` row per time off per household (review
-- finding 9, the 039 pattern) — see THE TWO PARTIAL UNIQUE INDEXES above.
create unique index if not exists pto_ledger_one_usage_per_time_off_idx
  on public.pto_ledger (household_id, time_off_id)
  where kind = 'usage';

-- Partial unique: at most one `accrual` row per household-carer-year, making
-- the lazy write-on-GET annual grant idempotent — see the same section above.
create unique index if not exists pto_ledger_one_accrual_per_year_idx
  on public.pto_ledger (household_id, carer_id, effective_date)
  where kind = 'accrual';

-- Plain lookup index for the balance read: sum every kind of row for one
-- carer in one household, unfiltered by kind (unlike the two indexes above).
create index if not exists pto_ledger_household_carer_idx
  on public.pto_ledger (household_id, carer_id);

comment on table public.pto_ledger is
  'Append-only PTO ledger for one household-carer pair. Balance = sum(minutes) over accrual (+), usage (-) and adjustment (+/-) rows. See the migration header for the grant model and the carer_time_off anonymity analysis.';

-- ---------------------------------------------------------------------------
-- RLS — select-only, service-role writes
-- ---------------------------------------------------------------------------
-- See the RLS section of the header for the full rationale. This is 041's
-- policy, character for character, with the table name swapped.

alter table public.pto_ledger enable row level security;

drop policy if exists "Parents and the carer can view pto ledger rows" on public.pto_ledger;
create policy "Parents and the carer can view pto ledger rows" on public.pto_ledger
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );

-- No updated_at trigger, deliberately: there is no updated_at column and no
-- update path. See the APPEND-ONLY section of the header.
