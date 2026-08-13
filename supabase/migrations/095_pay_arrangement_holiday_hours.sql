-- 095 What an UNWORKED observed holiday is worth
--
-- APPLIED TO PROD 2026-08-12 (Phase 6) via Supabase MCP `apply_migration`,
-- in order with the rest of the 074→096 chain — never `supabase db push`
-- (version-scheme mismatch). Live tip after apply:
-- `redeem_draft_invite_week_starts_on`. Do not re-apply.

-- WHY THIS MIGRATION EXISTS (§5 D-53, closing 3-E4's parked question)
-- 080 shipped half the holidays contract. `worked_holiday_multiplier` says
-- what hours WORKED on a household-observed holiday pay, and D-12's calendar
-- says which dates those are — but the far more common case is that the
-- family observes a holiday, NOBODY WORKS IT, and the nanny is either paid
-- for the day or she is not. 3-E4 refused to infer an answer (her scheduled
-- hours? a fixed eight? a trailing average?) because inventing a number is
-- the one thing the earnings engine must never do (§2.9), and carried it to
-- the owner instead.
--
-- D-53 answers it with an explicit TERM: a fixed hour credit, priced once for
-- each observed holiday in the week that nobody worked, at that day's
-- ordinary rate. Not an inference from the schedule, not a household default
-- — a number the parties agreed and can both read on the terms document.
--
-- ON THE ARRANGEMENT, NOT THE HOUSEHOLD, for exactly 080's reason. The
-- CALENDAR is the family's — one list, every carer. What a holiday is WORTH
-- is a term of this carer's employment, and a household with two carers may
-- have agreed different ones. `docs/design/screens-pay-terms.md` §4.3: "The
-- list is household-level; the premium multiplier is on the arrangement."
--
-- NULL MEANS NO CREDIT (§2.9's null-is-an-explicit-no), and that is TODAY'S
-- BEHAVIOUR UNCHANGED: before this column existed, an unworked holiday paid
-- nothing on its own account, and every pre-095 row keeps reading exactly
-- that way. No default and no backfill — a default of 8h would hand every
-- existing family a paid-holiday term nobody agreed to, which is the precise
-- D-7 liability the whole preset posture exists to avoid (and §5 D-9 wipes
-- every account before store release anyway).
--
-- MINUTES, NOT HOURS, like every other duration column on this table. An
-- hours-valued column would need a converter somewhere between the terms form
-- and the engine, and that converter is where a factor-of-60 defect lives.
--
-- WHAT THE ENGINE DOES WITH IT (`earningsService`, pinned by its case table):
-- credit minutes are OUTSIDE every overtime threshold — daily, weekly, and
-- the seventh day — exactly like `pto`, because they are not worked minutes
-- and must never promote a worked hour into a higher tier. They ARE payable,
-- so they reduce a guaranteed-hours shortfall rather than being paid twice.
-- A worked observed holiday takes 080's premium and no credit; an unworked
-- one takes the credit and no premium — mutually exclusive by construction.
--
-- DEPLOY RISK: none. One nullable column with no default on
-- `pay_arrangements` (adding it rewrites no rows, and its CHECK is vacuously
-- true for every existing row). No new table, function, trigger or policy.

alter table public.pay_arrangements
  add column if not exists holiday_hours_minutes integer;

-- House pattern (053/055/063/064/068/078/080): drop-if-exists then add, so
-- the migration is re-runnable and `db reset` never dies on the second pass.
alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_holiday_hours_minutes_positive;

-- `> 0`, not `>= 0`. NULL already spells "no credit", so a stored zero would
-- be a second spelling of one agreement and the engine would have to guess
-- which a parent meant. Refuse, never clamp (§2.9) — Postgres is the last
-- place that can still say no. A plain comparison already lets NULL through:
-- `null > 0` is NULL, not FALSE, and a CHECK only fails on FALSE.
alter table public.pay_arrangements
  add constraint pay_arrangements_holiday_hours_minutes_positive
  check (holiday_hours_minutes > 0);

-- No new policy — 041's select-only RLS already scopes this row to the
-- parents and the carer herself, and one more term on a row a member could
-- already see needs no new predicate (the 078/080 note, restated).

comment on column public.pay_arrangements.holiday_hours_minutes is
  'How many MINUTES an observed holiday NOBODY WORKED credits, at the day''s ordinary rate (D-53, and D-12''s calendar decides which dates). Null = no credit, an explicit no and the pre-095 behaviour. Credit minutes sit outside every overtime threshold like PTO, and count toward payable minutes so a guarantee never pays for them twice. A WORKED observed holiday takes 080''s worked_holiday_multiplier instead, never both.';
