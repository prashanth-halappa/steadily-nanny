-- 025 Keyed shift_events dedupe — partial unique index on payload.key (G7)
--
-- Concurrent GETs could both pass listEventKeysForDate and insert duplicate
-- coverage_gap / pattern_conflict rows. This migration removes existing dupes
-- (oldest wins) and enforces uniqueness at the DB layer for keyed events.

delete from public.shift_events se
using (
  select
    id,
    row_number() over (
      partition by household_id, local_date, event_type, (payload->>'key')
      order by created_at asc, id asc
    ) as rn
  from public.shift_events
  where (payload->>'key') is not null
) ranked
where se.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists shift_events_keyed_unique_idx
  on public.shift_events (household_id, local_date, event_type, (payload->>'key'))
  where (payload->>'key') is not null;
