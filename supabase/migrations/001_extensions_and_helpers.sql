-- 001 Extensions and shared helpers
-- Baseline building blocks used by every later migration:
--   * pgcrypto      -> gen_random_uuid() for uuid primary keys
--   * set_updated_at() -> reusable BEFORE UPDATE trigger fn that stamps updated_at
--   * private schema -> holds SECURITY DEFINER helpers not exposed on the public API
--
-- SECURITY NOTE: functions in `private` are never reachable through the PostgREST
-- API (only `public` is exposed by default). Sensitive helpers live here.

create extension if not exists pgcrypto;

-- Shared trigger function: keep updated_at fresh on every UPDATE.
-- search_path pinned to '' (empty) so the function can't be hijacked via a
-- caller-controlled search_path; it references no schema-qualified objects, and
-- now() resolves from pg_catalog (always implicitly present).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Private schema for backend-only SECURITY DEFINER helpers (not on the public API).
create schema if not exists private;
