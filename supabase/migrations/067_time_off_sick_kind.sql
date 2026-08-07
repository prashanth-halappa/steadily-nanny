-- 067 Sick days — a kind discriminator on carer_time_off
--
-- "I'm ill at 6:30am" had no first-class object: the only shapes were a
-- planned time-off request or silently not turning up. A sick day IS time
-- off — same table, same conflict push, same range constraints — it just
-- needs a discriminator so a same-day absence renders and notifies as
-- sickness rather than as a holiday request. One new column, no new table,
-- no status change: sick rows move through requested/confirmed/cancelled
-- exactly like personal ones.
--
-- BACKFILL IS THE DEFAULT
-- Every pre-067 row was a personal request, so `default 'personal'` on a
-- NOT NULL column backfills existing rows implicitly and keeps every
-- existing insert working unchanged. No UPDATE statement, no data rewrite.
--
-- PRIVACY LINE — DO NOT MOVE IT
-- v_busy_blocks (016_calendar_seams.sql) exposes exactly starts_at /
-- ends_at / kind, where kind is the anonymised BLOCK kind ('time_off'),
-- not this column. This migration deliberately does not touch the view: to
-- every OTHER household a sick day reads as plain time off. Whether a
-- carer is sick is between her and the family whose shift it affects —
-- surfacing it cross-household would be the exact leak
-- AnonymisedBusyBlockSchema exists to prevent.

alter table public.carer_time_off
  add column if not exists kind text not null default 'personal';

-- House pattern (053/055/063/064): drop-if-exists then add, so the
-- migration is re-runnable and `db reset` never dies on the second pass.
alter table public.carer_time_off
  drop constraint if exists carer_time_off_kind_check;

alter table public.carer_time_off
  add constraint carer_time_off_kind_check
  check (kind in ('personal', 'sick'));

comment on column public.carer_time_off.kind is
  'personal = planned time off; sick = same-day illness. Renders/notifies differently in-household; anonymised to plain time_off in the busy-block view for every other household.';
