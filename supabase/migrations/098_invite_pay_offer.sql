-- ---------------------------------------------------------------------------
-- 098_invite_pay_offer.sql — the parent's pay OFFER, riding the invite (P8)
--
-- APPLIED TO PROD 2026-08-15 via the Supabase MCP `apply_migration`, after
-- 097. Do not re-apply. Original instruction, kept for the next migration:
-- apply via the Supabase MCP `apply_migration` in
-- order after 096 — never `supabase db push` (version-scheme mismatch; see
-- 092's header and the note in docs/ROLLBACK-RUNBOOK.md).
--
-- Wire: packages/shared-types/src/schemas/household.schema.ts
--       (`HouseholdInviteSchema.pay_offer`, `CreateHouseholdInviteSchema`)
-- Promotion: apps/api/src/domains/household/services/householdCommandService.ts
--
-- =========================================================================
-- THE GAP (P8)
-- =========================================================================
--
-- A parent cannot record pay terms before a nanny exists. `pay_arrangements`
-- and `terms_proposals` are BOTH `(household_id, carer_id)`-scoped, and during
-- parent onboarding there is no carer to scope to. A null-carer
-- `pay_arrangements` row is forbidden and stays forbidden: it would be money
-- owed to nobody, and every read path that resolves an effective arrangement
-- (greatest `valid_from <= date`, 076) would have to learn to skip it. So the
-- terms need somewhere to live that is NOT the money table.
--
-- =========================================================================
-- THE SHAPE: A SOFT BIND, MIRRORING THE NANNY DIRECTION
-- =========================================================================
--
-- The parent's terms ride the INVITE, as a non-binding OFFER. When a nanny
-- redeems that invite, `redeemInvite` promotes the offer into a real
-- `terms_proposals` row with `direction = 'parent'`, which she then reviews
-- and accepts through the flow 3-O already shipped — the same two taps she
-- would have taken had he proposed after she joined.
--
-- This is the exact mirror of the nanny direction, which already works this
-- way: 096's `redeem_draft_household_invite` INSERTs a copy of her draft
-- proposal into the family's household on redemption (D-38). One mechanism,
-- two directions, and neither side's terms exist as money until the OTHER
-- side accepts them.
--
-- THE OFFER NEVER BINDS BY ITSELF. Nothing is priced from it, no timesheet
-- can reach it, and it dies with the invite: revoke the code or let it expire
-- and the terms go with it, because they are a column ON the code rather than
-- a row that outlives it. That is the whole reason this is a column here and
-- not a nullable-carer row over there.
--
-- =========================================================================
-- NO RLS CHANGE — DELIBERATE, AND THE POINT
-- =========================================================================
--
-- 093 replaced 009's invite SELECT policy with "Parents and draft authors can
-- view invites" (093 §5). The invitee is neither until she redeems, so the
-- offer is structurally invisible to her before redemption: she meets these
-- terms as a PROPOSAL, on `terms_proposals`' own money-table read circle, or
-- she does not meet them at all. Widening that policy so an invitee could
-- "preview" her offer would put a rate on a row anybody holding a code can
-- address — the same exposure D-51 spent three conditions containing on the
-- public terms page. Not done, on purpose.
--
-- =========================================================================
-- NO CHECK CONSTRAINTS ON THE BODY
-- =========================================================================
--
-- Same deliberate choice 092 made for `terms_proposals.terms` (092 lines
-- 33-39): the payload is exactly a `CreatePayArrangementRequest`, validated by
-- that Zod schema at the API boundary, and 063's bounds, 041's non-negative
-- floors and the currency regex all fire where they matter — on the
-- `pay_arrangements` INSERT at acceptance, which is the row anything is ever
-- priced from. A constraint added here would be a second copy of those
-- bounds, free to drift, guarding a value that cannot become money without
-- passing the real ones anyway.
--
-- DEPLOY RISK: none. One nullable column, no default, no backfill, no policy
-- change. Nothing reads it until the promotion in `redeemInvite` ships, and
-- an offer written by a client running ahead of that deploy simply sits on
-- the invite until the code is redeemed.
-- ---------------------------------------------------------------------------

alter table public.household_invites
  add column if not exists pay_offer jsonb;

comment on column public.household_invites.pay_offer is
  'A non-binding CreatePayArrangementRequest bag recorded by the inviting parent before any nanny exists (P8). Promoted to a direction=''parent'' terms_proposals row when a nanny redeems this invite; never binds by itself — nothing is ever priced from it — and it dies with the invite on revoke or expiry.';

-- 092 wrote this slot as "cloned in from a nanny's draft", which was the only
-- provenance it had. It is now BIDIRECTIONAL: the same column records either
-- origin, because both directions of the negotiation can start on an invite.
comment on column public.terms_proposals.from_invite_id is
  'The invite this proposal arrived on, EITHER direction. Set when a redemption CLONED it in from a nanny''s draft (D-38, 094/096) — her draft row is never mutated, this is the copy that landed in the family''s household — OR when a redemption PROMOTED the inviting parent''s pay_offer into a proposal for the redeeming nanny (P8, 098). Null on an in-household proposal (§9).';
