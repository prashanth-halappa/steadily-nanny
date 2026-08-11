-- ---------------------------------------------------------------------------
-- 093_draft_households.sql — draft households, the `candidate` membership,
-- and the terms-link window (3-O, D-34 / D-36 / D-49 / D-51)
--
-- REPO FILE ONLY — never applied to any environment as part of Phase 3 slice
-- 3-O (TRUST-AND-TERMS-PLAYBOOK.md §3). Phase 6 applies the rehearsed
-- migration chain via the Supabase MCP, in order, never `supabase db push`.
--
-- Spec: docs/design/screens-onboarding-terms-proposal.md §2.1, §2.2, §5,
--       §6.1, §8.2.1, §12.
--
-- Four changes, one theme: a household can now exist BEFORE it has a family.
--
--   1. `households.state` ∈ {draft, live}, plus a nullable `name`.
--   2. `household_members.status` gains `candidate`.
--   3. `household_invites` gains the terms-link window and its receipts.
--   4. A trigger that makes "a draft produces no cron work" an INVARIANT
--      rather than an argument (see THE CRON AUDIT below).
--
-- =========================================================================
-- 1. DRAFT HOUSEHOLDS (D-34 / D-36)
-- =========================================================================
--
-- A `draft` is a household a NANNY created to author her own terms before she
-- has met a family. It has NO OWNER and NO PARENT MEMBER — her membership is
-- `role='nanny'`.
--
-- That single fact does most of D-36's work for free, and it is worth stating
-- because it is what makes the feature safe rather than merely hidden:
-- `pay_arrangements` inserts are gated on `WRITE_ROLES = {owner, parent}`
-- (`householdCommandService.ts:67`), so in a draft there is literally NOBODY
-- who can insert one. "Nothing priceable" is enforced by the membership
-- table, not by hiding buttons.
--
-- WHY `name` BECOMES NULLABLE. §4.2: she is not asked for a family name, a
-- family, or children. She has not met them yet, and a wizard that demands a
-- family name before she has one is the reason interview-stage tools get
-- abandoned. A draft is created `name = null`, rendered "Untitled draft", and
-- the label is asked for at the SHARE moment (§6.1) where it is finally
-- useful and finally known. The CHECK below keeps every LIVE household named.
--
-- =========================================================================
-- THE CRON AUDIT — all ten scheduled jobs, and why one trigger covers them
-- =========================================================================
--
-- 3-O's brief says draft households must be excluded from every cron sweep,
-- digest and horizon job, and asks for a batched filter rather than per-job
-- hacks. The audit found that a WHERE clause is the wrong shape for eight of
-- the ten, because they never look at `households` at all:
--
--   | Job                       | Enumerates from    | Sees `households`?   |
--   |---------------------------|--------------------|----------------------|
--   | scheduleHorizonJob        | schedule_patterns  | yes, via findByIds   |
--   |                           | + child_commitments|                      |
--   | uncoveredDigestJob        | child_commitments  | yes, via findByIds   |
--   | noShowJob                 | shifts             | timezone lookup only |
--   | noShowDigestJob           | shifts             | timezone lookup only |
--   | reminderJob               | shifts + timesheets| no                   |
--   | coverAskExpiryJob         | shifts             | no                   |
--   | shiftCompletionJob        | shifts (bulk UPDATE)| no                  |
--   | cancellationPayReconcile  | shifts             | no                   |
--   | integrityCheckJob         | timesheets/entries/| no                   |
--   |                           | pto/expenses/shifts|                      |
--   | exampleMaintenanceJob     | nothing            | no (cron commented)  |
--
-- The three "timezone lookup only" entries are the trap: they read
-- `households` through `.in('id', ids)` purely to build a zone Map, falling
-- back to 'UTC' on a miss. Adding a state filter THERE would not exclude a
-- draft's rows — it would just mislabel their timezone.
--
-- So the exclusion is enforced one level down, at the rows those eight jobs
-- actually enumerate. A draft cannot HAVE a shift, a commitment, a timesheet,
-- a time entry or an arrangement, which makes all eight structurally empty
-- rather than filtered. The trigger below is what turns that from a
-- consequence of the membership gates into something the database refuses,
-- so a future write path cannot quietly reintroduce cron exposure.
--
-- THE FIVE GUARDED TABLES, named here so the list is findable from the top:
--   public.shifts
--   public.child_commitments
--   public.timesheets
--   public.time_entries
--   public.pay_arrangements
-- Adding a sixth cron-visible table means adding a trigger in the same
-- change. `apps/api/tests/unit/migration093DraftHouseholds.test.ts` asserts
-- all five, so forgetting one is a red test rather than a silent digest fired
-- at a nanny who has no family yet.
--
-- The two jobs that DO enumerate households both route through
-- `childCommitmentRepository.listHouseholdIdsWithCommitments()`, whose caller
-- set is jobs-only — that is where the TypeScript-side filter belongs, and
-- `householdRepository.findByIds` is deliberately left alone because
-- `householdQueryService` uses it on the normal product path.
--
-- =========================================================================
-- 2. THE `candidate` MEMBERSHIP (D-49, §8.2.1)
-- =========================================================================
--
-- Redemption is not hiring. Between a parent tapping "Add Marisol" and
-- agreeing her terms, she must read NOTHING of that household — not the
-- children's names and ages, not the schedule, not the handoff notes, not the
-- other nanny's shifts.
--
-- The rule is FAIL-CLOSED, not enumerated, and that is the only kind worth
-- trusting on a privacy boundary. Every authorisation predicate in this
-- codebase filters `status = 'active'` POSITIVELY — `private.is_household_member`
-- (009:163), `private.is_household_parent` (009:185),
-- `private.household_ids_for_current_user` (009:203), the partial index at
-- 009:104-106, both availability policies (011:119,121), and their service
-- twin `findActiveMembership`. A `candidate` row matches none of them, so she
-- reads nothing BY DEFAULT rather than by anybody remembering to exclude her.
-- 040's `can_read_household`/`can_write_household` are pass-throughs to the
-- first two, so they inherit the same exclusion.
--
-- Audited at the time of writing: there is not one `status != 'removed'`,
-- `status <> 'removed'` or `neq('status','removed')` anywhere in
-- supabase/migrations, apps/api, apps/mobile or packages. A negated filter is
-- the ONE shape that would silently grant a candidate full household read
-- access with nothing failing. Do not introduce one.
--
-- The single deliberate exception is her own proposal, and it is expressed in
-- 092's RLS as `carer_id = (select auth.uid())` — a predicate that never
-- consults `household_members`, so it keeps working while every other door
-- stays shut. Acceptance flips `candidate -> active` in the same transaction
-- that inserts the arrangement: one state change, one moment, and it is the
-- moment a human agreed.
--
-- DEPLOY RISK: low. `state` and the new invite columns default so no backfill
-- is needed; the membership CHECK is widened, never narrowed; the trigger
-- refuses writes that are already impossible today (no draft households
-- exist yet).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. households.state + nullable name
-- ---------------------------------------------------------------------------

