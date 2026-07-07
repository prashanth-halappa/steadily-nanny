-- 006 Subscriptions, usage counters, email log + their RPCs
--
-- Tables:
--   user_subscriptions   - one row per user; the single source of truth for tier.
--                          Written only via process_subscription_event (webhook).
--   subscription_events  - append-only webhook event log (idempotency via event_id).
--   user_usage_counters  - per-user/feature/period quota counters.
--   email_log            - outbound email audit trail with dedupe.
--
-- RPCs:
--   process_subscription_event  - hardened webhook upsert (see security notes below).
--   check_and_increment_usage   - atomic check+increment (closes a TOCTOU quota burst).
--   increment_usage_counter     - plain atomic increment.
--
-- SECURITY POSTURE (applies throughout this file):
--   * Every table has RLS enabled.
--   * Owner-readable tables (user_subscriptions, user_usage_counters) expose only a
--     SELECT policy on auth.uid() = user_id; there is NO authenticated INSERT/UPDATE
--     policy, so writes are service-role only.
--   * Backend-only tables (subscription_events, email_log) have no client policies
--     and client-role table privileges are revoked.
--   * Every RPC is REVOKE'd from PUBLIC/anon/authenticated and GRANT'd only to
--     service_role.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.user_subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users(id) on delete cascade,
  revenuecat_app_user_id  text,
  tier                    text not null default 'free',
  product_id              text,
  entitlement_id          text,
  platform                text,
  store                   text,
  environment             text,
  expires_at              timestamptz,
  is_active               boolean not null default true,
  last_event_id           text,
  last_event_type         text,
  last_event_at           timestamptz,
  original_purchase_at    timestamptz,
  unsubscribe_detected_at timestamptz,
  is_trial                boolean not null default false,
  trial_started_at        timestamptz,
  trial_ends_at           timestamptz,
  converted_from_trial_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_user_subscriptions_rc_user
  on public.user_subscriptions (revenuecat_app_user_id);

create table if not exists public.subscription_events (
  id              uuid primary key default gen_random_uuid(),
  event_id        text not null unique,
  event_type      text not null,
  user_id         uuid references auth.users(id) on delete cascade,
  product_id      text,
  event_timestamp timestamptz not null,
  payload         jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_subscription_events_user on public.subscription_events (user_id);

create table if not exists public.user_usage_counters (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  feature      text not null,
  period_type  text not null,
  period_start date not null,
  count        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint user_usage_counters_uq unique (user_id, feature, period_type, period_start)
);

create table if not exists public.email_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  email_type text not null,
  recipient  text not null,
  status     text not null default 'sent',
  dedupe_key text,
  metadata   jsonb,
  sent_at    timestamptz not null default now()
);

-- Dedupe outbound email: at most one row per non-null dedupe_key.
create unique index if not exists email_log_dedupe_key_uidx
  on public.email_log (dedupe_key) where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.user_subscriptions enable row level security;
drop policy if exists "Users can view own subscription" on public.user_subscriptions;
create policy "Users can view own subscription" on public.user_subscriptions
  for select using (auth.uid() = user_id);
-- Writes are service-role only (bypasses RLS); no authenticated INSERT/UPDATE policy.

alter table public.user_usage_counters enable row level security;
drop policy if exists "Users can view own usage" on public.user_usage_counters;
create policy "Users can view own usage" on public.user_usage_counters
  for select using (auth.uid() = user_id);
-- Writes are service-role only; increments happen exclusively via the RPCs below.

alter table public.subscription_events enable row level security;
-- Backend-only: no client policies; strip client-role privileges.
revoke all on public.subscription_events from anon, authenticated;

