-- Migration 030: fold open-path shift_events into the open RPC, and document
-- the day-thread semantics 029 introduced (D23/D24 / Wave C).
--
-- 029 closed the accept path's crash window but left open asymmetric:
-- open_shift_change_request (024/028) committed the new pending row, and only
-- THEN did the API insert `change_request_created` + N
-- `change_request_superseded` in a second round-trip. A crash in between left
-- a change request with no day-thread audit trail — the identical defect 029
-- fixed for accept. Same fix: the RPC writes them in its own transaction.
--
-- Why this adds NO events parameter (unlike 029): every field of both events
-- is already known to this function and NOT to the caller.
-- `change_request_created` names the id of the row this function inserts, and
-- `change_request_superseded` names the ids its own CTE just closed. Passing
-- them in would mean sending placeholders for the database to overwrite —
-- exactly the dishonest contract this migration's sibling change removes from
-- the accept path (see the `local_date` note below). Keeping the 6-argument
-- identity also means `create or replace` rebinds the function in place: no
-- second overload, no `42725 function is not unique`, no silently dropped
-- grants, and no deploy-ordering window in which the API sends an argument
-- the currently-deployed function does not accept. The revoke/grant block is
-- restated below anyway, so the permission contract stays readable in one
-- place rather than only in 024.
--
-- DAY-THREAD SEMANTICS (applies to 029's accept path as well; restated here
-- as a function comment because 029 is already applied to the live project
-- and must not be edited):
--
--   The day a shift_event lands on is resolved INSIDE the RPC, from
--   `v_shift.local_date` — the shift row held under lock, read AFTER any
--   mutation the same call applied. `shifts.local_date` is maintained by the
--   `sync_shift_local_date` trigger (015), so an accepted time change that
--   crosses local midnight moves the shift to a new local day, and its audit
--   trail follows it there. That is deliberate: the alternative strands the
--   history on a day the shift no longer occupies, leaving the day it moved
--   to showing a shift with no explanation of how it got there.
--
--   Callers therefore do not supply a local_date, and cannot meaningfully do
--   so — only the RPC can see the post-mutation value. 029 hard-coded
--   `v_shift.local_date` for every row built from its events argument while
--   the API kept sending a (pre-update, always-discarded) `local_date`; that
--   field has been removed from the TypeScript contract rather than honoured
--   in SQL, so the wire shape now matches what the database actually does.

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
  v_sibling public.shift_change_requests;
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

  -- Day-thread audit trail, same transaction as the row it describes.
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
    p_requested_by,
    'change_request_created',
    jsonb_build_object(
      'change_request_id', v_created.id,
      'kind', p_kind,
      'message', p_message
    )
  );

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
      p_requested_by,
      'change_request_superseded',
      jsonb_build_object(
        'change_request_id', v_sibling.id,
        'kind', v_sibling.kind,
        'superseded_by', v_created.id
      )
    );
  end loop;

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

comment on function public.open_shift_change_request(
  uuid, uuid, text, timestamptz, timestamptz, text
) is
  'Lock shift, recheck immutability, supersede pending, insert new pending, '
  'and insert the created/superseded day-thread events — one transaction. '
  'Event local_date is resolved from the locked shift row, never from the '
  'caller. service_role only.';

-- 029 is already applied and must not be edited; state the semantics its own
-- header should have carried, qualified with its argument list.
comment on function public.accept_shift_change_request(
  uuid, uuid, text, boolean, timestamptz, uuid, boolean, text,
  boolean, timestamptz, timestamptz, text, boolean, jsonb
) is
  'Lock shift, CAS-accept, supersede siblings, apply mutation, insert '
  'day-thread events atomically. Event local_date is resolved from the '
  'POST-mutation shift row, so an accepted time change that crosses local '
  'midnight files its audit trail on the day the shift moved TO, not the day '
  'it left; callers pass no local_date. service_role only.';
