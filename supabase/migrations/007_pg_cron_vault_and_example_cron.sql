-- 007 pg_cron + Vault helpers + one example scheduled HTTP job
--
-- pg_cron HTTP jobs resolve the API base URL and job API key from Supabase Vault
-- (avoids hard-coded hosts/keys in cron.job.command). net.http_post comes from
-- pg_net.
--
-- ONE-TIME SETUP (run once per project in the SQL editor if these secrets are missing):
--   SELECT vault.create_secret('https://api.yourapp.example.com', 'cron_api_base_url', 'API base URL for pg_cron HTTP jobs');
--   SELECT vault.create_secret('<JOB_API_KEY>', 'cron_job_api_key', 'X-Job-Api-Key header for pg_cron HTTP jobs');
-- To rotate: vault.update_secret(...) or create a new secret version per Supabase docs.
--
-- NOTE: ALTER DATABASE / ALTER ROLE ... SET app.settings.* is not granted on typical
-- hosted projects; Vault + SECURITY DEFINER helpers match the hosted permission model.

create extension if not exists pg_cron;
-- NOTE on pg_net: net.http_post (used by the example cron below) needs the
-- pg_net extension. It is intentionally NOT created in this base migration:
-- pg_net is not relocatable out of its public/net install, so creating it here
-- trips the extension_in_public linter (0014) on every fresh project. Instead it
-- is enabled inside the commented SETUP block below, next to the cron schedule
-- that actually uses it — so a fresh migrate stays lint-clean until you opt in.

-- Vault-backed resolvers. SECURITY DEFINER so they can read vault.decrypted_secrets;
-- STABLE; search_path pinned to vault. Never exposed on the public API (private schema).
create or replace function private.cron_api_base_url()
returns text
language sql
stable
security definer
set search_path = vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'cron_api_base_url'
  limit 1
$$;

create or replace function private.cron_job_api_key()
returns text
language sql
stable
security definer
set search_path = vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'cron_job_api_key'
  limit 1
$$;

revoke all on function private.cron_api_base_url() from public;
revoke all on function private.cron_job_api_key() from public;
grant execute on function private.cron_api_base_url() to postgres;
grant execute on function private.cron_job_api_key() to postgres;
grant execute on function private.cron_api_base_url() to service_role;
grant execute on function private.cron_job_api_key() to service_role;

-- ---------------------------------------------------------------------------
-- Example scheduled HTTP job.
--
-- Commented out so this migration never fails on an environment where pg_cron is
-- unavailable (e.g. local shadow DB). Uncomment on a project that has pg_cron +
-- pg_net enabled and the two Vault secrets created (see setup header).
--
-- SETUP: add your own cron jobs here.
-- ---------------------------------------------------------------------------
-- create extension if not exists pg_net;  -- required by net.http_post below
-- SELECT cron.schedule(
--   'example-maintenance',
--   '0 3 * * *',
--   $$SELECT net.http_post(
--       url := private.cron_api_base_url() || '/api/jobs/example-maintenance',
--       headers := jsonb_build_object(
--         'X-Job-Api-Key', private.cron_job_api_key(),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--   )$$
-- );
