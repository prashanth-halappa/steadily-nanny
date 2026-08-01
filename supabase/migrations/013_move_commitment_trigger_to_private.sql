-- 013 Move the child-commitment trigger function out of `public` (fix for 010)
--
-- WHAT WENT WRONG
-- 010 created sync_child_commitment_household() in the `public` schema.
-- PostgREST exposes every function in `public` as an RPC endpoint, so it became
-- callable at /rest/v1/rpc/sync_child_commitment_household by anon and
-- authenticated — as a SECURITY DEFINER function. Caught by the Supabase
-- database linter, advisors 0028 and 0029.
--
-- It is a trigger function. It has no business on the public API, and calling
-- it directly is never meaningful. Moving it to `private` removes the endpoint
-- entirely rather than trying to lock it down in place.
--
-- The move is also folded into 010 so a fresh `supabase db push` never creates
-- the public function at all. This file is retained so the applied migration
-- history matches the files, and is safe to re-run.

drop trigger if exists sync_child_commitments_household on public.child_commitments;
drop function if exists public.sync_child_commitment_household();

create or replace function private.sync_child_commitment_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.household_id into new.household_id
  from public.children c
  where c.id = new.child_id;

  if new.household_id is null then
    raise exception 'child % does not exist', new.child_id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_child_commitment_household() from public;

create trigger sync_child_commitments_household
  before insert or update of child_id, household_id on public.child_commitments
  for each row execute function private.sync_child_commitment_household();
