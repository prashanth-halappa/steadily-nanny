-- 070 Uncovered-care rework — invert the coverage-gap detector
--
-- The shipped detector was inverted: it alerted when the nanny WAS scheduled
-- during a child's excluded window. Uncovered care is the opposite — alert
-- when a child's declared NEED window (every `child_commitments` row) is NOT
-- covered by any shift. The per-row `excluded_from_cover` flag is therefore
-- removed; every commitment row is now a declared need window. Labels are
-- optional because a care-hours entry no longer requires a name.
--
-- Legacy `coverage_gap` shift_events described the opposite condition and are
-- deleted — the app is pre-launch. Migration 025's keyed-unique expression
-- index already covers the new `uncovered_care` event type (no new index
-- needed).

alter table public.child_commitments drop column excluded_from_cover;
alter table public.child_commitments alter column label drop not null;

delete from public.shift_events where event_type = 'coverage_gap';
