-- ---------------------------------------------------------------------------
-- 096_redeem_draft_invite_week_starts_on.sql — the instantiated household's
-- FLSA workweek comes from the REDEEMER, not from the draft's SQL default
-- (D-8, §5)
--
-- REPO FILE ONLY — never applied to any environment. Phase 6 applies the
-- rehearsed migration chain via the Supabase MCP, in order, never
-- `supabase db push`.
--
-- ---------------------------------------------------------------------------
-- THE BUG
-- ---------------------------------------------------------------------------
-- 094's instantiate branch copies `v_draft.week_starts_on` into the new live
-- household. NO SERVER PATH HAS EVER SET THAT COLUMN ON A NANNY-AUTHORED
-- DRAFT: it is optional on `CreateHouseholdInput`, `householdCommandService
-- .create` just spreads `...input`, and the only senders in the app are the
-- two PARENT-facing setup screens, which send `{ week_starts_on: 0 }` for a
-- US device. So a draft takes 075's default of 1 (Monday) and 094 launders
-- that default into a decision — and D-8 locks it the moment a timesheet
-- exists. A US family onboarded through 3-O gets Monday pay weeks forever
-- while the same family through the parent flow gets Sunday. This is an FLSA
-- fixed workweek: it decides which week a nanny's overtime lands in.
--
-- ---------------------------------------------------------------------------
-- WHY THE REDEEMER AND NOT THE DRAFT AUTHOR
-- ---------------------------------------------------------------------------
-- The workweek is the EMPLOYER's designation. On the instantiate path the
-- employer is the redeemer — the household is created here, owned by them,
-- and they are holding a device with a region on it at this exact moment. The
-- nanny's device is not: nothing in the app creates a draft yet (there is no
-- `/onboarding/terms` route), and even when there is, her phone's region
-- answers a question about HER, not about the family she has not met.
--
-- `user_profiles.week_starts_on` is deliberately NOT the source either — see
-- `apps/api/src/schemas/user.schema.ts`, which spells out at length that it is
-- a per-user DISPLAY preference and never a payroll boundary.
--
-- NULL means "leave the draft's value alone", which is what an older client
-- that does not send the field gets. Absorption ignores the parameter
-- entirely: §8's promise to the parent was "nothing changes for anyone already
-- in your family", and a pay week is exactly the kind of thing that promise is
-- about.
--
-- ---------------------------------------------------------------------------
-- WHY A DROP AND NOT A BARE `create or replace`
-- ---------------------------------------------------------------------------
-- D46: `create or replace function` with a DIFFERENT argument list creates an
-- OVERLOAD rather than replacing anything, and PostgREST would then have two
-- candidates for one name. The exact old signature is dropped first, by hand,
-- before the new one is created. 094 is not edited — the chain replays in
-- order and this file is the next link.
-- ---------------------------------------------------------------------------

drop function if exists public.redeem_draft_household_invite(text, uuid, uuid);

create or replace function public.redeem_draft_household_invite(
  p_code text,
  p_redeemer_id uuid,
  -- NULL means "instantiate a new live household from the draft". Non-null is
  -- §8.2's absorption target, chosen by the parent in the confirm dialog (and
  -- explicitly picked when they have two or more, so absorption can never
  -- silently choose a household and be discovered later).
  p_target_household_id uuid,
  -- D-8, INSTANTIATE ONLY. NULL keeps the draft's value. See this file's
  -- header for why the redeemer is the honest source.
  p_week_starts_on smallint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invite            public.household_invites;
  v_draft             public.households;
  v_target            public.households;
  v_author_membership public.household_members;
  v_nanny_id          uuid;
  v_nanny_status      text;
  v_existing          public.household_members;
  v_proposal          public.terms_proposals;
  v_new_proposal      public.terms_proposals;
  v_membership        public.household_members;
  v_instantiated      boolean := false;
