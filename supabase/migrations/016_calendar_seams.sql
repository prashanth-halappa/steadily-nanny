-- 016 Calendar integration seams (Google / Apple) — schema only, no sync yet
--
-- Google and Apple Calendar sync is NOT built. This migration exists because
-- three of the decisions it encodes are expensive to retrofit and cheap to make
-- now, and because two screens in the design already depend on the third.
--
-- WHAT IS EXPENSIVE TO RETROFIT
--   1. Stable identity. Every syncable entity already carries `ical_uid` +
--      `sequence` (see 011, 014, 015). Those are how CalDAV and the Google API
--      recognise "this is an update to an event you already have" rather than
--      creating a duplicate. Adding them after a sync has run would mean
--      re-keying every event already pushed into somebody's real calendar.
--   2. Absolute time. Every scheduling row stores timestamptz plus the IANA zone
--      it was authored in — never a bare date + local time. External calendars
--      speak instants; a local-only model cannot be exported without guessing.
--   3. iCal-native recurrence. Patterns store a real RRULE with EXDATEs, so a
--      future exporter needs no translation layer.
--
-- WHAT THE DESIGN ALREADY DEPENDS ON
-- Free/busy is deliberately NOT modelled as "a shift". Two screens quote a
-- parent's own calendar back at them:
--   * the swap flow — "Sam, free 15:00-18:00, from Sam's shared calendar"
--   * the co-parent approval — "Your calendar: 15:00-18:00 free / 18:30 five-a-side"
-- Those need busy spans that are not shifts and belong to no household. Hence
-- external_busy_blocks as an independent source, unioned with internal
-- commitments in v_busy_blocks. In this wave the table simply stays empty (or is
-- seeded by hand); a later importer writes rows and both screens light up with
-- no schema change.

