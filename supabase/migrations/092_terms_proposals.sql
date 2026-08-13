-- ---------------------------------------------------------------------------
-- 092_terms_proposals.sql — the terms PROPOSAL object (3-O, D-35 / D-38)
--
-- APPLIED TO PROD 2026-08-12 (Phase 6) via Supabase MCP `apply_migration`,
-- in order with the rest of the 074→096 chain — never `supabase db push`
-- (version-scheme mismatch). Live tip after apply:
-- `redeem_draft_invite_week_starts_on`. Do not re-apply.

-- Spec: docs/design/screens-onboarding-terms-proposal.md §7, §9, §10.
-- Wire:  packages/shared-types/src/schemas/termsProposal.schema.ts
--
-- WHAT A PROPOSAL IS
--
-- A message about money, never a record OF money. Nothing here is priced,
-- nothing feeds the earnings engine, no timesheet can reference one, and no
-- `time_entry` will ever join to it. The BINDING ACT is acceptance, and
-- acceptance inserts a real `pay_arrangements` row through the existing
-- `payArrangementCommandService` under the accepting PARENT's own credentials.
-- `WRITE_ROLES = {owner, parent}` is untouched; the nanny never inserts an
-- arrangement (D-35, spec §17). This table is how she ASKS.
--
-- WHY `terms` IS ONE jsonb AND NOT TWENTY MIRRORED COLUMNS
--
-- The payload is exactly a `CreatePayArrangementRequest`, validated by that
-- Zod schema at the API boundary. Mirroring `pay_arrangements`' twenty-odd
-- columns here would double T17's field-by-field trap — every future pay term
-- would need a second migration and a second insert literal, and the day
-- somebody forgot one the proposal would silently promise something the
-- accepted arrangement did not carry. Reusing the request schema makes "what
-- she proposed is what he accepts" a property of the type system instead of a
-- promise in a doc.
--
-- Consequently there are NO money CHECK constraints on the contents of
-- `terms` here, and that is deliberate rather than an oversight: 063's bounds,
-- 041's non-negative floors and the currency regex all fire where they
-- matter — on the `pay_arrangements` INSERT at acceptance, which is the row
-- anything is ever priced from. A malformed proposal is refused by Zod before
-- it reaches this table; a proposal that somehow got here still cannot become
-- money without passing every one of those constraints.
--
-- APPEND-ONLY IN SPIRIT
--
-- A counter is a NEW ROW naming the one it answered (`supersedes_id`), and the
-- answered row moves to `countered`. Nothing is ever edited over. That is what
-- makes §7.2's "How we got here" a true history rather than a UI convenience,
-- and it is the same promise T16 already makes on the pay screens. The only
-- UPDATEs this table ever takes are the lifecycle stamps on a row that is
-- leaving `proposed` (status, responded_at, accepted_*) and the one-way
-- `viewed_at` receipt — never a change to `terms`.
--
-- COPY-ON-REDEEM (D-38)
--
-- Redeeming a nanny's code NEVER mutates her draft's proposal. The redemption
-- function (094) INSERTS a copy into the target household carrying
-- `from_invite_id`. Her draft row survives untouched as her reusable template,
-- so she can interview with four families in parallel and "the wrong family
-- redeemed it" cannot cost her the draft.
--
-- DEPLOY RISK: none. New table, no backfill, nothing reads it until 3-O's
-- API domain ships.
-- ---------------------------------------------------------------------------

create table if not exists public.terms_proposals (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id)
                    on delete cascade,
  -- Whose terms these are. Per-carer ALWAYS: a household with two nannies has
  -- two independent negotiations and neither may see the other's (D-21).
  --
  -- Not a foreign key to `household_members`, and not `on delete cascade` from
  -- `user_profiles` — the same "outlives the membership" reasoning 033 gives
  -- for `pay_arrangements.carer_id` and 081 restates for
  -- `pay_arrangement_acks.carer_id`. A carer who later deletes her account
  -- must not silently delete the family's record of what was proposed and
  -- agreed; that record belongs to both parties. `carer_display_name` below
  -- keeps the orphaned row legible.
  carer_id        uuid not null,
  -- Who authored THIS row. Equals `carer_id` on a carer-authored proposal and
  -- names the parent on a counter.
  proposed_by     uuid not null,
  -- Which SIDE authored it. Not a role: a proposal concerns exactly one carer
  -- and the only question a reader has is "did she send this, or did they?".
  -- §10 renders it as the actor in every state line ("Countered by the Ahmeds
  -- · 11 Aug") — daylight-v2.md §5.2's never-colour-only rule applied to a
  -- distinction of meaning rather than of urgency.
  direction       text not null check (direction in ('carer', 'parent')),
  -- §10's lifecycle. No 'expired': two people negotiating is not a workflow to
  -- time out, there is no round limit, and a draft household generates no cron
  -- anyway (D-34).
  status          text not null default 'proposed'
                    check (status in
                      ('proposed', 'countered', 'accepted', 'withdrawn')),
  -- A full CreatePayArrangementRequest — see the header for why this is one
  -- opaque bag and not a column per term.
  terms           jsonb not null,
  -- Her note, when she wrote one. Rendered under the terms card (§7.2).
  note            text,
  -- The proposal this one answers, or null on the first round. A counter is
  -- never an edit; this link is what makes the chain a history. `set null` so
  -- a hard delete upstream can never take the chain's tail with it.
  supersedes_id   uuid references public.terms_proposals(id) on delete set null,
  -- The invite this proposal arrived on, when a redemption cloned it in
  -- (D-38). Null on an in-household proposal (§9). It is what lets §5.3's
  -- "Sent to" row on the nanny's draft home say "Viewed": the invite she sent
  -- is how she identifies the family, and `viewed_at` is the fact she wants.
  from_invite_id  uuid references public.household_invites(id)
                    on delete set null,
  -- Snapshot at insert, like 033 did for `pay_arrangements.carer_display_name`.
  carer_display_name text not null,
  -- §5.3 "Viewed" / §11 event 5. WHETHER the other side opened it in the app,
  -- never how many times, from where, or for how long — the question is "did
  -- this reach them", not surveillance of a family's evening. One-way: once
  -- set it is never cleared or re-stamped.
  viewed_at       timestamptz,
  -- When it left 'proposed' — countered, accepted or withdrawn.
  responded_at    timestamptz,
  accepted_by     uuid,
  -- The arrangement acceptance created. The audit join, and the thing §11's
  -- `first_week_approved` traces to decide `origin: nanny_first|parent_first`.
  accepted_arrangement_id uuid references public.pay_arrangements(id)
                    on delete set null,
  -- D-7's liability checkbox, recorded ON the acceptance (§7.3). With
  -- `accepted_by` and `responded_at` this makes D-31's acknowledgment record
  -- literally "Marisol proposed Aug 10 · The Ahmeds agreed Aug 12" — a better
  -- artifact than the one-sided ack D-31 originally described.
  responsibility_confirmed boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- An acceptance without the checkbox is not an acceptance. The wire refuses
  -- it (`z.literal(true)`), the service refuses it, and this refuses it too —
  -- the one field in this table whose absence would make the whole feature a
  -- liability rather than a record.
  constraint terms_proposals_accepted_needs_confirmation
    check (status <> 'accepted' or responsibility_confirmed),
  -- A row that has left 'proposed' knows when. Keeps §10's "the word appears
  -- with a date, every time" renderable without a fallback that invents one.
  constraint terms_proposals_responded_at_present
    check (status = 'proposed' or responded_at is not null)
);