alter table public.email_log enable row level security;
-- Backend-only: no client policies; strip client-role privileges.
revoke all on public.email_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: process_subscription_event (HARDENED)
--
-- Golden fixes preserved from the source implementation:
--   * SECURITY INVOKER (the default) — never elevates. The backend calls it as
--     service_role, which already holds the needed table grants and bypasses RLS.
--   * NULL-guard instead of an auth.users probe. service_role cannot SELECT
--     auth.users; a `p_user_id IS NULL` check returns a clean 'skipped'/'unknown_user'
--     result. Non-existent users are caught by the foreign_key_violation handler
--     (FK integrity checks do NOT require SELECT on the parent table).
--   * Idempotency (ON CONFLICT (event_id) DO NOTHING -> 'duplicate').
--   * Stale-event guard (rejects events older than the last processed one).
--   * EXECUTE locked to service_role only, so a logged-in user cannot call this RPC
--     to self-grant Pro.
-- ---------------------------------------------------------------------------

create or replace function public.process_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_timestamp timestamp with time zone,
  p_user_id uuid,
  p_rc_app_user_id text,
  p_tier text,
  p_product_id text,
  p_entitlement_id text,
  p_platform text,
  p_store text,
  p_environment text,
  p_expires_at timestamp with time zone,
  p_payload jsonb,
  p_period_type text default null::text,
  p_is_trial_conversion boolean default null::boolean,
  p_price numeric default null::numeric,
  p_purchased_at timestamp with time zone default null::timestamp with time zone
)
returns jsonb
language plpgsql
-- SECURITY INVOKER (default): do NOT change to DEFINER.
-- search_path pinned to '' — every table is already public-qualified and
-- jsonb_build_object/now() resolve from pg_catalog, so an empty search_path
-- both satisfies the linter and blocks search_path hijack.
set search_path = ''
as $function$
declare
  v_current_last_event_at timestamptz;
begin
  -- service_role cannot SELECT auth.users; the FK-violation handler below covers
  -- non-existent users, so we only need a NULL guard here.
  if p_user_id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'unknown_user', 'event_id', p_event_id);
  end if;

  begin
    insert into public.subscription_events (event_id, event_type, user_id, product_id, event_timestamp, payload)
    values (p_event_id, p_event_type, p_user_id, p_product_id, p_event_timestamp, p_payload)
    on conflict (event_id) do nothing;

    if not found then
      return jsonb_build_object('status', 'duplicate', 'event_id', p_event_id);
    end if;

    select last_event_at into v_current_last_event_at
    from public.user_subscriptions where user_id = p_user_id
    for update;

    if v_current_last_event_at is not null and p_event_timestamp < v_current_last_event_at then
      return jsonb_build_object('status', 'stale', 'event_id', p_event_id,
        'event_timestamp', p_event_timestamp, 'last_event_at', v_current_last_event_at);
    end if;

    insert into public.user_subscriptions (
      user_id, revenuecat_app_user_id, tier, product_id, entitlement_id,
      platform, store, environment, expires_at, last_event_id, last_event_type, last_event_at,
      original_purchase_at, unsubscribe_detected_at
    ) values (
      p_user_id, p_rc_app_user_id,
      case when p_event_type = 'EXPIRATION' then 'free' else p_tier end,
      p_product_id, p_entitlement_id, p_platform, p_store, p_environment, p_expires_at,
      p_event_id, p_event_type, p_event_timestamp,
      case when p_event_type = 'INITIAL_PURCHASE' then p_event_timestamp else null end,
      case when p_event_type = 'CANCELLATION' then now() else null end
    )
    on conflict (user_id) do update set
      tier = case
               when p_event_type = 'EXPIRATION' then 'free'
               when p_tier is null or p_tier = 'free' then public.user_subscriptions.tier
               else p_tier
             end,
      product_id = coalesce(p_product_id, public.user_subscriptions.product_id),
      entitlement_id = coalesce(p_entitlement_id, public.user_subscriptions.entitlement_id),
      expires_at = coalesce(p_expires_at, public.user_subscriptions.expires_at),
      last_event_id = p_event_id,
      last_event_type = p_event_type,
      last_event_at = p_event_timestamp,
      original_purchase_at = case
        when p_event_type = 'INITIAL_PURCHASE' then p_event_timestamp
        else public.user_subscriptions.original_purchase_at end,
      unsubscribe_detected_at = case
        when p_event_type = 'CANCELLATION' then now()
        when p_event_type = 'UNCANCELLATION' then null
        else public.user_subscriptions.unsubscribe_detected_at end,
      updated_at = now()
    where public.user_subscriptions.last_event_at is null
       or p_event_timestamp >= public.user_subscriptions.last_event_at;

    if p_period_type = 'TRIAL' then
      update public.user_subscriptions set
        is_trial = true,
        trial_started_at = coalesce(trial_started_at, p_purchased_at),
        trial_ends_at = coalesce(p_expires_at, trial_ends_at)
      where user_id = p_user_id;
    end if;

    if p_is_trial_conversion = true then
      update public.user_subscriptions set
        is_trial = false,
        converted_from_trial_at = now()
      where user_id = p_user_id;
    end if;

    if p_event_type = 'EXPIRATION' and p_period_type = 'TRIAL' then
      update public.user_subscriptions set
        is_trial = false
      where user_id = p_user_id;
    end if;

    return jsonb_build_object('status', 'processed', 'event_id', p_event_id);

  exception when foreign_key_violation then
    if sqlerrm like '%subscription_events_user_id_fkey%'
       or sqlerrm like '%user_subscriptions_user_id_fkey%' then
      return jsonb_build_object('status', 'skipped', 'reason', 'unknown_user', 'event_id', p_event_id);
    else
      raise;
    end if;
  end;
