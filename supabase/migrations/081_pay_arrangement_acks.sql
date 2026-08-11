-- 081 The nanny's acknowledgment of her pay terms, and her dissent (D-31, D-45)
--
-- REPO FILE ONLY — never applied to any environment as part of Phase 3 slice
-- 3-U1 (TRUST-AND-TERMS-PLAYBOOK.md §3). Phase 6 applies the rehearsed
-- migration chain via the Supabase MCP, in order, never `supabase db push`.
--
-- WHAT THIS IS (`docs/design/screens-pay-terms.md` §8.1/§8.3.1)
-- An ack is a DIFFERENT fact about an immutable `pay_arrangements` row,
-- written later by a different person (the carer), never a column on that
-- table — which has no update path and must not grow one (041's header).
-- One row per (arrangement, carer, kind): she can both have SEEN a version
-- and DISAGREED with it — two different facts, neither retracting the other.
--
-- 'seen' is D-31's acknowledgment ("I've seen these terms" — never "Agreed",
-- D-41: a receipt must not read as consent). 'disagreed' is D-45's dissent
-- ("I don't agree with this") — it blocks nothing, the terms stay in effect
-- and the week keeps pricing; it is a record, not a veto (spec §8.3.1).
--
-- APPEND-ONLY, SAME AS EVERY OTHER TABLE IN THIS DOMAIN
-- No update, no delete policy. "There is no un-acknowledge" (spec §8.1) and
-- there is no un-disagree either — a change of mind is a NEW ack row for the
-- NEXT arrangement version, never a mutation of this one.
--
-- WHY A ROW AND NOT A BOOLEAN ON pay_arrangements
-- The whole value of an ack is that it is timestamped evidence written by the
-- person it binds, independently of the row it is about. Folding it into
-- `pay_arrangements` would mean either a parent's insert can set it (which
-- defeats the point) or a second write path onto an append-only table
-- (which 041 forbids outright).

create table if not exists public.pay_arrangement_acks (
  id              uuid primary key default gen_random_uuid(),
  arrangement_id  uuid not null references public.pay_arrangements(id) on delete cascade,
  -- Not a foreign key to household_members: the same "outlives the
  -- membership" reasoning as `pay_arrangements.carer_id` (033) — a carer who
  -- later deletes her account must not silently delete her own ack history.
  carer_id        uuid not null,
  kind            text not null check (kind in ('seen', 'disagreed')),
  -- §8.3.1: "an optional Textarea, 280 chars" — the dissent's reason. Null on
  -- a 'seen' row always; optional on a 'disagreed' row.
  note            text,
  created_at      timestamptz not null default now(),
  -- The load-bearing constraint: one ack and one dissent per (arrangement,
  -- carer), never two of the same kind. A carer re-opening My pay and
  -- tapping "I've seen these terms" a second time on the SAME version is a
  -- no-op the service layer treats as idempotent, not a second row.
  unique (arrangement_id, carer_id, kind)
);

alter table public.pay_arrangement_acks
  drop constraint if exists pay_arrangement_acks_note_length;
alter table public.pay_arrangement_acks
  add constraint pay_arrangement_acks_note_length check (char_length(note) <= 280);

comment on table public.pay_arrangement_acks is
  'The carer''s acknowledgment ("seen") and dissent ("disagreed") on one arrangement version (D-31, D-45). Append-only; no update, no delete. One row per (arrangement, carer, kind).';

-- --------------------------------------------------------------------------
-- RLS — same shape as 041's single SELECT policy: no PostgREST access
-- without a policy naming it, so a caller who cannot enter a private helper
-- gets a 500, not an empty result (GOLDEN-FIXES.md #16).
-- --------------------------------------------------------------------------

alter table public.pay_arrangement_acks enable row level security;

-- Read: any household member who could already read the underlying
-- arrangement (041's own predicate, joined through) — the parent sees her
-- ack/dissent, she sees her own.
drop policy if exists "Parents and the carer can view pay arrangement acks" on public.pay_arrangement_acks;
create policy "Parents and the carer can view pay arrangement acks" on public.pay_arrangement_acks
  for select using (
    exists (
      select 1
      from public.pay_arrangements pa
      where pa.id = pay_arrangement_acks.arrangement_id
        and (
          private.can_write_household(pa.household_id)
          or pa.carer_id = (select auth.uid())
        )
    )
  );

-- Write: ONLY the carer the arrangement is for, and only for herself — a
-- parent cannot record that the nanny "saw" terms on her behalf (spec §8.1:
-- "Only the carer the arrangement is for may write one").
drop policy if exists "The carer can ack or dissent her own arrangement" on public.pay_arrangement_acks;
create policy "The carer can ack or dissent her own arrangement" on public.pay_arrangement_acks
  for insert with check (
    carer_id = (select auth.uid())
    and exists (
      select 1
      from public.pay_arrangements pa
      where pa.id = pay_arrangement_acks.arrangement_id
        and pa.carer_id = (select auth.uid())
    )
  );

-- No update, no delete policy — append-only, matching every other table in
-- this domain (041's header, restated here rather than merely implied).
