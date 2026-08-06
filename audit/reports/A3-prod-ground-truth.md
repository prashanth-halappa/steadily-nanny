## 1. Migration ledger diff

**Project:** Single candidate — `steadily-nanny` (`dylhrlvfkibipdkguptz`, `ca-central-1`, `ACTIVE_HEALTHY`). Query: `list_projects`. Table set (31 `public` tables: households, shifts, timesheets, pay_arrangements, pto_ledger, expenses, etc.) matches the cumulative schema from `supabase/migrations/001–048` (minus unapplied 047/048).

**Repo file count:** 45 SQL files occupying slots `001–048` with intentional numbering holes at **008**, **036**, and **037** (not 48 files).

**Prod applied migrations:** 43 rows. Query: `list_migrations` / `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`.

| Category | Items |
|---|---|
| **Applied in prod, no matching repo file** | **None.** Every prod `name` maps to a repo migration. |
| **In repo, not applied to prod** | `047_push_reminder_log.sql`, `048_reminders_cron.sql` |
| **Numbering holes — prod never had them** | Versions `008`, `036`, `037` absent from `schema_migrations` (repo holes were never applied). |
| **Version / name mismatch (same SQL, different version string)** | Repo `030`–`046` use sequential prefixes; prod records timestamp versions applied via dashboard/MCP. Name mapping: `030`→`20260802214046` `open_shift_change_request_events`; `031`→`20260802214106` `derive_parent_shift_edit_audit_in_sql`; `032`→`20260802214117` `fix_schedule_horizon_cron_pg_net_guard`; `033`→`20260803060849` `preserve_payroll_on_carer_deletion`; `034`→`20260804051114` `parent_shift_edit_demote_on_time_change`; `035`→`20260804051121` `household_closures`; `038`→`20260804051124` `notification_prefs`; `039`→`20260804052536` `cancellation_paid_unique`; `040`→`20260805040156` `rls_semantic_predicates`; `041`→`20260805040208` `pay_arrangements`; `042`→`20260805040218` `timesheet_earnings`; `043`→`20260805040220` `pto_ledger`; `044`→`20260805040232` `expenses`; `045`→`20260805040233` `pto_usage_per_day`; `046`→`20260805151935` `timesheet_reopen_reason`. |
| **Checksum mismatch** | **Could not verify** — MCP `list_migrations` / `schema_migrations` expose `version` and `name` only, not statement checksums. |

**Top finding:** No orphan prod migrations. Drift is **two repo migrations not yet applied** (047, 048) plus **version-string divergence** for 030–046 (content applied under timestamp IDs).

---

## 2. Live schema vs migrations

**Method:** Prod via `list_tables` (verbose) + `information_schema.columns` + `information_schema.table_constraints` / `pg_constraint`. Repo via migration `CREATE TABLE` / `ALTER TABLE` statements.

**Applied-schema comparison:** No column-type, nullability, default, PK, FK, UNIQUE, or CHECK discrepancies found across the 31 live `public` tables vs the cumulative effect of migrations 001–046.

**Objects defined in repo but absent in prod** (unapplied 047/048):

| Object | Repo source | Prod query |
|---|---|---|
| Table `public.push_reminder_log` | `047_push_reminder_log.sql:16` | `SELECT EXISTS (... table_name = 'push_reminder_log')` → `false` |
| Index `idx_push_reminder_log_sent_at` | `047_push_reminder_log.sql:28` | (table absent) |
| RLS + policy `"Users can view own reminder log"` | `047_push_reminder_log.sql:30–34` | (table absent) |
| Cron job `reminders-hourly` | `048_reminders_cron.sql:50–61` | `SELECT * FROM cron.job` — not present |

**No evidence of hand-edited production schema** beyond the timestamp-version ledger pattern above.

---

## 3. RLS reality

**RLS enabled query:** `SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`.

| Finding | Detail |
|---|---|
| **Tables with RLS disabled** | **None** — all 31 `public` tables have `rowsecurity = true`. |
| **Tables with RLS on, zero policies** (blocks `authenticated` by default) | `app_config`, `email_log`, `job_runs`, `user_beta_overrides` — intentional per `005_app_config_and_beta_overrides.sql:46,66` (no policies created). Query: tables in `pg_tables` with RLS minus `pg_policies`. |
| **Policies not covering `authenticated`** | **None** — all 67 policies use role `{public}`, which includes `authenticated`. Query: `pg_policies` WHERE NOT (`authenticated` = ANY(roles) OR `public` = ANY(roles)) → empty. |
| **Diff vs 012 / 018 / 040** | `012_fix_rls_helper_grants.sql` helper grants present; `018_optimize_rls_initplan.sql` initplan wrapping applied to pre-038 policies (prod `pg_policies` shows `(select auth.uid())` pattern). **Exception:** `038_notification_prefs.sql:30–43` policies use bare `auth.uid()` — matches prod and triggers performance advisor (not a prod-only drift). `040_rls_semantic_predicates.sql` carer self-SELECT arms on `timesheets`/`time_entries` present in prod (`Members can view timesheets` qual includes `carer_id = (select auth.uid())`). |
| **Intentional read-only for `authenticated`** (SELECT only; writes via service role) | `shift_events`, `shift_change_requests`, `time_entries`, `timesheets`, `expenses`, `pay_arrangements`, `pto_ledger`, `co_parent_approvals` — match migration intent. |
| **No INSERT policy for `authenticated`** | `households` — only SELECT/UPDATE (`009_households.sql:249–255`); household creation goes through API service role. |

