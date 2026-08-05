-- 009 Households, membership and invites
--
-- The access spine of the whole app. Every product table from here on is scoped
-- to a household and authorised through the helpers defined at the bottom of
-- this file.
--
-- WHY THIS REPLACES THE TEMPLATE'S OWNERSHIP MODEL
-- The template scopes rows with `auth.uid() = owner_id` (see 002, 008). That
-- cannot express this product: a household has two parents, one or more nannies
-- and possibly a view-only grandparent, and a nanny belongs to several
-- households at once. Access is therefore membership-derived, never owner-derived.
--
-- ROLES
--   owner   the parent who created the household; cannot be removed
--   parent  full read/write (the co-parent)
--   nanny   works shifts; may accept / counter / clock in; cannot invite or cancel
--   helper  grandparent or occasional sitter; read-only
--
-- PRIVACY NOTE
-- A nanny's OTHER households must never be nameable to this one. That rule is
-- not expressible here (it is about what a service returns, not which rows a
-- user may read) and is enforced in the API's availability domain. What this
-- file guarantees is the floor: a user can only ever read rows for households
-- they are an active member of.

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id                              uuid primary key default gen_random_uuid(),
  name                            text not null,
  -- IANA zone. Shift wall-clock times are authored and rendered in this zone;
  -- the stored timestamptz is always UTC. See 013_shifts.sql.
  timezone                        text not null default 'Europe/London',
  address_line                    text,
  latitude                        numeric(9, 6),
  longitude                       numeric(9, 6),
  -- Co-parent approval rule, set once during onboarding (design flow 1f).
  --   either      either parent may change anything without asking
  --   ask_other   the other parent is asked first (scope below)
  --   owner_only  only the owner may change things
  approval_mode                   text not null default 'either'
    check (approval_mode in ('either', 'ask_other', 'owner_only')),
  -- What `ask_other` actually covers. Everyday tweaks going straight through is
  -- what stops approval becoming a blocker.
  approval_scope                  text not null default 'short_notice_and_cancellations'
    check (approval_scope in ('all', 'short_notice_and_cancellations')),
  -- "If nobody answers in 2 hrs, send it anyway" — a silent phone must never
  -- leave a day uncovered.
  approval_timeout_minutes        integer not null default 120
    check (approval_timeout_minutes between 0 and 10080),
  -- A change inside this window is flagged to the carer as short notice.
  short_notice_hours              integer not null default 24
    check (short_notice_hours between 0 and 336),
  -- Cancellations inside this window still count as paid hours on the timesheet.
  cancellation_paid_within_hours  integer not null default 24
    check (cancellation_paid_within_hours between 0 and 336),
  created_by                      uuid references public.user_profiles(user_id)
                                    on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------

