-- 012 Grant EXECUTE on the RLS helpers (correctness fix for 009 / 011)
--
-- WHAT WENT WRONG
-- 009 and 011 originally revoked EXECUTE on the `private.*` authorisation
-- helpers from anon and authenticated, on the reasoning that they are internal.
-- That broke every policy that calls them. Ordinary reads failed with:
--
--   ERROR: 42501: permission denied for function is_household_member
--
-- WHY
-- A policy expression is evaluated with the CALLER's privileges. SECURITY
-- DEFINER changes who a function runs AS once entered; it does not grant the
-- right to enter it. So the caller still needs USAGE on the schema and EXECUTE
-- on the function, even though the body then runs as the definer.
--
-- WHY GRANTING IS SAFE
-- is_household_member / is_household_parent / household_ids_for_current_user
-- answer only about `auth.uid()` — there is no argument that makes one report
-- on somebody else's membership. shares_household_with does take another user
-- id, but only reveals whether that uuid shares a household with the caller,
-- which the household_members select policy already exposes and which requires
-- knowing the uuid up front.
--
-- anon is included deliberately: an unauthenticated read then resolves to
-- `auth.uid() is null` -> false -> zero rows, instead of raising a 500.
--
-- The fix is also folded into 009 and 011 so a fresh `supabase db push` is
-- correct from the first apply. This file is retained so the applied migration
-- history matches the files. Every statement is idempotent, so running both is
-- harmless.

grant usage on schema private to anon, authenticated, service_role;

-- Revoking from PUBLIC is what actually removes the implicit grant: anon and
-- authenticated inherit from PUBLIC, so naming only those two leaves it in
-- place (GOLDEN-FIXES.md #16).
revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.is_household_parent(uuid) from public;
revoke all on function private.household_ids_for_current_user() from public;
revoke all on function private.shares_household_with(uuid) from public;

grant execute on function private.is_household_member(uuid)
  to anon, authenticated, service_role;
grant execute on function private.is_household_parent(uuid)
  to anon, authenticated, service_role;
grant execute on function private.household_ids_for_current_user()
  to anon, authenticated, service_role;
grant execute on function private.shares_household_with(uuid)
  to anon, authenticated, service_role;