---

## 4. Indexes

**Query:** `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname` — 88 indexes across 31 tables (each table has PK; most FK columns covered by composite indexes).

**Foreign keys without covering index** (22 — matches performance advisor):

| Table | FK |
|---|---|
| `co_parent_approvals` | `co_parent_approvals_requested_by_fkey`, `co_parent_approvals_responded_by_fkey` |
| `email_log` | `email_log_user_id_fkey` |
| `expenses` | `expenses_reviewed_by_fkey` |
| `external_busy_blocks` | `external_busy_blocks_calendar_account_id_fkey` |
| `handoff_notes` | `handoff_notes_author_id_fkey` |
| `household_closures` | `household_closures_created_by_fkey` |
| `household_invites` | `household_invites_accepted_by_fkey`, `household_invites_invited_by_fkey` |
| `households` | `households_created_by_fkey` |
| `pay_arrangements` | `pay_arrangements_carer_id_fkey`, `pay_arrangements_created_by_fkey` |
| `pto_ledger` | `pto_ledger_carer_id_fkey`, `pto_ledger_created_by_fkey`, `pto_ledger_time_off_id_fkey` |
| `schedule_patterns` | `schedule_patterns_created_by_fkey` |
| `shift_change_requests` | `shift_change_requests_requested_by_fkey`, `shift_change_requests_responded_by_fkey` |
| `shift_events` | `shift_events_actor_id_fkey` |
| `shifts` | `shifts_cancelled_by_fkey`, `shifts_created_by_fkey` |
| `timesheets` | `timesheets_approved_by_fkey` |

**RLS predicate columns without dedicated index** (beyond FK list above):

| Table | Column in policy predicate | Index status |
|---|---|---|
| `handoff_notes` | `author_id` in UPDATE policy (`Authors or parents can update handoff notes`) | Only `handoff_notes_household_date_idx` on `(household_id, local_date, phase)` — **no `author_id` index** |
| `household_id` / `user_id` predicates | `private.can_read_household(household_id)`, `private.can_write_household(household_id)`, `user_id = auth.uid()` | Generally covered (`household_members_household_status_idx`, `household_members_user_household_idx`, table PKs) |

**Unused indexes (prod telemetry):** `idx_job_runs_name_started`, `household_invites_code_pending_idx`, `schedule_patterns_carer_idx`, `schedule_pattern_day_children_child_idx`, `shift_children_child_idx`, `calendar_event_links_entity_idx`, `timesheets_carer_id_idx`, `expenses_carer_status_idx`.

---

## 5. Scheduled jobs

**Query:** `SELECT jobid, schedule, command, active, jobname FROM cron.job ORDER BY jobid`; `SHOW timezone` → **UTC**.

| Job | Schedule | Timezone | In prod? | Repo source |
|---|---|---|---|---|
| `schedule-horizon` | `0 3 * * *` | UTC (pg_cron host clock) | **Yes** (jobid 2, active) | `026_schedule_horizon_cron.sql:33–44`, re-registered in `032_fix_schedule_horizon_cron_pg_net_guard.sql:35–46` |
| `example-maintenance` | `0 3 * * *` | — | **No** | `007_pg_cron_vault_and_example_cron.sql:68–78` (commented out) |
| `reminders-hourly` | `5 * * * *` | UTC | **No** | `048_reminders_cron.sql:50–61` (not applied) |

**007 vault helpers** (`private.cron_api_base_url`, `private.cron_job_api_key`): present from migration 007; prod `schedule-horizon` command references them.

**Diff summary:** Prod has exactly the job migrations 026/032 create. Missing `reminders-hourly` from unapplied 048. No extra prod-only cron jobs.

---

## 6. Advisors

### Security (`get_advisors` type `security`) — 6 items