alter table public.households
  add column if not exists state text not null default 'live';

-- House pattern (053/055/063/064/068/078/080/082): drop-if-exists then add,
-- so the migration is re-runnable and `db reset` never dies on a second pass.
alter table public.households
  drop constraint if exists households_state_valid;
alter table public.households
  add constraint households_state_valid
  check (state in ('draft', 'live'));

alter table public.households
  alter column name drop not null;

-- A LIVE household always has a name; only a draft may go without one. This
-- is the SQL half of the invariant `CreateHouseholdSchema`'s refine carries on
-- the wire and the command service carries in between.
alter table public.households
  drop constraint if exists households_live_has_name;
alter table public.households
  add constraint households_live_has_name
  check (state = 'draft' or (name is not null and length(name) > 0));

comment on column public.households.state is
  'draft = authored by a nanny before she has a family: no owner, no parent member, nothing priceable (D-36), and invisible to every cron sweep. live = an ordinary household. A draft goes live exactly once, inside redeem_household_invite (094), in the same transaction that makes a parent its owner.';

comment on column public.households.name is
  'NULL only while state = draft (§4.2) — a nanny is never asked for a family name she does not have yet; it is asked for at the share moment. Rendered "Untitled draft".';

-- Serves the draft-exclusion joins below and any future live-only sweep.
create index if not exists households_state_idx
  on public.households (state)
  where state = 'draft';

