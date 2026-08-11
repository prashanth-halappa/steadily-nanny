-- 074 Household currency + jurisdiction
--
-- Two columns on the already-existing `public.households` (009's table): the
-- currency a household's pay is priced in, and the US state its household
-- of record sits in. No new table, no new policy — the existing household
-- RLS (009) already scopes every read/write on this table to a member, and
-- these are just more data on a row a member could already see.
--
-- WHY THE HOUSEHOLD OWNS CURRENCY, NOT JUST THE ARRANGEMENT
-- `pay_arrangements.currency` (041) and `expenses.currency` (044) already
-- carry a currency each, but both wire schemas invented a `'GBP'` default
-- when a client omitted the field — a silent guess with no relationship to
-- where the family actually lives. This column is the real fallback: the
-- household's own currency, set once from the device at onboarding (or
-- picked in settings) and read by the API to resolve an absent request
-- currency, so the guess is at least THIS family's currency and never a
-- foreign one (docs/11-MONEY.md §1).
--
-- JURISDICTION IS A US STATE CODE, NOT A COUNTRY
-- Nullable: a device can name a country from its locale but never a state,
-- so this ships null until a parent sets it in settings (no data migration
-- needed for that gap — D-9, this app is pre-launch). The two-letter shape
-- mirrors `currency`'s own three-letter one: a `check` on the wire shape,
-- not a foreign table of valid codes, because the set of US state codes
-- changes about as often as ISO-4217 does.
--
-- SQL DEFAULT IS THE LEGACY FLOOR ONLY
-- `currency not null default 'USD'` exists so this column is never null on
-- a row a future migration touches without naming it explicitly — it is not
-- meant to be read as "USD is the house currency"; every real write always
-- names one (device-derived at create, resolved server-side thereafter).

alter table public.households
  add column if not exists currency char(3) not null default 'USD'
    check (currency ~ '^[A-Z]{3}$'),
  add column if not exists jurisdiction text
    check (jurisdiction is null or jurisdiction ~ '^[A-Z]{2}$');
