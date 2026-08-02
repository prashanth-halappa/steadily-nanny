-- Migration 031: derive the parent-edit audit record from the LOCKED row.
--
-- 027 stopped trusting the caller for the row's `sequence` (it now bumps
-- `v_locked.sequence + 1` under FOR UPDATE) but still accepted the caller's
-- p_sequence/p_before/p_after for the shift_updated EVENT. Those are computed
-- from an unlocked pre-read, so under the exact race 027 exists to close --
-- parent reads sequence=3, a nanny accept commits 4, the parent's RPC then
-- takes the lock and the row correctly becomes 5 -- the event still recorded
-- `before.sequence=3, after.sequence=4`, and its `before` snapshot (starts_at,
-- note, ...) described state a concurrent writer had already overwritten. The
-- lost update was relocated from the row into the append-only audit trail, not
-- fixed.
--
-- Fix: build the event inside the function from `v_locked` (true pre-state,
-- read under lock) and `v_shift` (what the UPDATE actually returned), the same
-- way 029 derives its superseded-sibling events from the closed CTE rather
-- than from parameters. p_sequence (dead since 027), p_before and p_after all
-- go away -- ANY snapshot taken before the lock is stale by construction.
--
-- DROP the 027 signature first: removing three parameters changes the identity
-- args, so CREATE OR REPLACE would leave the old racy overload live and
-- callable, and COMMENT ON would fail with 42725 (function name is not
-- unique). A new overload also inherits NO grants, so the full
-- revoke/grant block is repeated below with the new type list.

drop function if exists public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text, integer, jsonb, jsonb
);

create or replace function public.apply_parent_shift_edit(
  p_shift_id uuid,
  p_actor_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text,
  p_set_starts_at boolean,
  p_set_ends_at boolean,
  p_set_note boolean,
  p_origin text
)
returns public.shifts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_locked public.shifts;
  v_shift public.shifts;
begin
  select * into v_locked
  from public.shifts
  where id = p_shift_id
  for update;

  if v_locked.id is null then
    raise exception 'shift not found: %', p_shift_id;
  end if;

  update public.shifts
  set
    starts_at = case when p_set_starts_at then p_starts_at else starts_at end,
    ends_at = case when p_set_ends_at then p_ends_at else ends_at end,
    note = case when p_set_note then p_note else note end,
    origin = p_origin,
    sequence = v_locked.sequence + 1,
    updated_at = now()
  where id = p_shift_id
  returning * into v_shift;

  insert into public.shift_events (
    household_id,
    shift_id,
    local_date,
    actor_id,
    event_type,
    payload
  ) values (
    v_shift.household_id,
    v_shift.id,
    v_shift.local_date,
    p_actor_id,
    'shift_updated',
    jsonb_build_object(
      'before', jsonb_build_object(
        'starts_at', v_locked.starts_at,
        'ends_at', v_locked.ends_at,
        'note', v_locked.note,
        'sequence', v_locked.sequence,
        'origin', v_locked.origin
      ),
      'after', jsonb_build_object(
        'starts_at', v_shift.starts_at,
        'ends_at', v_shift.ends_at,
        'note', v_shift.note,
        'sequence', v_shift.sequence,
        'origin', v_shift.origin
      ),
      'actor_id', p_actor_id
    )
  );

  return v_shift;
end;
$$;

revoke all on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text
) from public;
revoke all on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text
) from anon;
revoke all on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text
) from authenticated;
grant execute on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text
) to service_role;

comment on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text
) is
  'Atomic parent shift edit + shift_updated event. Locks shift FOR UPDATE; sequence = locked.sequence + 1; before/after derived from the locked and returned rows, never from the caller. service_role only.';
