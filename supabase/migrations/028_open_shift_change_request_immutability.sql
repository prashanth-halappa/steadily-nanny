-- Migration 028: refuse open on immutable shifts (G4 / Wave C).
--
-- open_shift_change_request already locks the shift; add the same immutability
-- guard as accept so pending rows are never created against settled shifts.

create or replace function public.open_shift_change_request(
  p_shift_id uuid,
  p_requested_by uuid,
  p_kind text,
  p_proposed_starts_at timestamptz,
  p_proposed_ends_at timestamptz,
  p_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.shifts;
  v_created public.shift_change_requests;
  v_superseded public.shift_change_requests[];
  v_has_time_entries boolean;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then
    return jsonb_build_object('outcome', 'shift_not_found');
  end if;

  if v_shift.status in ('completed', 'cancelled') then
    return jsonb_build_object(
      'outcome', 'shift_immutable',
      'shift_id', v_shift.id,
      'shift_status', v_shift.status,
      'blocked_by', 'status'
    );
  end if;

  select exists (
    select 1 from public.time_entries where shift_id = v_shift.id limit 1
  ) into v_has_time_entries;

  if v_has_time_entries then
    return jsonb_build_object(
      'outcome', 'shift_immutable',
      'shift_id', v_shift.id,
      'shift_status', v_shift.status,
      'blocked_by', 'has_time_entries'
    );
  end if;

  with closed as (
    update public.shift_change_requests
    set status = 'superseded', updated_at = now()
    where shift_id = p_shift_id
      and status = 'pending'
    returning *
  )
  select coalesce(array_agg(c), '{}')
  into v_superseded
  from closed c;

  insert into public.shift_change_requests (
    shift_id,
    requested_by,
    kind,
    proposed_starts_at,
    proposed_ends_at,
    message,
    status
  ) values (
    p_shift_id,
    p_requested_by,
    p_kind,
    p_proposed_starts_at,
    p_proposed_ends_at,
    p_message,
    'pending'
  )
  returning * into v_created;

  return jsonb_build_object(
    'outcome', 'opened',
    'change_request', to_jsonb(v_created),
    'superseded', coalesce(
      (select jsonb_agg(to_jsonb(s)) from unnest(v_superseded) s),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.open_shift_change_request(
  uuid, uuid, text, timestamptz, timestamptz, text
) from public;
revoke all on function public.open_shift_change_request(
  uuid, uuid, text, timestamptz, timestamptz, text
) from anon;
revoke all on function public.open_shift_change_request(
  uuid, uuid, text, timestamptz, timestamptz, text
) from authenticated;
grant execute on function public.open_shift_change_request(
  uuid, uuid, text, timestamptz, timestamptz, text
) to service_role;

comment on function public.open_shift_change_request is
  'Lock shift, recheck immutability, supersede pending, insert new pending. service_role only.';