-- AT MOST ONE OPEN PROPOSAL per (household, carer). This is §9.1's "while a
-- proposal is open the button becomes Withdraw" as an invariant rather than a
-- UI state, and it closes the double-submit race that a read-then-write check
-- in the service could not.
--
-- GOLDEN-FIXES #31: this is a PARTIAL index, so PostgREST can never name it as
-- an `onConflict` target and `ignoreDuplicates` buys nothing against it. The
-- service must catch the 23505 and translate it, and it must name this index
-- when it does — a bare error-code check would swallow an unrelated
-- constraint violation as "already there".
create unique index if not exists terms_proposals_open_unique_idx
  on public.terms_proposals (household_id, carer_id)
  where status = 'proposed';

-- Serves §7.2's "How we got here" and §9.1's history list: every round for one
-- carer, newest first.
create index if not exists terms_proposals_household_carer_idx
  on public.terms_proposals (household_id, carer_id, created_at desc);

-- Serves the draft home's "Sent to" rows (§5.2) resolving invite -> proposal.
create index if not exists terms_proposals_from_invite_idx
  on public.terms_proposals (from_invite_id)
  where from_invite_id is not null;

comment on table public.terms_proposals is
  'A proposed set of pay terms awaiting the other side''s answer (D-35). Per-carer; lifecycle proposed -> countered/accepted/withdrawn; a counter is a NEW row naming its predecessor via supersedes_id, never an edit. Acceptance inserts a pay_arrangements row through the existing command service under the parent''s credentials — nothing here is ever priced.';

comment on column public.terms_proposals.terms is
  'A full CreatePayArrangementRequest, validated by that Zod schema at the API boundary. One bag rather than twenty mirrored columns so a new pay term cannot silently go missing between proposal and arrangement (T17).';

comment on column public.terms_proposals.from_invite_id is
  'Set when a redemption CLONED this proposal in from a nanny''s draft (D-38). Her draft row is never mutated; this is the copy that landed in the family''s household.';

-- ---------------------------------------------------------------------------
-- RLS — SELECT-ONLY, MONEY-TABLE READ CIRCLE (041/044/067/086 shape, verbatim)
--
-- Parents/owners plus the carer the proposal is FOR; helpers and other carers
-- denied. NOT `can_read_household`, which would hand a helper — or the OTHER
-- nanny — a colleague's proposed rate. 041's header says it best: a policy
-- looser than the service is not belt-and-braces, it is the hole the service
-- was written to close. `private.can_write_household` is called BARE (040
-- trap 2); the carer self-arm keeps 018's `(select auth.uid())` initplan form.
--
-- THE CARER SELF-ARM IS LOAD-BEARING FOR D-49. `carer_id = auth.uid()` does
-- not consult `household_members` at all, which is exactly why a `candidate`
-- nanny — who matches no `status = 'active'` predicate anywhere in this
-- codebase and therefore reads NOTHING else in the household she just
-- redeemed into — can still read, counter and withdraw her own proposal
-- (spec §8.2.1: "The single exception is the proposal itself"). Rewriting
-- this arm to go through a membership helper would silently close the one
-- door the candidate window depends on.
--
-- No insert/update/delete policy of any kind — writes go through the API
-- under the service role, gated in `termsProposalCommandService`.
-- ---------------------------------------------------------------------------

alter table public.terms_proposals enable row level security;

drop policy if exists "Parents and the carer can view terms proposals"
  on public.terms_proposals;
create policy "Parents and the carer can view terms proposals"
  on public.terms_proposals
  for select using (
    private.can_write_household(household_id)
    or carer_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists set_terms_proposals_updated_at on public.terms_proposals;
create trigger set_terms_proposals_updated_at
  before update on public.terms_proposals
  for each row execute function public.set_updated_at();
