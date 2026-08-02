-- Migration 024: serialise shift_change_requests per shift (G4).
--
-- Row-level CAS on a single change_request row does not serialise two
-- different pending requests on the same shift — both can be accepted
-- concurrently. Both flows lock the parent shift FOR UPDATE first so only
-- one accept/open mutation runs at a time per shift.
--
-- SECURITY: same pattern as 019 — SECURITY INVOKER, service_role EXECUTE only.

-- ---------------------------------------------------------------------------
-- accept_shift_change_request
-- ---------------------------------------------------------------------------

create or replace function public.accept_shift_change_request(
  p_change_request_id uuid,
  p_responded_by uuid,
  p_response_message text,
  p_set_cancel boolean,
  p_cancelled_at timestamptz,
  p_cancelled_by uuid,
  p_cancellation_paid boolean,
  p_cancellation_message text,
  p_set_times boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_origin text,
  p_is_short_notice boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request public.shift_change_requests;
  v_shift public.shifts;
  v_accepted public.shift_change_requests;
  v_superseded public.shift_change_requests[];
  v_has_time_entries boolean;
begin
  select * into v_request
  from public.shift_change_requests
  where id = p_change_request_id;

  if v_request.id is null then
    return jsonb_build_object('outcome', 'not_pending', 'current_status', 'missing');
  end if;

  select * into v_shift
  from public.shifts
  where id = v_request.shift_id
  for update;

  if v_shift.id is null then
    return jsonb_build_object('outcome', 'shift_not_found', 'shift_id', v_request.shift_id);
  end if;

  -- Mirror ShiftRepository.assertMutable: completed/cancelled or clocked-into.
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

  update public.shift_change_requests
  set
    status = 'accepted',
    responded_by = p_responded_by,
    responded_at = now(),
    response_message = p_response_message,
    updated_at = now()
  where id = p_change_request_id
    and status = 'pending'
  returning * into v_accepted;

  if v_accepted.id is null then
    select status into v_request.status
    from public.shift_change_requests
    where id = p_change_request_id;

    return jsonb_build_object(
      'outcome', 'not_pending',
      'current_status', coalesce(v_request.status, 'missing')
    );
  end if;

  with closed as (
    update public.shift_change_requests
    set status = 'superseded', updated_at = now()
    where shift_id = v_shift.id
      and status = 'pending'
      and id <> p_change_request_id
    returning *
  )
  select coalesce(array_agg(c), '{}')
  into v_superseded
  from closed c;

  if p_set_cancel then
    update public.shifts
    set
      status = 'cancelled',
      cancelled_at = p_cancelled_at,
      cancelled_by = p_cancelled_by,
      cancellation_paid = p_cancellation_paid,
      cancellation_message = p_cancellation_message,
      is_short_notice = p_is_short_notice,
      origin = p_origin,
      updated_at = now()
    where id = v_shift.id
    returning * into v_shift;
  elsif p_set_times then
    update public.shifts
    set
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      origin = p_origin,
      is_short_notice = p_is_short_notice,
      sequence = v_shift.sequence + 1,
      updated_at = now()
    where id = v_shift.id
    returning * into v_shift;
  end if;

  return jsonb_build_object(
    'outcome', 'accepted',
    'change_request', to_jsonb(v_accepted),
    'shift', to_jsonb(v_shift),
    'superseded', coalesce(
      (select jsonb_agg(to_jsonb(s)) from unnest(v_superseded) s),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean
) from public;
revoke all on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean
) from anon;
revoke all on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean
) from authenticated;
grant execute on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean
) to service_role;

comment on function public.accept_shift_change_request is
  'Lock shift, CAS-accept one change request, supersede pending siblings, apply shift mutation. service_role only.';

-- ---------------------------------------------------------------------------
-- open_shift_change_request
-- ---------------------------------------------------------------------------

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
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then
    return jsonb_build_object('outcome', 'shift_not_found');
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
  'Lock shift, supersede all pending change requests, insert a new pending one. service_role only.';
