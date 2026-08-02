-- Migration 027: lock shift row and derive sequence in SQL (G4 / Wave C).
--
-- Migration 019 accepted caller-supplied p_sequence. Under concurrent parent
-- edits that allows lost updates. Re-lock with FOR UPDATE and bump from the
-- locked row's sequence instead.

create or replace function public.apply_parent_shift_edit(
  p_shift_id uuid,
  p_actor_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text,
  p_set_starts_at boolean,
  p_set_ends_at boolean,
  p_set_note boolean,
  p_origin text,
  p_sequence integer,
  p_before jsonb,
  p_after jsonb
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
      'before', p_before,
      'after', p_after,
      'actor_id', p_actor_id
    )
  );

  return v_shift;
end;
$$;

revoke all on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text, integer, jsonb, jsonb
) from public;
revoke all on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text, integer, jsonb, jsonb
) from anon;
revoke all on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text, integer, jsonb, jsonb
) from authenticated;
grant execute on function public.apply_parent_shift_edit(
  uuid, uuid, timestamptz, timestamptz, text, boolean, boolean, boolean, text, integer, jsonb, jsonb
) to service_role;

comment on function public.apply_parent_shift_edit is
  'Atomic parent shift edit + shift_updated event. Locks shift FOR UPDATE; sequence = locked.sequence + 1. service_role only.';