-- ---------------------------------------------------------------------------
-- 2. household_members.status gains 'candidate'
--
-- MATCHED PAIR: this CHECK and `HOUSEHOLD_MEMBER_STATUSES` in
-- packages/shared-types/src/schemas/household.schema.ts only ever change
-- together (009:77-80's contract), and the contract test in
-- packages/shared-types/tests/household.schema.test.ts pins them to each other.
-- ---------------------------------------------------------------------------

alter table public.household_members
  drop constraint if exists household_members_status_check;
alter table public.household_members
  add constraint household_members_status_check
  check (status in ('active', 'removed', 'candidate'));

comment on column public.household_members.status is
  'active | removed | candidate. `candidate` (D-49) is a nanny who redeemed a code into a live household but whose terms are not accepted yet: she matches no `status = ''active''` predicate anywhere, so she reads nothing but her own terms_proposals row until acceptance flips her to active. Never write a `status != ''removed''` filter — it would silently admit her.';

-- ---------------------------------------------------------------------------
-- 3. household_invites — the terms-link window and its receipts (§5.3, §6.1)
--
-- `link_expires_at` is a SEPARATE clock from `expires_at`, and that split is
-- load-bearing rather than fussy. The CODE keeps its 30 days (009:122,
-- untouched) because a family may reasonably take three weeks to decide and
-- she may read the code out over the phone. The public WEB PAGE is the
-- surface that carries her RATE in the open, and 30 days of a live URL is 30
-- days of exposure for a conversation that is usually over in a week.
--
-- This is one of Marisol's three standing conditions for the rate being on
-- that page at all (D-51). The other two are the per-row revoke (over the
-- existing `revokePending`) and the page dying the instant the code is
-- redeemed. Cutting ANY of the three takes the rate off the page and
-- re-opens the decision — the coupling is recorded here, in §6.2, and in the
-- 3-O ledger row, so a schedule-pressured session cannot drop one quietly.
-- ---------------------------------------------------------------------------

alter table public.household_invites
  add column if not exists link_expires_at timestamptz;

alter table public.household_invites
  add column if not exists opened_at timestamptz;

alter table public.household_invites
  add column if not exists label text;

alter table public.household_invites
  drop constraint if exists household_invites_label_length;
alter table public.household_invites
  add constraint household_invites_label_length
  check (label is null or char_length(label) <= 80);

comment on column public.household_invites.link_expires_at is
  'When the PUBLIC /t/:code terms page stops rendering (§6.1). A different clock from expires_at: the code lives 30 days so it can be read over the phone, the page defaults to 7 because it carries her rate in the open (D-51/M26).';

comment on column public.household_invites.opened_at is
  'First time the web page rendered for this code (§5.3 "Opened"), stamped by the CF worker. WHETHER it reached them — deliberately never how many times, from where, or for how long.';

comment on column public.household_invites.label is
  'Her private label for the recipient ("The Bakers"), asked for at the share moment. For her eyes only: never on the public page, never shown to the recipient.';

-- ---------------------------------------------------------------------------
-- 4. Draft households hold no cron-visible rows — enforced, not assumed
--
-- See THE CRON AUDIT in the header for why this is a trigger on five tables
-- rather than a WHERE clause in ten jobs. Every one of those jobs enumerates
-- one of these tables (or `schedule_patterns`, which cannot materialise
-- without `shifts`); none can see a row that does not exist.
--
-- The membership gates already make each of these writes impossible in a
-- draft today — there is no owner or parent to pass `WRITE_ROLES`, and a
-- clock-in needs a shift. This trigger is what stops that from being a
-- coincidence of the current gates: it means a future write path, a
-- service-role script, or a well-meaning refactor cannot quietly give a
-- draft household cron exposure, and the failure is loud and immediate
-- rather than a digest fired at a nanny with no family.
--
-- BEFORE INSERT only: a household goes draft -> live and never back, so a row
-- that was legal when written stays legal, and the live-ward transition in
-- 094 does not need to re-validate anything it inherits.
-- ---------------------------------------------------------------------------

create or replace function private.refuse_write_in_draft_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.households h
    where h.id = new.household_id
      and h.state = 'draft'
  ) then
    raise exception
      'household % is a draft: % rows are not permitted until a parent joins (D-36)',
      new.household_id, tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.refuse_write_in_draft_household() from public;
