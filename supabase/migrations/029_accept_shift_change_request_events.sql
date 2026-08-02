-- Migration 029: fold accept-path shift_events into accept RPC (D23/D24 / Wave C).
--
-- Accept previously wrote shift mutation under lock but day-thread events were
-- insertMany'd afterward — a crash could leave an accepted request with no
-- audit trail. Pass events as jsonb; RPC inserts them in the same transaction.
-- Superseded sibling events are derived from the closed CTE inside the RPC.
--
-- DROP the 024 signature first: adding `p_events` changes the identity args,
-- so CREATE OR REPLACE would leave a second overload and COMMENT ON would fail.

drop function if exists public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean
);

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
  p_is_short_notice boolean,
  p_events jsonb default '[]'::jsonb
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
  v_sibling public.shift_change_requests;
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

  if p_events is not null and jsonb_array_length(p_events) > 0 then
    insert into public.shift_events (
      household_id,
      shift_id,
      local_date,
      actor_id,
      event_type,
      payload
    )
    select
      (e->>'household_id')::uuid,
      (e->>'shift_id')::uuid,
      v_shift.local_date,
      nullif(e->>'actor_id', '')::uuid,
      e->>'event_type',
      coalesce(e->'payload', '{}'::jsonb)
    from jsonb_array_elements(p_events) as e;
  end if;

  foreach v_sibling in array v_superseded loop
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
      p_responded_by,
      'change_request_superseded',
      jsonb_build_object(
        'change_request_id', v_sibling.id,
        'kind', v_sibling.kind,
        'superseded_by', p_change_request_id
      )
    );
  end loop;

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
  boolean, timestamptz, timestamptz, text, boolean, jsonb
) from public;
revoke all on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean, jsonb
) from anon;
revoke all on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean, jsonb
) from authenticated;
grant execute on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean, jsonb
) to service_role;

comment on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean, jsonb
) is
  'Lock shift, CAS-accept, supersede siblings, apply mutation, insert day-thread events atomically. service_role only.';
