-- 079 The PTO draw records what the day WAS — leave_kind on pto_ledger
--
-- Binding sources: TRUST-AND-TERMS-PLAYBOOK.md §5 decision D-11 (gap T5) and
-- D-23. Amends 043_pto_ledger.sql's table and re-issues 050's
-- apply_pto_correction; neither of those files is edited.
--
-- WHAT D-11 DECIDED, AND WHAT IT DID NOT
-- PTO stays a SINGLE pool: one calendar-year grant, one balance, one
-- sum(minutes). There is no sick pool and no vacation pool, no per-hour
-- accrual, and no configurable leave year in this build. What D-11 DOES add
-- is a label: the ledger should record what a paid day was, so a household
-- reading its own history can tell a sick day from a planned one, and so
-- 3-T3's D-23 interplay (sick time off auto-opens cancel change-requests for
-- the overlapping shifts, pay resolves by the normal three-arm rule, and the
-- PTO drawn is sick-labelled) has a label to draw against. A label is not a
-- second pool: nothing in this migration touches the balance arithmetic,
-- and nothing may.
--
-- 068 LABELLED THE LEAVE; THIS LABELS THE DRAW
-- 068_time_off_sick_kind.sql gave `carer_time_off` a `kind` discriminator
-- ('personal' | 'sick') so a same-day absence renders and notifies as
-- sickness rather than as a holiday request. That is the leave. The DRAW is
-- the household-scoped `pto_ledger` row that records this family paying for
-- that day, and until now it carried no label at all.
--
-- WHY A SNAPSHOT COLUMN AND NOT A JOIN
-- A usage row already carries `time_off_id`, so the label looks derivable.
-- It is not, for three independent reasons, any one of which settles it:
--   1. `time_off_id` is `on delete set null` (043's 033-discipline) — the
--      join evaporates the moment the time off goes, and the household's
--      ledger is supposed to outlive exactly that.
--   2. `carer_time_off.kind` is PATCHable — UpdateCarerTimeOffSchema can
--      promote a still-requested personal row to sick. This ledger is
--      append-only history: it must record what the day WAS when it was
--      drawn, not what the leave was later re-described as.
--   3. `carer_time_off` carries no household reference at all (011) —
--      deriving the label on every household's ledger read means reaching
--      outside that household's scope on a pure read path, for a fact the
--      household already paid for and is entitled to keep.
-- That is `carer_display_name`'s argument from 043's own header, applied to
-- the second field this ledger cannot afford to lose. The privacy line does
-- not move: this is the household's record of its own payment, not a new
-- window onto the carer's other families, and v_busy_blocks is untouched.
--
-- THE FUNCTION STAMPS IT, THE CALLER DOES NOT
-- Since 050, EVERY usage and adjustment row — including the first marking —
-- is written by `apply_pto_correction`, which already holds the
-- `carer_time_off` row it LOCKED for update. So the label is taken from that
-- locked row, not from the caller-supplied `p_rows`: the same stance 050
-- already takes for `household_id` and `time_off_id`, and for the same
-- reason. A caller cannot mislabel its own draw, and no service code has to
-- remember to send the field. `create or replace` with the IDENTICAL
-- five-argument signature — the arg list does not change, so D46's
-- drop-before-replace trap stays disarmed and the existing grants survive.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL
-- An `accrual` row draws no leave, so null is its honest value, not a
-- placeholder. Pre-079 rows are equally honestly null — "not recorded" —
-- and per D-9 (pre-launch wipe) there is nothing live to backfill anyway. A
-- `default 'personal'` would assert something about days nobody labelled,
-- which is the one thing an append-only ledger must never be made to do.
--
-- ADDITIVE AND SAFE
-- One nullable column and one function body. No index is created, dropped
-- or narrowed — 045's per-day partial unique index and 043's accrual index
-- both stand. No RLS policy changes. No update or delete path is added to a
-- table that has neither. The compare-and-set and its outcome envelope are
-- reproduced character for character.

alter table public.pto_ledger
  add column if not exists leave_kind text;

-- House pattern (053/055/063/064/068): drop-if-exists then add, so the
-- migration is re-runnable and `db reset` never dies on the second pass.
alter table public.pto_ledger
  drop constraint if exists pto_ledger_leave_kind_check;

-- Mirrors 068's check exactly, plus null. Adding a third leave kind here
-- without re-reading D-11 would be the first step towards a split pool.
alter table public.pto_ledger
  add constraint pto_ledger_leave_kind_check
  check (
    leave_kind is null or leave_kind in ('personal', 'sick')
  );

comment on column public.pto_ledger.leave_kind is
  'What the paid day WAS, snapshotted from carer_time_off.kind at draw time by apply_pto_correction under its lock. Null on accrual rows and on pre-079 rows. A label, not a second pool: the balance is still sum(minutes) over one pool (D-11).';

-- ---------------------------------------------------------------------------
-- apply_pto_correction — 050's function, stamping the label
-- ---------------------------------------------------------------------------
-- Identical signature, identical lock, identical compare-and-set, identical
-- outcome envelope. The ONLY change is that the insert now also writes
-- `leave_kind`, taken from the locked `carer_time_off` row.

create or replace function public.apply_pto_correction(
  p_household_id uuid,
  p_time_off_id uuid,
  p_expected jsonb,
  p_rows jsonb,
  p_require_confirmed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_time_off public.carer_time_off;
  v_leave_kind text;
  v_actual jsonb;
  v_written jsonb;
begin
  select * into v_time_off
  from public.carer_time_off
  where id = p_time_off_id
  for update;

  if v_time_off.id is null then
    return jsonb_build_object('outcome', 'time_off_not_found');
  end if;

  if p_require_confirmed and v_time_off.status <> 'confirmed' then
    return jsonb_build_object(
      'outcome', 'not_confirmed',
      'current_status', v_time_off.status
    );
  end if;

  -- 079: the label comes from the row this transaction holds the lock on,
  -- never from p_rows -- the same rule household_id and time_off_id follow.
  v_leave_kind := v_time_off.kind;

  -- POSITIVE paid minutes per day: the ledger stores usage negative, and the
  -- netted total is -sum over usage and adjustments alike.
  select coalesce(jsonb_object_agg(day.effective_date::text, -day.minutes), '{}'::jsonb)
  into v_actual
  from (
    select effective_date, sum(minutes) as minutes
    from public.pto_ledger
    where household_id = p_household_id
      and time_off_id = p_time_off_id
    group by effective_date
  ) day;

  if v_actual <> coalesce(p_expected, '{}'::jsonb) then
    return jsonb_build_object('outcome', 'stale', 'current', v_actual);
  end if;

  with written as (
    insert into public.pto_ledger (
      household_id,
      carer_id,
      kind,
      minutes,
      effective_date,
      time_off_id,
      leave_kind,
      carer_display_name,
      note,
      created_by
    )
    select
      p_household_id,
      r.carer_id,
      r.kind,
      r.minutes,
      r.effective_date,
      p_time_off_id,
      v_leave_kind,
      r.carer_display_name,
      r.note,
      r.created_by
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      carer_id uuid,
      kind text,
      minutes integer,
      effective_date date,
      carer_display_name text,
      created_by uuid,
      note text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(w) order by w.effective_date), '[]'::jsonb)
  into v_written
  from written w;

  return jsonb_build_object('outcome', 'applied', 'rows', v_written);
end;
$$;

revoke all on function public.apply_pto_correction(
  uuid, uuid, jsonb, jsonb, boolean
) from public;
revoke all on function public.apply_pto_correction(
  uuid, uuid, jsonb, jsonb, boolean
) from anon;
revoke all on function public.apply_pto_correction(
  uuid, uuid, jsonb, jsonb, boolean
) from authenticated;
grant execute on function public.apply_pto_correction(
  uuid, uuid, jsonb, jsonb, boolean
) to service_role;

comment on function public.apply_pto_correction is
  'Lock carer_time_off FOR UPDATE, compare-and-set the household''s per-day netted PTO total, append adjustment rows stamped with the locked row''s leave_kind. service_role only.';
