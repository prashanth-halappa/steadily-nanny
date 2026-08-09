-- Migration 071: parent time-edit demotion uses value diff, not presence flags.
--
-- Migration 034 demoted whenever p_set_starts_at / p_set_ends_at were true.
-- The mobile client always sends full instants on save (recomputed from
-- hydrated wall-clock state), so a note-only edit still set both flags and
-- spuriously demoted confirmed → pending. Compare the incoming timestamptz
-- values against the FOR-UPDATE-locked row instead — typed comparison in the
-- same transaction is immune to `.000Z` vs `+00:00` string-format drift and
-- race-free; a service-side diff against the unlocked pre-read would
-- reintroduce the staleness 027/031 eliminated. Note-only and resent-identical
-- times leave status alone; a real time change on confirmed still demotes.

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
    -- Consent: a REAL time change on a confirmed shift demotes to pending so
    -- the carer must reconfirm. Resent-identical instants or note-only edits
    -- leave status alone (migration 071 value diff).
    status = case
      when ((p_set_starts_at and p_starts_at is distinct from v_locked.starts_at)
         or (p_set_ends_at  and p_ends_at   is distinct from v_locked.ends_at))
        and v_locked.status = 'confirmed'
      then 'pending'
      else status
    end,
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
        'origin', v_locked.origin,
        'status', v_locked.status
      ),
      'after', jsonb_build_object(
        'starts_at', v_shift.starts_at,
        'ends_at', v_shift.ends_at,
        'note', v_shift.note,
        'sequence', v_shift.sequence,
        'origin', v_shift.origin,
        'status', v_shift.status
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
  'Atomic parent shift edit + shift_updated event. Real time changes demote confirmed→pending; resent-identical times and note-only do not. Locks FOR UPDATE; sequence/before/after derived under lock. service_role only.';
