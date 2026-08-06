-- 055 No overlapping time entries per carer — the database backstop
--
-- Closes the race 053's header documented and could not fix, and gives
-- `assertNoOverlap` its first backstop. Until now the application check was
-- the ONLY thing preventing overlapping time entries; nothing in the schema
-- disagreed with a double-paid hour.
--
-- THE DEFECT
-- Two concurrent paid-cancellation accepts can compute DIFFERENT remainders —
-- the carer clocks in between the two reads, so each derives a different
-- `clock_in_at`. 053's unique index is on `(shift_id, clock_in_at)`, so two
-- rows with different start times do not collide, and the result is two
-- overlapping payable entries for the same shift. The household pays twice for
-- the overlapping minutes. 053 named `btree_gist` as the fix and stopped there
-- because the extension was not installed; this installs it.
--
-- CANCELLATION PAY IS NOT TIME ON THE CLOCK
-- When household A cancels a shift with pay, A owes the full booked window
-- REGARDLESS of work the carer did for household B: the pay compensates A for
-- the booking A broke, not for hours anyone stood in a kitchen. So a
-- `cancellation_paid` entry must not participate in "she cannot be in two
-- places at once" the way a real clocked entry does. A single exclusion
-- constraint cannot express that — it cannot tell worked-vs-cancellation
-- WITHIN one household from the same pair ACROSS two. Two constraints can, and
-- between them they reproduce the agreed permission table exactly:
--
--   new WORKED (h1)       vs WORKED (h2)             REFUSE  -> per-carer
--   new WORKED (h1)       vs WORKED (h1)             REFUSE  -> both
--   new WORKED (h1)       vs CANCELLATION (h1)       REFUSE  -> per-household
--   new WORKED (h1)       vs CANCELLATION (h2)       PERMIT  -> neither
--   new CANCELLATION (h1) vs CANCELLATION (h2)       PERMIT  -> neither
--   new CANCELLATION (h1) vs WORKED (h2)             PERMIT  -> neither
--   new CANCELLATION (h1) vs CANCELLATION (h1)       REFUSE  -> per-household
--
-- WHERE manual_adjustment LANDS, AND WHY NOT `kind = 'worked'`
-- `017_time_tracking.sql` allows exactly three kinds: worked,
-- cancellation_paid, manual_adjustment. The per-carer constraint is keyed on
-- `kind <> 'cancellation_paid'`, NOT on `kind = 'worked'`, because a
-- manual_adjustment IS worked time — `timesheet.schema.ts` calls it "a
-- correction of worked time" and the earnings engine banks worked minutes as
-- `worked` + `manual_adjustment` (earningsService.ts). Keying on 'worked'
-- alone would permit a manual_adjustment for h1 to overlap a worked entry for
-- h2, which is the same physical impossibility the rule exists to forbid,
-- wearing a different label. Only cancellation pay is exempt, because only
-- cancellation pay is not presence.
--
-- BOTH CONSTRAINTS SHARE assertNoOverlap's OTHER TERMS
--   - carer-scoped (`carer_id with =`) — two carers working the same hours is
--     normal, not a conflict;
--   - skips rows with a null `clock_in_at` — assertNoOverlap `continue`s on
--     them, and `tstzrange(null, x)` would be unbounded BELOW and conflict
--     with everything before x.
--
-- HALF-OPEN BOUNDS, [)
-- `spansOverlap` is `aIn < bOut && bIn < aOut`: a span ending at 16:00 and one
-- starting at 16:00 do NOT overlap. `tstzrange`'s two-argument form already
-- defaults to `[)`, which matches, so no explicit bound argument is passed —
-- passing '[]' would reject exactly that legitimate back-to-back pair.
--
-- RUNNING ENTRIES ARE OUT OF SCOPE, DELIBERATELY
-- A running entry has `clock_out_at is null`, and `tstzrange(x, null)` is
-- unbounded ABOVE — it would conflict with every entry after it and break
-- legitimate retroactive writes for any carer with an open session. So both
-- constraints are partial on both timestamps being present.
--
-- The trade: this covers completed-vs-completed only. That is the money case
-- and the whole of the 053 race — both rows there are finished spans — but it
-- means running-vs-completed overlap is still enforced only by `spansOverlap`,
-- which already handles the null arm properly. A stricter version would need
-- to substitute a sentinel upper bound for open sessions, which buys a rule
-- the app already enforces at the cost of rejecting rows the app allows.
-- ponytail: completed-spans only; extend with a coalesced upper bound if a
-- running-entry overlap is ever observed in production.
--
-- NOT DEFERRABLE
-- The split-remainder path writes N fragments as N statements, but fragments
-- of one remainder are disjoint by construction, so each statement satisfies
-- the constraint on its own. Deferring would only delay the error to COMMIT
-- and throw away the statement that caused it.
--
-- THE APP CHECK STAYS. `assertNoOverlap` returns `TimeEntryOverlapError` with
-- the conflicting entry's id and span; this constraint returns a 23P01 with a
-- key. The app check is the good error message, this is the backstop under it,
-- and neither makes the other redundant — the constraint is what holds when
-- two requests race past the check in different connections.
--
-- DEPLOY RISK: unlike a CHECK, an exclusion constraint cannot be added NOT
-- VALID, so any PRE-EXISTING overlapping pair fails this ALTER and blocks the
-- deploy. That is the correct failure — it means real rows are double-paid and
-- want a human — but it should be checked before the deploy window, not
-- during it:
--   select a.id, b.id, a.carer_id, a.household_id, a.kind, b.kind,
--          a.clock_in_at, a.clock_out_at,
--          (a.kind <> 'cancellation_paid'
--           and b.kind <> 'cancellation_paid')      as breaks_per_carer,
--          (a.household_id = b.household_id)        as breaks_per_household
--   from public.time_entries a
--   join public.time_entries b
--     on a.carer_id = b.carer_id and a.id < b.id
--   where a.clock_in_at is not null and a.clock_out_at is not null
--     and b.clock_in_at is not null and b.clock_out_at is not null
--     and tstzrange(a.clock_in_at, a.clock_out_at)
--      && tstzrange(b.clock_in_at, b.clock_out_at);
-- A row with both flags false is the newly PERMITTED case (worked for one
-- family, cancellation pay from another) and blocks nothing.
--
-- The ALTERs also take an ACCESS EXCLUSIVE lock while they build the gist
-- indexes. `time_entries` is small, so this is brief.

create extension if not exists btree_gist;

-- 1. Time on the clock cannot overlap for one carer, in ANY household.
--    cancellation_paid is excluded: it is compensation, not presence.
alter table public.time_entries
  drop constraint if exists time_entries_no_clock_overlap_per_carer;

alter table public.time_entries
  add constraint time_entries_no_clock_overlap_per_carer
  exclude using gist (
    carer_id with =,
    tstzrange(clock_in_at, clock_out_at) with &&
  ) where (
    kind <> 'cancellation_paid'
    and clock_in_at is not null
    and clock_out_at is not null
  );

-- 2. Within ONE household, no two entries of any kind may overlap for a
--    carer — that is the same family paying twice for the same window.
alter table public.time_entries
  drop constraint if exists time_entries_no_overlap_per_household;

alter table public.time_entries
  add constraint time_entries_no_overlap_per_household
  exclude using gist (
    carer_id with =,
    household_id with =,
    tstzrange(clock_in_at, clock_out_at) with &&
  ) where (clock_in_at is not null and clock_out_at is not null);
