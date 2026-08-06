-- Migration 050: serialise PTO corrections and reversals (F-B4-2).
--
-- `ptoCommandService.writeCorrection` and `reverseNettedUsage` both READ the
-- household's netted per-day total for one time off and THEN insert the
-- `adjustment` rows for the difference. Nothing holds a lock in between, so
-- two parents correcting 8h -> 6h at the same instant both read 8h, both
-- write +120, and the ledger lands at 4h. A classic lost update, over real
-- money owed, in an append-only table nobody can edit back.
--
-- EVERY marking goes through here, including the FIRST one. Serialising only
-- the corrections was not enough while a first marking still wrote one
-- `usage` row per covered day as separate statements outside the lock. Two
-- parents on one 5-day time off, A marking 480 and B marking 360: A inserts
-- d1..d3, B reads those three rows and therefore takes the CORRECTION branch,
-- B's compare-and-set legitimately matches and it writes 360 across d1..d5,
-- then A resumes and inserts `usage` on d4 and d5 -- which 045's index does
-- not stop, because it is partial on `kind = 'usage'` and B wrote
-- `adjustment` rows there. The ledger settles on 552 minutes, neither
-- parent's figure, and both were told they succeeded. The root cause is that
-- the caller decides "first marking or correction" from an UNLOCKED read, so
-- two callers can disagree about which one they are doing; the fix is that
-- the whole batch, of either kind, is one statement inside this lock.
--
-- 045's per-day partial unique index is NOT dropped, replaced or narrowed --
-- it is now the last line of defence rather than the only one, and every
-- insert it guards happens under this lock. `adjustment` rows deliberately
-- have NO unique index: unlimited corrections per (household, time_off) is
-- the whole point of the delta rule (docs/11-MONEY.md section 5), which is
-- why they need serialisation rather than a constraint.
--
-- THE SHAPE is 024's and 027's, for the same class of bug 027's header
-- describes: lock an anchor row FOR UPDATE first, do the read-compute-write
-- under that lock, and return an outcome jsonb rather than raising, so the TS
-- layer maps it to a typed domain error. The anchor is the `carer_time_off`
-- row, which every correction and every reversal for one time off shares --
-- and which a cancel also locks when it flips the status, so a cancel racing
-- a correction serialises for free.
--
-- COMPARE-AND-SET, not compute-in-SQL. The caller sends the per-day state it
-- computed its deltas from (`p_expected`, {'YYYY-MM-DD': paid_minutes}) plus
-- the rows it wants written; this re-derives that map under the lock and
-- refuses with 'stale' if it moved. The money arithmetic -- allocateMinutes'
-- largest-remainder split, the household timezone's covered days, the note
-- keys -- therefore stays in one tested place in TypeScript instead of being
-- re-implemented in plpgsql where no unit test can reach it.
--
-- SECURITY: SECURITY INVOKER, service_role EXECUTE only, same as 024/027.
-- `p_rows` is caller-supplied, so household_id and time_off_id are NOT read
-- from it -- the insert takes both from the locked parameters, and a
-- malformed payload therefore cannot write into another household's ledger.
-- `kind` DOES come from the payload, because a first marking and a correction
-- are now the same call; `pto_ledger`'s own check constraint bounds it, and
-- 045's index still bounds where a `usage` row may land.

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
  'Lock carer_time_off FOR UPDATE, compare-and-set the household''s per-day netted PTO total, append adjustment rows. service_role only.';
