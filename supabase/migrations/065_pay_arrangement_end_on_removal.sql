-- 065 Pay arrangement end date — removing a member re-confirms terms
--
-- Owner decision (2026-08-06), following the rejoin review: removing a member
-- END-DATES their pay arrangement, so a carer who later rejoins has NO live
-- arrangement and a parent must set terms again. The engine's existing
-- no-arrangement arm then renders the hours with `gross_minor` null — never
-- £0.00 (docs/11-MONEY.md §4, pinned by I-25).
--
-- WHY THIS IS NEEDED AT ALL
-- Removal is soft (`household_members.status = 'removed'`) and rejoining
-- REUSES the same membership row, because the unique `(household_id, user_id)`
-- constraint makes a second row impossible. Without an end date, the
-- arrangement that was live when the carer left is still the row `effectiveOn`
-- resolves months later when they come back — at the old rate, with no gap
-- recorded and nobody prompted. See docs/11-MONEY.md §10.
--
-- WHY `valid_to date` AND NOT `ended_at timestamptz`
--   * `effectiveOn` resolves against a household-LOCAL `YYYY-MM-DD` (see
--     `localDateOf`), never a UTC instant. A timestamptz end would need a
--     per-household timezone conversion on every read, and 041's header
--     already records why server-UTC "today" is wrong east of UTC.
--   * Same type and same domain as `valid_from`, so the exclusion predicate is
--     a pure date comparison that composes with the existing
--     `valid_from <= date` ordering instead of fighting it.
--   * Nullable, and null means "still live" — the state every existing row is
--     in, which is why there is no backfill below.
--
-- `valid_to` IS INCLUSIVE: the last day these terms still price. A carer
-- clocked out at 11am and removed at noon is still paid for that morning.
-- The resolution rule becomes: greatest `valid_from <= date` among rows where
-- `valid_to is null or valid_to >= date`, ties still broken by
-- `created_at desc`.
--
-- HISTORICAL WEEKS MUST STILL PRICE. This is the load-bearing case, not an
-- edge case: a week worked in March has to keep resolving March's arrangement
-- after a July removal, or every past timesheet silently re-prices to nothing
-- the moment someone leaves. That is why the end is a per-date exclusion and
-- NOT a filter that hides ended rows from the history — `listForCarer` stays
-- unfiltered, and the in-memory resolver in `earningsService` (which prices
-- many dates from one fetch of that history) applies the same per-date rule.
--
-- APPEND-ONLY IS NOT BROKEN BY THIS
-- 041 forbids ever rewriting what a carer was paid: rate, currency, overtime,
-- guarantees, the lot. `valid_to` is a LIFECYCLE column, not a money field —
-- it records when terms stopped applying, and it is the only column on this
-- table with a write path. The CHECK below is what keeps that honest: an end
-- date can never precede the start, so this column can shorten an
-- arrangement's future but never retroactively un-pay a week already worked.
-- The money fields remain update-free, and there is still no RLS write policy
-- of any kind (the end-date write goes through the service role, like every
-- other write to this table — 041's RLS section).
--
-- PRE-DEPLOY CHECK (run against prod BEFORE applying; expect 0 rows, and if
-- any come back, 065 must not be applied until they are understood — they
-- would mean a `valid_to` already exists with values this CHECK rejects):
--   select id, household_id, carer_id, valid_from
--   from public.pay_arrangements
--   where valid_from is null;
-- And afterwards, to see what the removal path has ended:
--   select count(*) from public.pay_arrangements where valid_to is not null;

alter table public.pay_arrangements
  add column if not exists valid_to date;

-- No backfill, deliberately: null = still live, which is exactly the state
-- every arrangement that exists today is in.

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_valid_to_after_valid_from;
alter table public.pay_arrangements
  add constraint pay_arrangements_valid_to_after_valid_from
  check (valid_to is null or valid_to >= valid_from);

comment on column public.pay_arrangements.valid_to is
  'Household-local INCLUSIVE last day these terms price. Null = still live. Lifecycle only — set when a member is removed so a rejoin must re-confirm terms; the money fields on this table remain append-only.';

-- The existing (household_id, carer_id, valid_from desc) index still serves
-- the lookup: `valid_to` narrows a handful of already-matched rows, so
-- carrying it in the index would be write cost on a hot money table for no
-- read that needs it. Same reasoning 041 used to leave `created_at` out.