create table if not exists public.household_members (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households(id)
                         on delete cascade,
  -- FK targets user_profiles, not auth.users, so the DB enforces "profile row
  -- exists first" ordering (GOLDEN-FIXES.md #7).
  user_id              uuid not null references public.user_profiles(user_id)
                         on delete cascade,
  -- MATCHED PAIR: this CHECK and HOUSEHOLD_ROLES in
  -- packages/shared-types/src/schemas/household.schema.ts only ever change
  -- together, in one migration + one shared-types change (planned widening
  -- path for agency roles — see TIER0-PLAN.md Phase 0-B).
  role                 text not null
                         check (role in ('owner', 'parent', 'nanny', 'helper')),
  -- Denormalised from role so a parent can grant/revoke edit rights to a helper
  -- without changing what the person *is*.
  can_edit             boolean not null default false,
  status               text not null default 'active'
                         check (status in ('active', 'removed')),
  -- Per-household display overrides: the nanny may be "Nia" to one family and
  -- "Nia R." to another, and each household picks her timeline colour.
  display_name_override text,
  colour                text,
  joined_at            timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One membership row per (user, household). Also the exact index the RLS helper
-- below probes on every row of every household-scoped select, so it must exist
-- or RLS degrades into a per-row sequential scan.
create unique index if not exists household_members_user_household_idx
  on public.household_members (user_id, household_id);

-- Serves "who is in this household?" list reads.
create index if not exists household_members_household_status_idx
  on public.household_members (household_id, status)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- household_invites
-- ---------------------------------------------------------------------------

create table if not exists public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  -- Human-transcribable short code, e.g. 'R4K-92T'. Generated by the API from an
  -- alphabet with the ambiguous glyphs (0/O, 1/I/L) removed, because this gets
  -- read aloud and typed in by hand.
  code          text not null unique,
  email         text,
  role          text not null check (role in ('parent', 'nanny', 'helper')),
  invited_by    uuid references public.user_profiles(user_id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '30 days'),
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by   uuid references public.user_profiles(user_id) on delete set null,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Redeeming an invite is a lookup by code on the hot path of nanny onboarding.
create index if not exists household_invites_code_pending_idx
  on public.household_invites (code)
  where status = 'pending';

create index if not exists household_invites_household_idx
  on public.household_invites (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Authorisation helpers
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER is load-bearing here, not incidental. These functions read
-- household_members, and household_members' own RLS policy calls them. Running
-- as the definer (the table owner) means the inner read is not itself
-- policy-checked, which is what breaks the otherwise-infinite recursion.
--
-- search_path is pinned to '' and every object is schema-qualified, so a caller
-- cannot redirect these lookups by setting their own search_path.

create or replace function private.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

comment on function private.is_household_member(uuid) is
  'True when the current user is an active member of the household. The read-side predicate for every household-scoped table.';

-- Write-side predicate. Nannies and helpers are deliberately excluded: a nanny
-- responds to shifts (accept / counter / clock in) through the API rather than
-- by writing schedule rows directly, and a helper is read-only.
create or replace function private.is_household_parent(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner', 'parent')
  );
$$;

comment on function private.is_household_parent(uuid) is
  'True when the current user is an active owner/parent of the household. The write-side predicate.';

create or replace function private.household_ids_for_current_user()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.household_members m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

comment on function private.household_ids_for_current_user() is
  'Every household the current user actively belongs to. Used for cross-household reads such as a nanny listing her families.';

-- GRANTS — subtle, and load-bearing.
--
-- A policy expression is evaluated with the CALLER's privileges, even when the
-- function it calls is SECURITY DEFINER. SECURITY DEFINER changes who the
-- function runs AS once entered; it does not grant the right to enter it. So if
-- `authenticated` cannot EXECUTE these helpers, every policy below fails with
-- `permission denied for function is_household_member` — which surfaces as a
-- 500 on ordinary reads, not as an empty result.
--
-- The pattern is therefore: revoke the implicit PUBLIC grant, then grant back
-- explicitly. Revoking from PUBLIC is what actually removes it — anon and
-- authenticated inherit from PUBLIC, so naming only those two leaves the grant
-- in place (GOLDEN-FIXES.md #16).
--
-- Granting execute is safe here: each helper answers only about the CURRENT
-- user. There is no argument that makes one report on somebody else's
-- membership. anon is included so an unauthenticated read resolves to
-- `auth.uid() is null` -> false -> zero rows, rather than erroring.
grant usage on schema private to anon, authenticated, service_role;

revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.is_household_parent(uuid) from public;
revoke all on function private.household_ids_for_current_user() from public;

grant execute on function private.is_household_member(uuid)
  to anon, authenticated, service_role;
grant execute on function private.is_household_parent(uuid)
  to anon, authenticated, service_role;
grant execute on function private.household_ids_for_current_user()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Repositories use the service role and bypass RLS entirely; the service layer
-- owns authorisation. These policies are defence in depth for any direct
-- PostgREST access with a user JWT.

alter table public.households enable row level security;

drop policy if exists "Members can view their households" on public.households;
create policy "Members can view their households" on public.households
  for select using (private.is_household_member(id));

drop policy if exists "Parents can update their household" on public.households;
create policy "Parents can update their household" on public.households
  for update using (private.is_household_parent(id))
  with check (private.is_household_parent(id));

-- Insert is deliberately absent: creating a household also creates the owner's
-- membership row, and the two must happen together. That transaction belongs to
-- the API under the service role.

alter table public.household_members enable row level security;

drop policy if exists "Members can view co-members" on public.household_members;
create policy "Members can view co-members" on public.household_members
  for select using (private.is_household_member(household_id));

drop policy if exists "Parents can manage members" on public.household_members;
create policy "Parents can manage members" on public.household_members
  for update using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

alter table public.household_invites enable row level security;

-- Only parents see invites. A pending invite is redeemed by code through the
-- API before the redeemer is a member of anything, so there is deliberately no
-- policy that lets a stranger select one — that lookup runs under the service
-- role, which also keeps invite codes from being enumerable.
drop policy if exists "Parents can view invites" on public.household_invites;
create policy "Parents can view invites" on public.household_invites
  for select using (private.is_household_parent(household_id));

drop policy if exists "Parents can manage invites" on public.household_invites;
create policy "Parents can manage invites" on public.household_invites
  for update using (private.is_household_parent(household_id))
  with check (private.is_household_parent(household_id));

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_households_updated_at on public.households;
create trigger set_households_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

drop trigger if exists set_household_members_updated_at on public.household_members;
create trigger set_household_members_updated_at
  before update on public.household_members
  for each row execute function public.set_updated_at();

drop trigger if exists set_household_invites_updated_at on public.household_invites;
create trigger set_household_invites_updated_at
  before update on public.household_invites
  for each row execute function public.set_updated_at();
