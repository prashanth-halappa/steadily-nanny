-- ---------------------------------------------------------------------------
-- 097_terms_declined.sql — a counterparty can refuse a round (B4)
--
-- APPLIED TO PROD 2026-08-15 via the Supabase MCP `apply_migration`, before
-- 098 — never `supabase db push` (version-scheme mismatch). Do not re-apply.
--
-- Spec: docs/design/screens-onboarding-terms-proposal.md §9, §10.
-- Wire:  packages/shared-types/src/schemas/termsProposal.schema.ts
--
-- THE GAP THIS CLOSES
--
-- `withdraw` in `termsProposalCommandService` requires
-- `proposal.proposed_by = callerId` — only the AUTHOR can close a round.
-- With the parent-offer flow able to promote an offer into a
-- `direction = 'parent'` proposal, a nanny who does not want the terms had no
-- way to say so: she could only leave the round open forever, sitting as her
-- top attention card. `declined` gives the COUNTERPARTY her own exit.
--
-- WHY NOT REUSE `withdrawn`
--
-- "Withdrawn" (the author retracted her own ask) and "Declined" (the other
-- side refused it) are different facts about who acted, and this codebase's
-- house style is honest state words, not one word standing in for two
-- meanings (§10; see `terms_proposals`' own `direction` column, which exists
-- for exactly this "who did it" precision). Overloading `withdrawn` would
-- make "Withdrawn by Marisol" ambiguous between "she pulled her own proposal"
-- and "she refused yours" — the opposite of what happened, half the time.
--
-- THE CHECK CANNOT BE ALTERED IN PLACE
--
-- `092_terms_proposals.sql` declares
--   status text not null default 'proposed'
--     check (status in ('proposed', 'countered', 'accepted', 'withdrawn'))
-- as an unnamed inline check, which Postgres names
-- `terms_proposals_status_check` (`<table>_<column>_check`, the same
-- convention `069_time_entry_void.sql` relies on for
-- `time_entries_status_check` and `068_time_off_sick_kind.sql` for
-- `carer_time_off_kind_check`). A CHECK cannot be widened in place, so this
-- drops that constraint by its auto-generated name and re-adds it — same
-- shape as 069. Cheap to re-validate: every existing row already satisfies
-- the wider set, since nothing before this migration could ever write
-- 'declined'.
--
-- NO INDEX CHANGE — VERIFIED, NOT ASSUMED
--
-- 092's `terms_proposals_open_unique_idx` is a PARTIAL unique index on
-- `(household_id, carer_id) where status = 'proposed'`. A `declined` row
-- leaves `status = 'proposed'` exactly like `countered`, `accepted` and
-- `withdrawn` already do, so it correctly frees the slot for a new round —
-- the same as every other terminal status. Nothing about the index needs to
-- change; `migration097TermsDeclined.test.ts` pins 092's own index definition
-- to keep that claim honest rather than asserted.
--
-- NO RLS CHANGE. Writes go through the API under the service role
-- (`termsProposalCommandService.decline`), gated exactly like `accept` and
-- `withdraw` — the SELECT policy from 092 already covers reading a declined
-- row (it is still one of "this household's parents, or the carer it is
-- for").
--
-- DEPLOY RISK: none. Widening a CHECK that nothing yet writes against;
-- nothing reads `declined` until the API domain ships it in the same slice.
-- ---------------------------------------------------------------------------

alter table public.terms_proposals
  drop constraint if exists terms_proposals_status_check;

alter table public.terms_proposals
  add constraint terms_proposals_status_check
    check (status in
      ('proposed', 'countered', 'accepted', 'withdrawn', 'declined'));

comment on column public.terms_proposals.status is
  'Lifecycle: proposed -> countered/accepted/withdrawn/declined. withdrawn = the AUTHOR pulled her own round; declined = the COUNTERPARTY refused it. Distinct facts about who acted (D-35, B4) — never overload one for the other.';
