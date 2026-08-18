-- ---------------------------------------------------------------------------
-- 106_invite_pay_offer_promotion.sql — recording what happened to a pay OFFER
-- (F3, closing part of the P8/098 audit)
--
-- Apply via the Supabase MCP `apply_migration`, in order after 105 — never
-- `supabase db push` (version-scheme mismatch; see 092's header and the note
-- in docs/ROLLBACK-RUNBOOK.md).
--
-- Wire: packages/shared-types/src/schemas/household.schema.ts
--       (`HouseholdInviteSchema.pay_offer_promotion`, `PAY_OFFER_PROMOTION_OUTCOMES`)
-- Writer: apps/api/src/domains/household/services/householdCommandService.ts
--         (`promoteOfferToProposal`)
--
-- =========================================================================
-- THE GAP
-- =========================================================================
--
-- 098's `pay_offer` is promoted into a `terms_proposals` row on redemption by
-- `promoteOfferToProposal`, which by design NEVER THROWS — a promotion
-- failure must cost the nanny a proposal, never the household she legitimately
-- joined. Every one of its exit paths (no inviter left to name, the offer's
-- `valid_from` drifted past the horizon, an open round already exists, or a
-- generic insert failure) was previously only a log line: nobody — not the
-- inviting parent, not support — had any record of what happened to the offer
-- he wrote. This column is that record.
--
-- One nullable text column, no backfill: every invite minted before this
-- migration reads `null`, which already means "no offer was attached" for a
-- co-parent or helper invite and now ALSO covers "an offer was attached but
-- this row predates 106" — both read identically as "nothing to show", which
-- is the honest answer for a row this migration never touched.
--
-- DEPLOY RISK: none. One nullable column, no default, no backfill, no policy
-- change — same shape as 098.
-- ---------------------------------------------------------------------------

alter table public.household_invites
  add column if not exists pay_offer_promotion text
    check (pay_offer_promotion in (
      'promoted',
      'skipped_open_round',
      'skipped_stale',
      'skipped_no_inviter',
      'failed'
    ));

comment on column public.household_invites.pay_offer_promotion is
  'The outcome of promoteOfferToProposal''s best-effort pay_offer -> terms_proposals promotion on redemption (F3). null means either no pay_offer was attached, or this row predates 106 — both read as nothing to show. promoteOfferToProposal never throws, so this column is the only record of what happened.';