end;
$function$;

-- Backend-only EXECUTE (defense-in-depth atop RLS). Full overload signature.
revoke execute on function public.process_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text, text, timestamptz, jsonb, text, boolean, numeric, timestamptz
) from public, anon, authenticated;

grant execute on function public.process_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text, text, timestamptz, jsonb, text, boolean, numeric, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: check_and_increment_usage (atomic quota gate)
--
-- Closes a TOCTOU race: separate check-then-increment let N concurrent requests
-- at limit-1 all pass and burst past the quota. This makes check+increment ONE
-- atomic statement.
--   p_limit NULL  -> unlimited: always increment, return true.
--   p_limit <= 0  -> return false without incrementing.
--   otherwise     -> return true iff still within quota (and the row was bumped).
-- ---------------------------------------------------------------------------

create or replace function public.check_and_increment_usage(
  p_user_id uuid,
  p_feature text,
  p_period_type text,
  p_period_start date,
  p_limit integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if p_limit is not null and p_limit <= 0 then
    return false;
  end if;

  insert into public.user_usage_counters (user_id, feature, period_type, period_start, count)
  values (p_user_id, p_feature, p_period_type, p_period_start, 1)
  on conflict (user_id, feature, period_type, period_start)
  do update set
    count = public.user_usage_counters.count + 1,
    updated_at = now()
  where p_limit is null or public.user_usage_counters.count < p_limit
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.check_and_increment_usage(uuid, text, text, date, integer) from public;
revoke all on function public.check_and_increment_usage(uuid, text, text, date, integer) from anon, authenticated;
grant execute on function public.check_and_increment_usage(uuid, text, text, date, integer) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: increment_usage_counter (plain atomic increment, no limit check)
-- ---------------------------------------------------------------------------

create or replace function public.increment_usage_counter(
  p_user_id uuid,
  p_feature text,
  p_period_type text,
  p_period_start date
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into public.user_usage_counters (user_id, feature, period_type, period_start, count)
  values (p_user_id, p_feature, p_period_type, p_period_start, 1)
  on conflict (user_id, feature, period_type, period_start)
  do update set
    count = public.user_usage_counters.count + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_usage_counter(uuid, text, text, date) from public;
revoke all on function public.increment_usage_counter(uuid, text, text, date) from anon, authenticated;
grant execute on function public.increment_usage_counter(uuid, text, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_user_subscriptions_updated_at on public.user_subscriptions;
create trigger set_user_subscriptions_updated_at
  before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_usage_counters_updated_at on public.user_usage_counters;
create trigger set_user_usage_counters_updated_at
  before update on public.user_usage_counters
  for each row execute function public.set_updated_at();
