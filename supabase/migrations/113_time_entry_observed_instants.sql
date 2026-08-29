-- ---------------------------------------------------------------------------
-- 113_time_entry_observed_instants.sql — what the app WATCHED, kept beside
-- what the carer SAYS, so a correction stops destroying the evidence
--
-- APPLIED to prod 2026-08-29, via the Supabase MCP `apply_migration`, in order
-- after 112 — never `supabase db push` (version-scheme mismatch; see 092's
-- header and the note in docs/ROLLBACK-RUNBOOK.md). Both columns verified
-- present, nullable and commented after applying.
--
-- Wire: packages/shared-types/src/schemas/timesheet.schema.ts
--         (`TimeEntrySchema.observed_clock_in_at` / `observed_clock_out_at`)
-- Write: apps/api/src/domains/timesheet/services/timesheetCommandService.ts
--          (`clockIn` -> observed in, `clockOut` -> observed out,
--           `clockOutAcrossWeeks` -> observed out on fragment B only)
-- Read:  apps/mobile/src/domains/timesheet/utils/entryEdited.ts
--          (`wasEntryEdited` — the "Edited" marker on an Hours row)
--
-- =========================================================================
-- THE GAP
-- =========================================================================
--
-- 017 gave this table ONE pair of clock columns. So a carer correcting a
-- wrong start time overwrites the only record of what the app actually
-- observed, and the app's own testimony is gone. That is the real reason the
-- start has been uneditable while a shift runs — not distrust, which appears
-- nowhere in this domain: "we record what happened, not what was planned"
-- (today.json `clockInHint`) is a promise the schema could not keep through
-- an edit.
--
-- The cost lands on the carer. She taps Clock in twenty minutes after she
-- actually started, and today she cannot fix it until she has clocked out.
--
-- =========================================================================
-- SHAPE
-- =========================================================================
--
-- Two columns, nullable, no backfill, no index, and NOTHING reads them for
-- money. The live pair keeps its meaning exactly: `clock_in_at` /
-- `clock_out_at` remain EFFECTIVE — what gets paid, summed, bucketed into a
-- week and priced by the earnings engine. The new pair is OBSERVED — the
-- instant the app watched a tap, written once and never updated.
--
--   observed_clock_in_at   stamped by `clockIn` with the same instant it
--                          writes to `clock_in_at`.
--   observed_clock_out_at  stamped by `clockOut` with the SERVER's clock,
--                          which is deliberately not always `clock_out_at`:
--                          a forgotten clock-out lets the carer declare the
--                          finish she actually left at, and the divergence
--                          between the two is the honest record of that.
--
-- NULL MEANS "NOT OBSERVED", NEVER "UNCHANGED". Four cases are null on
-- purpose, and readers must not treat any of them as a correction:
--   - every row written before this migration;
--   - retroactive entries (`createRetroactiveEntry`) — a claim about the
--     past, which the app never watched, and that null is exactly what
--     distinguishes one from a real clock-out;
--   - cancellation-pay rows — system-generated compensation, nobody tapped;
--   - the boundary end of a split session. A session crossing midnight or a
--     week boundary is cut into two rows: fragment A CLOSES at the boundary
--     and fragment B OPENS at it. A boundary is computed, not observed, so
--     exactly one end of each fragment carries an observation. Get this
--     wrong and every overnight shift renders as "Edited" — which is the
--     precise false-marker class `wasEntryEdited` needs its
--     `endsAtLocalMidnight` exception to suppress today.
--
-- Consequently the derived question "was this corrected?" is
-- `observed IS NOT NULL AND observed IS DISTINCT FROM effective`. The
-- IS NOT NULL half is load-bearing: without it every null above reads as a
-- correction.
--
-- FROZEN BY CONVENTION, NOT BY THE DATABASE. There is no column grant and no
-- trigger stopping an update; the guarantee is that `updateEntry`'s patch
-- never names these columns, and a unit test asserts exactly that. A DB-level
-- guard would be the stronger answer and is deliberately deferred — this
-- schema uses no column-level grants anywhere, and introducing the first one
-- for an audit field nothing yet disputes is a bigger change than the risk.
--
-- No index on either. They are audit fields: never filtered, never joined,
-- never ordered by. The only read compares them to two columns already on the
-- same row.
--
-- Nothing else in the schema is affected. The `sync_time_entries_local_date`
-- trigger fires `before insert or update of clock_in_at, clock_out_at,
-- timezone` (017) and so is inert to these; the `time_entries_clock_order`
-- check (017) and 055's `tstzrange` exclusion constraints both reference only
-- the live pair; and the RLS policy (087) is row-level with no column list.
-- ---------------------------------------------------------------------------

alter table public.time_entries
  add column if not exists observed_clock_in_at timestamptz;

alter table public.time_entries
  add column if not exists observed_clock_out_at timestamptz;

comment on column public.time_entries.observed_clock_in_at is
  'The instant the app WATCHED the carer tap Clock in, frozen at insert and never updated — `clock_in_at` beside it is the EFFECTIVE start, which she may correct. null means NOT OBSERVED, never "unchanged": every row predating 113, every retroactive entry, every cancellation-pay row, and the boundary-opened half of a split session. Audit only: never rendered, never summed, never priced. A reader asking "was the start corrected?" must test `observed_clock_in_at is not null and observed_clock_in_at is distinct from clock_in_at`.';

comment on column public.time_entries.observed_clock_out_at is
  'The instant the app WATCHED the carer tap Clock out — the SERVER''s clock, deliberately not always equal to `clock_out_at`: a forgotten clock-out lets her declare the finish she actually left at, and the gap between the two is the honest record of that. Frozen at clock-out, never updated. null means NOT OBSERVED (see the sibling column), including the boundary-closed half of a split session — a boundary is computed, not tapped. Audit only.';

-- Rollback, if 113 has to come out:
-- 1. alter table public.time_entries drop column if exists observed_clock_in_at;
-- 2. alter table public.time_entries drop column if exists observed_clock_out_at;
-- `wasEntryEdited` falls back to its `updated_at` heuristic for any row where
-- both are null, so dropping them degrades the marker's precision without
-- breaking the read.