begin
  -- THE ANCHOR. A concurrent redeem of the same code waits right here.
  select * into v_invite
  from public.household_invites
  where code = upper(btrim(p_code))
  for update;

  -- Missing, revoked, expired and already-accepted collapse into ONE outcome
  -- the caller renders as the existing opaque `InviteNotFoundError` copy.
  -- Naming the reason would confirm the code was real, which is exactly the
  -- existence-hiding convention `previewInvite`'s header protects (§17).
  if v_invite.id is null
     or v_invite.status <> 'pending'
     or v_invite.expires_at < now() then
    return jsonb_build_object('outcome', 'invite_unavailable');
  end if;

  select * into v_draft
  from public.households
  where id = v_invite.household_id;

  -- Not a nanny-authored draft: the caller falls through to the ordinary
  -- parent-authored redeem path in `householdCommandService`, which keeps its
  -- reactivation, PTO carry-over and push behaviour untouched. This function
  -- deliberately owns ONE path rather than absorbing a shipped one.
  if v_draft.id is null or v_draft.state <> 'draft' then
    return jsonb_build_object('outcome', 'not_a_draft_invite');
  end if;

  -- The draft's author is the carer whose terms travel. Read from the
  -- membership rather than from `created_by` alone so a draft whose creator
  -- somehow has no membership refuses instead of producing a household with
  -- a proposal and nobody to own it.
  select * into v_author_membership
  from public.household_members
  where household_id = v_draft.id
    and user_id = v_draft.created_by
    and role = 'nanny'
    and status = 'active';

  if v_author_membership.id is null then
    return jsonb_build_object('outcome', 'draft_has_no_author');
  end if;
  v_nanny_id := v_author_membership.user_id;

  -- A nanny cannot redeem her own code into her own draft.
  if v_nanny_id = p_redeemer_id then
    return jsonb_build_object('outcome', 'self_redemption');
  end if;

  -- -------------------------------------------------------------------
  -- Resolve the target LIVE household
  -- -------------------------------------------------------------------
  if p_target_household_id is null then
    -- INSTANTIATE (§2.1 row 1). A new live household built from the draft's
    -- settings — the ones she confirmed for herself in the terms step, which
    -- are better defaults for this family than the SQL ones. `name` may be
    -- null on the draft; 093's `households_live_has_name` CHECK would refuse
    -- that on a live row, so it falls back here rather than at the CHECK.
    --
    -- `week_starts_on` is the ONE settings field the redeemer overrides
    -- rather than inherits, and only because the draft has no answer to
    -- inherit: see this file's header.
    insert into public.households (
      name, timezone, currency, jurisdiction, week_starts_on,
      state, created_by
    )
    values (
      coalesce(v_draft.name, 'Our household'),
      v_draft.timezone,
      v_draft.currency,
      v_draft.jurisdiction,
      coalesce(p_week_starts_on, v_draft.week_starts_on),
      'live',
      p_redeemer_id
    )
    returning * into v_target;

    -- The redeemer is the OWNER. This is the only place in 3-O a household
    -- gains one, and it happens in the same transaction as everything else —
    -- 009's own comment ("Insert is deliberately absent: creating a household
    -- also creates the owner's membership row, and the two must happen
    -- together") applied to a path 009 could not foresee.
    insert into public.household_members (
      household_id, user_id, role, can_edit, status
    )
    values (v_target.id, p_redeemer_id, 'owner', true, 'active');

    -- Her entered basics travel (D-34: "children/name copied"). Archived
    -- children do not — a child she removed from the draft should not
    -- reappear in the family's real household.
    insert into public.children (
      household_id, name, birth_date, colour, avatar_initial, routine_notes
    )
    select v_target.id, c.name, c.birth_date, c.colour, c.avatar_initial,
           c.routine_notes
    from public.children c
    where c.household_id = v_draft.id
      and c.archived_at is null;

    v_instantiated := true;
  else
    -- ABSORPTION (§2.1 rows 2 and 3 / §8). Nothing about the existing family
    -- changes: no basics copied, no children touched, no settings overwritten
    -- — `p_week_starts_on` is deliberately unread on this branch. The parent
    -- was told exactly that before he tapped ("Nothing changes for anyone
    -- already in your family"), and this is where that promise is kept.
    select * into v_target
    from public.households
    where id = p_target_household_id
      and state = 'live'
    for update;

    if v_target.id is null then
      return jsonb_build_object('outcome', 'target_not_permitted');
    end if;

    -- Re-checked UNDER the lock: a parent removed from this household between
    -- the service's read and this call must not absorb a nanny into it. The
    -- positive `status = 'active'` filter is the house shape — never
    -- `status <> 'removed'`, which would let a `candidate` absorb somebody.
    if not exists (
      select 1
      from public.household_members m
      where m.household_id = v_target.id
        and m.user_id = p_redeemer_id
        and m.status = 'active'
        and m.role in ('owner', 'parent')
    ) then
      return jsonb_build_object('outcome', 'target_not_permitted');
    end if;
  end if;

  -- -------------------------------------------------------------------
  -- Join her to the target
  --
  -- D-49: `candidate` on ABSORPTION, `active` on INSTANTIATION, and the
  -- asymmetry is the point rather than an inconsistency.
  --
  -- Absorbing into a household that already has a life — a schedule, children
  -- with routine notes, possibly an incumbent nanny — must not let a person
  -- the family has not hired read any of it on the strength of a code. She
  -- matches no `status = 'active'` predicate anywhere, so she reads nothing
  -- but her own proposal (092's carer self-arm) until he agrees.
  --
  -- A household INSTANTIATED from her own draft has no such life to protect:
  -- every fact in it came from her, the parent is joining HER, and there is
  -- no incumbent and no prior schedule. Making her a candidate there would
  -- lock her out of the household she authored while she waits.
  -- -------------------------------------------------------------------
  v_nanny_status := case when v_instantiated then 'active' else 'candidate' end;

  select * into v_existing
  from public.household_members
  where household_id = v_target.id
    and user_id = v_nanny_id;

  if v_existing.id is not null then
    -- ANY status, deliberately (the same reasoning `redeemInvite`'s pre-check
    -- gives): the unique `(user_id, household_id)` index makes a fresh insert
    -- impossible for a row that already exists in any state, and refusing
    -- here — BEFORE the claim below — means a no-op never burns a
    -- single-use code.
    return jsonb_build_object(
      'outcome', 'already_member',
      'household_id', v_target.id,
      'status', v_existing.status
    );
  end if;

  insert into public.household_members (
    household_id, user_id, role, can_edit, status
  )
  values (v_target.id, v_nanny_id, 'nanny', false, v_nanny_status)
  returning * into v_membership;

  -- -------------------------------------------------------------------
  -- Copy the proposal — D-38, the line that makes the draft a template
  --
  -- INSERT ... SELECT, never UPDATE. Her draft row is not read-locked, not
  -- restatused, and not archived; it is simply the source of a copy. If the
  -- Bakers redeem her next code tomorrow, this happens again into a different
  -- household, and nothing about today's redemption is visible from there.
  -- -------------------------------------------------------------------
  select * into v_proposal
  from public.terms_proposals
  where household_id = v_draft.id
    and carer_id = v_nanny_id
    and status = 'proposed'
  order by created_at desc
  limit 1;

  if v_proposal.id is not null then
    begin
      insert into public.terms_proposals (
        household_id, carer_id, proposed_by, direction, status,
        terms, note, from_invite_id, carer_display_name
      )
      values (
        v_target.id, v_nanny_id, v_nanny_id, 'carer', 'proposed',
        v_proposal.terms, v_proposal.note, v_invite.id,
        v_proposal.carer_display_name
      )
      returning * into v_new_proposal;
    exception when unique_violation then
      -- 092's `terms_proposals_open_unique_idx` is PARTIAL, so PostgREST
      -- could never have named it as a conflict target and no
      -- `ignoreDuplicates` would have covered it (GOLDEN-FIXES #31). Reaching
      -- here means she already has an open proposal in this household — two
      -- of her codes redeemed by the same family, racing. The membership
      -- insert above rolls back with this, so nothing half-lands.
      return jsonb_build_object(
        'outcome', 'proposal_already_open',
        'household_id', v_target.id
      );
    end;
  end if;

  -- -------------------------------------------------------------------
  -- THE CLAIM — the same CAS `claimPending` runs, now inside the
  -- transaction that did the work. `status = 'pending'` is re-asserted even
  -- though the row is locked: the lock serialises writers, the predicate is
  -- what makes the write single-use.
  -- -------------------------------------------------------------------
  update public.household_invites
  set status = 'accepted',
      accepted_by = p_redeemer_id,
      accepted_at = now()
  where id = v_invite.id
    and status = 'pending';

  if not found then
    -- Unreachable while the row is locked and was re-read above; kept because
    -- an outcome is cheaper than the incident where it was not.
    return jsonb_build_object('outcome', 'invite_unavailable');
  end if;

  return jsonb_build_object(
    'outcome', 'redeemed',
    'instantiated', v_instantiated,
    'household_id', v_target.id,
    'draft_household_id', v_draft.id,
    'carer_id', v_nanny_id,
    'membership', to_jsonb(v_membership),
    'proposal', case
      when v_new_proposal.id is null then null
      else to_jsonb(v_new_proposal)
    end
  );
end;
$$;

-- GOLDEN-FIXES #16: `anon` and `authenticated` INHERIT from PUBLIC at creation
-- time, so revoking from the two named roles without revoking from PUBLIC
-- itself leaves the hole wide open. All three, explicitly, then one grant.
revoke all on function public.redeem_draft_household_invite(text, uuid, uuid, smallint)
  from public;
revoke all on function public.redeem_draft_household_invite(text, uuid, uuid, smallint)
  from anon;
revoke all on function public.redeem_draft_household_invite(text, uuid, uuid, smallint)
  from authenticated;
grant execute on function public.redeem_draft_household_invite(text, uuid, uuid, smallint)
  to service_role;

comment on function public.redeem_draft_household_invite is
  'Lock the invite FOR UPDATE, resolve a target LIVE household (instantiate one from the draft, or absorb into the redeemer''s existing one per D-34), join the nanny (active when instantiated, candidate when absorbed per D-49), COPY her proposal in (D-38 — her draft is never mutated), then claim the code with the same CAS claimPending uses. p_week_starts_on is the redeemer''s FLSA workweek (D-8) and is read ONLY when instantiating; null keeps the draft''s value. Returns an outcome; raises nothing. service_role only.';
