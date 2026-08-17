-- ---------------------------------------------------------------------------
-- 099_contact_fields.sql — a phone number, at last (P4 / direction §6)
--
-- Applied to prod 2026-08-16. Apply via the Supabase MCP `apply_migration` in
-- order after 098 — never `supabase db push` (version-scheme mismatch; see
-- 092's header and the note in docs/ROLLBACK-RUNBOOK.md).
--
-- Wire: packages/shared-types/src/schemas/household.schema.ts
--         (`HouseholdSchema.emergency_contact_*`, `UpdateHouseholdSchema`,
--          `HouseholdMemberSchema.profile_phone`)
--       packages/shared-types/src/schemas/contact.schema.ts (`PhoneNumberSchema`)
--       apps/api/src/schemas/user.schema.ts (`UpsertProfileSchema.phone`,
--         `UpdateProfileSchema.phone`)
-- Read:  apps/api/src/domains/household/services/householdQueryService.ts
--          (`listMembers` — the ONLY route a co-member's number takes out)
-- Write: apps/api/src/domains/household/services/householdCommandService.ts
--          (`update` — the existing owner/parent gate, no new endpoint)
--
-- =========================================================================
-- THE GAP
-- =========================================================================
--
-- There is no phone number anywhere in this product. `user_profiles` holds a
-- name, a city, a country, a locale and a timezone — and city/country are
-- bootstrapped to the literal string '—'. A nanny holding a child with a
-- split lip has no number to call inside the app that is otherwise the
-- entire record of her working life. She has the family's address (009's
-- `address_line`, which renders on no nanny-facing surface today) and
-- nothing else.
--
-- Two columns' worth of gap, and they are different gaps:
--
--   1. THE PARENT'S OWN NUMBER — how she reaches him during the day. Asked
--      for on the existing HOUSEHOLD onboarding step ("and your number" is
--      the same thought as "family name + your name", so it costs no step).
--      It belongs on `user_profiles` and not on `households`, because it is
--      a fact about a PERSON: a co-parent has their own, and a nanny's own
--      number is equally load-bearing in the other direction (the 07:40 "the
--      bus isn't moving" call — direction doc A8).
--
--   2. THE NEXT PERSON DOWN THE LIST — asked for the day a real carer joins,
--      when the question finally has a scenario behind it. It belongs on
--      `households`, because it is a fact about the FAMILY, and it survives
--      one parent leaving.
--
-- =========================================================================
-- `user_profiles.phone` — AND WHY RLS DOES NOT MOVE
-- =========================================================================
--
-- `user_profiles` RLS is owner-only (002): `auth.uid() = user_id` on select,
-- insert, update and delete. That does NOT change here, and the temptation
-- to widen it to "any co-member may read my row" is the trap this comment
-- exists to head off. That policy would hand every co-member the whole row —
-- city, country, locale, `additional_data` — to deliver one field, and it
-- would do so for every household either party is ever in.
--
-- Instead the number is exposed through the household MEMBERS read, which
-- already joins `user_profiles` to produce `profile_name`
-- (`householdMemberRepository.listNonRemovedByHousehold`). That read runs
-- under the service role, is reachable only through
-- `householdQueryService.listMembers`, and `listMembers` already requires an
-- ACTIVE membership of the household to get past `getMembership`. On top of
-- that the service nulls `profile_phone` on any row whose own status is not
-- `active` — a `candidate` has redeemed a code but her terms are not
-- accepted, and neither side has agreed to be reachable by the other yet.
--
-- So the exposure rule is: an ACTIVE member of a household sees the numbers
-- of the other ACTIVE members of THAT household, and nobody else's, ever.
-- That rule lives in one function in one service, not spread across a
-- policy predicate.
-- =========================================================================

alter table public.user_profiles
  add column if not exists phone text;

comment on column public.user_profiles.phone is
  'This person''s own mobile number, as they typed it — free text, never '
  'normalised to E.164 (a parent types "07700 900123" and must not be told '
  'they are wrong). Validated loosely at the wire edge by `PhoneNumberSchema` '
  '(packages/shared-types/src/schemas/contact.schema.ts): <= 32 chars, digits '
  'and phone punctuation only, at least 5 digits. Null until asked for. '
  'THIS COLUMN IS NOT READABLE BY CO-MEMBERS THROUGH RLS — 002''s owner-only '
  'policies still stand. It reaches a co-member only as the joined '
  '`profile_phone` field on GET /v1/households/:id/members, and only when '
  'BOTH the caller and the subject are ACTIVE members of that household '
  '(householdQueryService.listMembers).';

-- =========================================================================
-- households.emergency_contact_* — A THIRD PARTY, NOT A SECOND NUMBER
-- =========================================================================
--
-- The naming invites exactly the wrong reading, so it is spelled out in the
-- column comments below and again here: this is NOT the parent's own
-- alternate number. A second number for the same parent solves nothing when
-- that parent is the one not answering. It is the NEXT PERSON DOWN — a
-- partner, a grandparent, a neighbour, anyone who could actually get there.
--
-- The product never says the word "emergency" to the person filling it in
-- (that phrasing is what produces the useless answer, "my other mobile").
-- The word appears exactly once, on HER side, as the section heading
-- "If something happens" on the family screen. The column keeps the blunt
-- name because a schema reader needs to know what it is for in one word.
--
-- NO RLS CHANGE — VERIFIED AGAINST THE LIVE CATALOG, NOT ASSUMED FROM 009
--
-- `pg_policies where tablename = 'households'` returns exactly ONE row, and
-- 009's text is NOT it — two later migrations moved it:
--
--   policyname | "Members can view their households"
--   cmd        | SELECT
--   qual       | private.can_read_household(id)
--
-- 009 wrote that predicate as `private.is_household_member(id)`; 040
-- (semantic RLS predicates) repointed every such policy at the
-- `can_read_household` wrapper as a pure refactor. The wrapper's body today
-- is `select private.is_household_member(hid)`, and that function is
--
--   select exists (select 1 from public.household_members m
--                  where m.household_id = hid
--                    and m.user_id = (select auth.uid())
--                    and m.status = 'active')
--
-- — a POSITIVE `status = 'active'` filter, so an ACTIVE member reads these
-- three columns (the nanny included: she is the entire point of them) and a
-- `candidate` or `removed` member reads nothing of the household at all.
--
-- There is NO update policy on `households`. 009's "Parents can update their
-- household" was DROPPED by 049_lock_client_writes.sql — "renaming a
-- household is an API write like any other; there is no reason for a second
-- path to it that skips the service layer". So the write path for these
-- three columns is the service role and nothing else, gated by
-- `householdCommandService.update`, which already refuses every non-`name`
-- field to a non-{owner,parent} membership. That is why a nanny PATCHing the
-- emergency contact is refused without a line of new gate code, and why this
-- migration adds no policy: the select policy is a ROW predicate with no
-- column list, so it covers new columns the moment they exist, and there is
-- no write policy to widen.
-- =========================================================================

alter table public.households
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text;

comment on column public.households.emergency_contact_name is
  'FOR THE CARER, filled in by a parent. The name of a THIRD PARTY to call '
  'when the parents cannot be reached — NOT a parent''s own alternate '
  'contact. A partner, a grandparent, a neighbour: the next person down the '
  'list when the parent is the one not answering. Null until asked for, '
  'which happens the day a carer first goes active, never during onboarding '
  '(asked before a carer exists it collects junk).';

comment on column public.households.emergency_contact_phone is
  'The number for `emergency_contact_name`. Same free-text, never-normalised '
  'treatment as `user_profiles.phone`, validated by the same '
  '`PhoneNumberSchema`. Readable by every member of the household under '
  '009''s "Members can view their households" select policy — that is the '
  'point of the field, it is the one number a nanny must be able to reach '
  'without a parent''s help.';

comment on column public.households.emergency_contact_relationship is
  'How `emergency_contact_name` relates to the family, in the parent''s own '
  'words ("Mum''s sister", "Neighbour at no. 12"). Free text, <= 80 chars, '
  'never an enum: it renders verbatim under the name on the carer''s family '
  'screen, and a dropdown would replace the one detail that tells her '
  'whether this is someone with a key.';

-- No index: all four columns are read only as part of a row already being
-- fetched by primary key or by an existing membership join, and none of them
-- is ever a search or filter predicate.
