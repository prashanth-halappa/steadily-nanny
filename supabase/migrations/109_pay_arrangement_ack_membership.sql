-- 109 pay_arrangement_acks insert policy gets the membership check it never had
--
-- WHAT WAS WRONG
-- 081_pay_arrangement_acks.sql:88-97's insert policy checked only
--   carer_id = auth.uid()
--   and exists (... pa.carer_id = auth.uid() ...)
-- — that the caller IS the carer the arrangement is for, and nothing else.
-- Every other write policy in this schema inherits a `status = 'active'`
-- membership check through `private.is_household_parent` (009) or its
-- semantic wrapper `private.can_write_household` (040). This one named
-- neither. A carer REMOVED from the household (`household_members.status`
-- flipped to 'removed') still satisfies both of 081's conditions — her
-- `carer_id` on `pay_arrangements` does not change when she is removed
-- (033's "outlives the membership" reasoning, restated in 081's own header
-- for this exact column) — so she could still insert an ack or a dissent via
-- PostgREST after leaving, on an arrangement she is no longer a party to in
-- any live sense.
--
-- THE FIX
-- Add the missing predicate: the arrangement's household must still count
-- her as an active member. Reuses `private.can_read_household` (040) rather
-- than inlining a new EXISTS against `household_members` — it is the
-- read-side access decision, and "is currently a member" is exactly what an
-- ack is gated on (a removed carer can still SEE her own historical acks
-- under 081's select policy; she just cannot make new ones). Drop + recreate
-- is the only path for a policy, same as every other RLS fix in this repo.

drop policy if exists "The carer can ack or dissent her own arrangement" on public.pay_arrangement_acks;
create policy "The carer can ack or dissent her own arrangement" on public.pay_arrangement_acks
  for insert with check (
    carer_id = (select auth.uid())
    and exists (
      select 1
      from public.pay_arrangements pa
      where pa.id = pay_arrangement_acks.arrangement_id
        and pa.carer_id = (select auth.uid())
        and private.can_read_household(pa.household_id)
    )
  );