-- ---------------------------------------------------------------------------
-- calendar_accounts
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.user_profiles(user_id)
                        on delete cascade,
  provider            text not null
                        check (provider in ('google', 'apple', 'caldav')),
  -- The account as the provider identifies it (usually an email). Not a secret.
  account_identifier  text not null,
  display_name        text,
  sync_enabled        boolean not null default true,
  -- read  : import busy blocks only (the privacy-safest default)
  -- write : push our shifts out
  -- both  : two-way
  sync_direction      text not null default 'read'
                        check (sync_direction in ('read', 'write', 'both')),
  default_calendar_id text,
  -- A POINTER into Supabase Vault, never a token. Refresh tokens must not sit in
  -- a table that any future `select *` or logged query could surface; migration
  -- 007 already establishes Vault as where this project keeps secrets.
  credentials_ref     text,
  -- Provider incremental-sync cursor (Google syncToken / CalDAV ctag).
  sync_token          text,
  last_sync_at        timestamptz,
  status              text not null default 'active'
                        check (status in ('active', 'reauth_required', 'disabled')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists calendar_accounts_user_provider_idx
  on public.calendar_accounts (user_id, provider, account_identifier);

comment on column public.calendar_accounts.credentials_ref is
  'Vault secret name holding the OAuth refresh token. Never store the token itself in this table.';

-- ---------------------------------------------------------------------------
-- calendar_event_links
-- ---------------------------------------------------------------------------
-- Maps one of our entities to the event a provider created for it. Kept as a
-- separate table rather than columns on `shifts` because one shift can be
-- mirrored into several calendars (both parents, plus the nanny's own), so the
-- relationship is one-to-many.

create table if not exists public.calendar_event_links (
  id                    uuid primary key default gen_random_uuid(),
  calendar_account_id   uuid not null references public.calendar_accounts(id)
                          on delete cascade,
  entity_type           text not null
                          check (entity_type in ('shift', 'time_off', 'commitment')),
  entity_id             uuid not null,
  external_event_id     text not null,
  external_calendar_id  text,
  -- Provider concurrency token, so we can detect that the user edited the event
  -- on their side and avoid clobbering it.
  etag                  text,
  -- The `sequence` of ours that was last pushed. If the entity's current
  -- sequence is higher, this link is stale and needs a push.
  last_pushed_sequence  integer not null default 0,
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists calendar_event_links_account_entity_idx
  on public.calendar_event_links (calendar_account_id, entity_type, entity_id);

create index if not exists calendar_event_links_entity_idx
  on public.calendar_event_links (entity_type, entity_id);

-- entity_id is intentionally NOT a foreign key: it points at one of three
-- different tables depending on entity_type, which SQL cannot express as a
-- single FK. Cleanup is the sync service's job — a deliberate trade for keeping
-- one link table instead of three near-identical ones.

-- ---------------------------------------------------------------------------
-- external_busy_blocks
-- ---------------------------------------------------------------------------
-- Imported busy time from someone's own calendar. Belongs to a USER, never to a
-- household — this is a person's own diary, and one household must never be able
-- to infer another's existence from it.

create table if not exists public.external_busy_blocks (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.user_profiles(user_id)
                        on delete cascade,
  calendar_account_id uuid references public.calendar_accounts(id) on delete cascade,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  all_day             boolean not null default false,
  -- Mirrors the iCalendar TRANSP / freeBusy distinction: an event the user has
  -- marked "free" should not count against their availability.
  opacity             text not null default 'busy'
                        check (opacity in ('busy', 'free', 'tentative')),
  -- Stored ONLY if the user opted into sharing titles. Default is null: the
  -- product promise is that others see "unavailable", not "dentist".
  title               text,
  source              text not null default 'calendar',
  external_event_id   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint external_busy_blocks_range check (ends_at > starts_at)
);

create index if not exists external_busy_blocks_user_range_idx
  on public.external_busy_blocks (user_id, starts_at, ends_at)
  where opacity <> 'free';

-- ---------------------------------------------------------------------------
-- v_busy_blocks
-- ---------------------------------------------------------------------------
-- The single read surface for "when is this person unavailable?", unioning the
-- three sources: confirmed shifts, booked time off, and imported calendar busy.
--
-- CRITICAL: this view exposes NO household id, household name, child, or note.
-- That is the point. Clash detection across families reads from here, so the
-- anonymity promise is a property of the shape of the data, not of a caller
-- remembering to strip fields. `kind` is the most any other family may learn.
--
-- security_invoker = on so the view is evaluated with the CALLER's permissions
-- and the underlying RLS policies still apply. Without it the view would run as
-- its owner and become a bypass around every policy beneath it.
create or replace view public.v_busy_blocks
with (security_invoker = on) as
  select
    s.carer_id                as user_id,
    s.starts_at,
    s.ends_at,
    'other_commitment'::text  as kind,
    s.ical_uid                as source_uid
  from public.shifts s
  where s.carer_id is not null
    and s.status in ('pending', 'confirmed')

  union all

  select
    t.user_id,
    t.starts_at,
    t.ends_at,
    'time_off'::text,
    t.ical_uid
  from public.carer_time_off t
  where t.status <> 'cancelled'

  union all

  select
    b.user_id,
    b.starts_at,
    b.ends_at,
    'personal'::text,
    b.external_event_id
  from public.external_busy_blocks b
  where b.opacity <> 'free';

comment on view public.v_busy_blocks is
  'Anonymised availability across every source. Deliberately carries no household, child, or note - cross-family clash detection reads this so the privacy promise is structural.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- A calendar account and its imported busy blocks are strictly the owner's.
-- Nobody else reads the raw rows; other people reach the anonymised spans only
-- through v_busy_blocks, which is itself still policy-checked because the view
-- is security_invoker.

alter table public.calendar_accounts enable row level security;

drop policy if exists "Own calendar accounts" on public.calendar_accounts;
create policy "Own calendar accounts" on public.calendar_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.calendar_event_links enable row level security;

drop policy if exists "Own calendar links" on public.calendar_event_links;
create policy "Own calendar links" on public.calendar_event_links
  for all using (
    exists (
      select 1 from public.calendar_accounts a
      where a.id = calendar_account_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.calendar_accounts a
      where a.id = calendar_account_id and a.user_id = auth.uid()
    )
  );

alter table public.external_busy_blocks enable row level security;

-- Read: yourself, or someone you share a household with — the same rule as
-- carer_availability (011). A co-parent seeing "you're busy 18:30" is exactly
-- what the approval screen needs; the `title` column stays null unless the owner
-- opted in, so sharing the span shares no detail.
drop policy if exists "Read own or shared busy blocks" on public.external_busy_blocks;
create policy "Read own or shared busy blocks" on public.external_busy_blocks
  for select using (
    auth.uid() = user_id or private.shares_household_with(user_id)
  );

drop policy if exists "Write own busy blocks" on public.external_busy_blocks;
create policy "Write own busy blocks" on public.external_busy_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_calendar_accounts_updated_at on public.calendar_accounts;
create trigger set_calendar_accounts_updated_at
  before update on public.calendar_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists set_calendar_event_links_updated_at on public.calendar_event_links;
create trigger set_calendar_event_links_updated_at
  before update on public.calendar_event_links
  for each row execute function public.set_updated_at();

drop trigger if exists set_external_busy_blocks_updated_at on public.external_busy_blocks;
create trigger set_external_busy_blocks_updated_at
  before update on public.external_busy_blocks
  for each row execute function public.set_updated_at();