1. **rls_enabled_no_policy** — `public.app_config` — Table `public.app_config` has RLS enabled, but no policies exist
2. **rls_enabled_no_policy** — `public.email_log` — Table `public.email_log` has RLS enabled, but no policies exist
3. **rls_enabled_no_policy** — `public.job_runs` — Table `public.job_runs` has RLS enabled, but no policies exist
4. **rls_enabled_no_policy** — `public.user_beta_overrides` — Table `public.user_beta_overrides` has RLS enabled, but no policies exist
5. **extension_in_public** — `pg_net` — Extension `pg_net` is installed in the public schema. Move it to another schema.
6. **auth_leaked_password_protection** — `Auth` — Supabase Auth prevents the use of compromised passwords by checking against HaveIBeenPwned.org. Enable this feature to enhance security.

### Performance (`get_advisors` type `performance`) — 76 items

**unindexed_foreign_keys (22):**

- `public.co_parent_approvals` — `co_parent_approvals_requested_by_fkey`
- `public.co_parent_approvals` — `co_parent_approvals_responded_by_fkey`
- `public.email_log` — `email_log_user_id_fkey`
- `public.expenses` — `expenses_reviewed_by_fkey`
- `public.external_busy_blocks` — `external_busy_blocks_calendar_account_id_fkey`
- `public.handoff_notes` — `handoff_notes_author_id_fkey`
- `public.household_closures` — `household_closures_created_by_fkey`
- `public.household_invites` — `household_invites_accepted_by_fkey`
- `public.household_invites` — `household_invites_invited_by_fkey`
- `public.households` — `households_created_by_fkey`
- `public.pay_arrangements` — `pay_arrangements_carer_id_fkey`
- `public.pay_arrangements` — `pay_arrangements_created_by_fkey`
- `public.pto_ledger` — `pto_ledger_carer_id_fkey`
- `public.pto_ledger` — `pto_ledger_created_by_fkey`
- `public.pto_ledger` — `pto_ledger_time_off_id_fkey`
- `public.schedule_patterns` — `schedule_patterns_created_by_fkey`
- `public.shift_change_requests` — `shift_change_requests_requested_by_fkey`
- `public.shift_change_requests` — `shift_change_requests_responded_by_fkey`
- `public.shift_events` — `shift_events_actor_id_fkey`
- `public.shifts` — `shifts_cancelled_by_fkey`
- `public.shifts` — `shifts_created_by_fkey`
- `public.timesheets` — `timesheets_approved_by_fkey`

**auth_rls_initplan (4):**

- `public.notification_prefs` — policy `Users can view own notification prefs`
- `public.notification_prefs` — policy `Users can insert own notification prefs`
- `public.notification_prefs` — policy `Users can update own notification prefs`
- `public.notification_prefs` — policy `Users can delete own notification prefs`

**unused_index (8):**

- `public.job_runs` — `idx_job_runs_name_started`
- `public.household_invites` — `household_invites_code_pending_idx`
- `public.schedule_patterns` — `schedule_patterns_carer_idx`
- `public.schedule_pattern_day_children` — `schedule_pattern_day_children_child_idx`
- `public.shift_children` — `shift_children_child_idx`
- `public.calendar_event_links` — `calendar_event_links_entity_idx`
- `public.timesheets` — `timesheets_carer_id_idx`
- `public.expenses` — `expenses_carer_status_idx`

**multiple_permissive_policies (48):** `carer_availability`, `carer_time_off`, `external_busy_blocks`, `schedule_pattern_day_children`, `schedule_pattern_days`, `shift_children`, `shifts` — each flagged for roles `anon`, `authenticated`, `authenticator`, `cli_login_postgres`, `dashboard_user`, `supabase_privileged_role` on `SELECT` (overlapping read + write policies). Representative detail: Table `public.shifts` has multiple permissive policies for role `authenticated` for action `SELECT`. Policies include `{"Members can view shifts","Parents can write shifts"}`.

---

## 7. Recent errors

**Source:** `get_logs` services `api` and `postgres` (last 24h).

### Recurring (not noise)

| Service | Error | Count | Notes |
|---|---|---|---|
| **postgres** | `insert or update on table "households" violates foreign key constraint "households_created_by_fkey"` | 2 | FK targets `user_profiles(user_id)` (`009_households.sql:59`). Insert attempted with `created_by` not present in `user_profiles`. Correlates with API `POST /rest/v1/households` **409** responses (same window). |
| **postgres** | `column "clock_in" does not exist` | 1 | No `clock_in` column in migrations (`017_time_tracking.sql` defines `clock_in_at`). Likely ad-hoc/manual query, not app schema. |

### Noise (excluded)

- Checkpoint `LOG` lines (`checkpoint starting/complete`)
- `received SIGHUP, reloading configuration files`
- `could not receive data from client: Connection reset by peer`
- `background worker "pg_net 0.20.4 worker" exited with exit code 1` (single occurrence)
- Successful `200` API traffic

**API:** No recurring `5xx` errors. Dominant non-200: `POST /rest/v1/households` **409** (household creation conflict / FK-related setup flow).