revoke all on function private.refuse_write_in_draft_household() from anon;
revoke all on function private.refuse_write_in_draft_household()
  from authenticated;

comment on function private.refuse_write_in_draft_household is
  'Refuses any INSERT into a cron-visible table for a household still in draft state (D-34/D-36). Makes "a draft generates no scheduled work" a database invariant rather than a consequence of the current role gates — see the CRON AUDIT in 093''s header.';

drop trigger if exists refuse_draft_shifts on public.shifts;
create trigger refuse_draft_shifts
  before insert on public.shifts
  for each row execute function private.refuse_write_in_draft_household();

drop trigger if exists refuse_draft_child_commitments
  on public.child_commitments;
create trigger refuse_draft_child_commitments
  before insert on public.child_commitments
  for each row execute function private.refuse_write_in_draft_household();

drop trigger if exists refuse_draft_timesheets on public.timesheets;
create trigger refuse_draft_timesheets
  before insert on public.timesheets
  for each row execute function private.refuse_write_in_draft_household();

drop trigger if exists refuse_draft_time_entries on public.time_entries;
create trigger refuse_draft_time_entries
  before insert on public.time_entries
  for each row execute function private.refuse_write_in_draft_household();

-- Belt and braces on the one the membership table already makes impossible.
-- If this trigger ever fires, `WRITE_ROLES` has been widened and D-36's whole
-- "structurally unable to produce anything priceable" argument has failed.
drop trigger if exists refuse_draft_pay_arrangements on public.pay_arrangements;
create trigger refuse_draft_pay_arrangements
  before insert on public.pay_arrangements
  for each row execute function private.refuse_write_in_draft_household();

-- ---------------------------------------------------------------------------
-- 5. The draft-author capability, in RLS (§2.2)
--
-- `WRITE_ROLES` does NOT widen. Instead one narrow capability sits beside the
-- existing role gate:
--
--   draftAuthor(household, membership) =
--     household.state = 'draft'
--     AND membership.role = 'nanny'
--     AND membership.user_id = household.created_by
--
-- It grants the household name, children CRUD, invite mint/revoke, and terms
-- authoring. It grants nothing else, and it evaluates FALSE FOREVER the
-- moment `state` flips to 'live' — which is what makes it safe to write once
-- and never revisit. All three conjuncts matter: without the `created_by`
-- clause a second nanny redeeming into a draft would inherit authorship.
--
-- Writes still go through the API under the service role; this policy is the
-- RLS half of the same statement, so the two halves cannot drift.
-- ---------------------------------------------------------------------------

create or replace function private.is_draft_author(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.households h
    join public.household_members m on m.household_id = h.id
    where h.id = hid
      and h.state = 'draft'
      and h.created_by = (select auth.uid())
      and m.user_id = (select auth.uid())
      and m.role = 'nanny'
      and m.status = 'active'
  );
$$;

revoke all on function private.is_draft_author(uuid) from public;
revoke all on function private.is_draft_author(uuid) from anon;
revoke all on function private.is_draft_author(uuid) from authenticated;
grant execute on function private.is_draft_author(uuid) to anon;
grant execute on function private.is_draft_author(uuid) to authenticated;
grant execute on function private.is_draft_author(uuid) to service_role;

comment on function private.is_draft_author is
  'The §2.2 draft-author capability: the nanny who CREATED a household that is still a draft. Grants the household name, children, invites and terms authoring — nothing else — and evaluates false forever once the household goes live.';

drop policy if exists "Draft authors can update their draft" on public.households;
create policy "Draft authors can update their draft" on public.households
  for update using (private.is_draft_author(id))
  with check (private.is_draft_author(id));

drop policy if exists "Draft authors can manage draft invites"
  on public.household_invites;
create policy "Draft authors can manage draft invites"
  on public.household_invites
  for select using (private.is_draft_author(household_id));
