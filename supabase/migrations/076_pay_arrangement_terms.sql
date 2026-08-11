-- 076 Pay arrangement terms — the documentary, non-priced agreement
--
-- One jsonb column on the already-existing `public.pay_arrangements` (041's
-- table). No new table, no new policy — the existing RLS already scopes
-- reads/writes on this table to a member; a terms column is just more data
-- on a row a member could already see.
--
-- WHAT LIVES HERE
-- Notice period, probation length, duties scope, driving requirements,
-- live-in conditions — the parts of a pay arrangement that are agreed but
-- never priced. Before this column the only place any of that could go was
-- the free-text `note`, a dumping ground with no shape at all.
--
-- OPAQUE PASSTHROUGH THIS BUILD (Phase 1, T9 storage)
-- The engine never reads this column and nothing prices it — it is stored
-- and returned, nothing more. A typed shape (and the UI to edit it) comes
-- with a later slice (3-U1); until then this is deliberately untyped on the
-- wire too (`z.record(z.string(), z.unknown())`), so an early write here
-- never has to be migrated when the real shape lands.
--
-- NOT NULL DEFAULT '{}', SAME AS THE ROW BEFORE IT HAD ONE
-- Every arrangement row, including ones written before terms existed, reads
-- as an empty bag rather than null — one shape for "no terms yet" and
-- "terms explicitly empty", never a third null case for callers to guard.

alter table public.pay_arrangements
  add column if not exists terms jsonb not null default '{}'::jsonb;
