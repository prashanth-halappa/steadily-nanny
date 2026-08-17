-- 103 Shift read scope — the calendar stops being a household-wide fact (S1)
--
-- All four shift tables have read policies from 015, repointed by 040, that
-- use `private.can_read_household` — which is `is_household_member`: ANY
-- active member, ANY role. So today a SECOND NANNY reads every shift in the
-- household, the children attached to each one, every change request on them,
-- and the whole `shift_events` day thread, which carries free-text `note`,
-- `reason` and `message` fields written by and about somebody else. A HELPER
-- — someone brought in to do the school run — gets exactly the same.
--
-- This is the shape migration `087_payroll_read_scope.sql` removed from
-- `time_entries` and `timesheets`, with the rationale written in: "a HELPER…
-- and a SECOND NANNY can both read another carer's pay." The identical
-- argument applies to the calendar and was never applied. 041's header states
-- the rule: "PostgREST is a real door: a policy looser than the service is
-- not 'belt and braces', it is the hole the service was written to close."
-- Unlike pay — defended at RLS, service and UI — scheduling defends this at
-- NEITHER RLS nor service. 103 closes the first half.
--
-- WHY THE CALENDAR IS NOT A SMALLER PRIZE THAN PAY. A shift row is where a
-- child is, and when, and who is with them. The day thread beside it is the
-- household's argument log. A helper who was given a badge for Tuesday
-- afternoons has no reason to hold either, and a second nanny reading the
-- first nanny's notes is the same trust failure as reading her gross.
--
-- THE SERVICE MOVES IN THE SAME COMMIT. `shiftQueryService.assertMember`
-- granted household scope to any ACTIVE member without looking at the role;
-- it is replaced by `assertShiftReader`, which resolves by ROLE first —
-- owner/parent read household-wide, a nanny reads only her OWN shifts
-- (FORCED, never merely offered), a helper reads none. Repositories run as
-- the service role and bypass RLS entirely, so the service is the check and
-- this policy is the backstop — but a backstop WIDER than the check is the
-- door, which is the whole reason both halves land together (087).
--
-- THE DELIBERATE DIFFERENCE FROM 087. Payroll's carer self-arm is
-- membership-INDEPENDENT: a nanny who has left keeps reading the hours she
-- worked, because payroll is an audit trail. The calendar is a LIVE surface,
-- so the service half requires an ACTIVE membership. The policy's carer arm
-- is still written membership-independently, exactly as in 067/044/087,
-- because that is what makes narrowing the first arm safe at the door — the
-- service is where "live" is enforced.
--
-- SHIFT_EVENTS HAS A THIRD ARM, AND A DELIBERATE HOLE. `actor_id =
-- auth.uid()` lets a carer keep reading the rows she herself wrote
-- (`running_late`, her own accept/decline). Rows with a NULL `shift_id` are
-- DAY-LEVEL — `uncovered_care` (which names a child and an uncovered window)
-- and `timesheet_reopened` (a money fact) — and they are PARENTS ONLY: there
-- is no shift to attach them to a carer by, and both are household facts
-- rather than anything she was party to. `shift_id is not null` in the carer
-- arm is what makes that explicit rather than accidental.
--
-- ACCEPTED CONSEQUENCE, RECORDED. Through PostgREST a nanny no longer sees
-- `parent_cover` rows (they carry a NULL `carer_id`), nor any carer-null
-- "Thu — nobody yet" row, nor another carer's shift she is covering around.
-- Nothing in the app reads shifts through PostgREST — the API is service role
-- and the service now narrows identically, returning the same rows it always
-- did to a parent and a NARROWER set to a nanny by design. `v_busy_blocks`
-- (016) is `security_invoker = on` and reads `public.shifts`, so a nanny
-- querying it directly now sees only her own busy spans; the anonymised
-- cross-household clash path runs server-side as the service role and is
-- unaffected.
--
-- 040 TRAP 2: the helper is called BARE, never `(select
-- private.can_write_household(...))` — it takes a per-row `household_id` and
-- cannot be an initplan. 018's `(select auth.uid())` form is kept on every
-- carer/actor self-arm, where it IS an initplan. Both are reproduced verbatim
-- from 067 and 087.
--
-- WRITE POLICIES ARE UNTOUCHED. "Parents can write shifts" / "Parents can
-- write shift children" already resolve through `can_write_household`, and
-- `shift_events` still has no update or delete policy anywhere: an audit
-- trail that can be edited is not an audit trail (015).
--
-- PRE-FLIGHT: none needed. This migration only replaces SELECT policies; no
-- row is read, written or validated, and every statement is idempotent.

drop policy if exists "Members can view shifts" on public.shifts;
create policy "Parents and the assigned carer can view shifts"
  on public.shifts
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );

drop policy if exists "Members can view shift children" on public.shift_children;
create policy "Parents and the assigned carer can view shift children"
  on public.shift_children
  for select using (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (private.can_write_household(s.household_id)
             or s.carer_id = (select auth.uid()))
    )
  );

drop policy if exists "Members can view change requests" on public.shift_change_requests;
create policy "Parents and the assigned carer can view change requests"
  on public.shift_change_requests
  for select using (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (private.can_write_household(s.household_id)
             or s.carer_id = (select auth.uid()))
    )
  );

drop policy if exists "Members can view day thread" on public.shift_events;
create policy "Parents, the actor and the carer can view the day thread"
  on public.shift_events
  for select using (
    private.can_write_household(household_id)
    or actor_id = (select auth.uid())
    or (
      shift_id is not null and exists (
        select 1
        from public.shifts s
        where s.id = shift_id and s.carer_id = (select auth.uid())
      )
    )
  );
