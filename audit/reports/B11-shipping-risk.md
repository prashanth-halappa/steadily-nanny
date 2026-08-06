Here is the B11 lane audit. The working tree at audit time did not match the prompt’s “14 modified files” snapshot: only bootstrap-profile/setup UI changes were pending; migrations `047`/`048` are already on `main` but unapplied in prod per A3.

### F-B11-1 | S1 | confidence: high
**Claim:** Migrations `047`/`048` are in the repo and the reminders job code is wired, but prod has neither `push_reminder_log` nor the `reminders-hourly` cron (A3); applying `048` or manually hitting `POST /api/jobs/reminders` before `047` makes every reminder run fail against a missing table.
**Location:** `supabase/migrations/047_push_reminder_log.sql:16`; `supabase/migrations/048_reminders_cron.sql:50-61`; `apps/api/src/domains/notification/repositories/reminderLogRepository.ts:24-44`; `apps/api/src/routes/jobRoutes.ts:40`; `audit/reports/A3-prod-ground-truth.md:12-13,31-34`
**Trace:** `pg_cron` → `net.http_post('/api/jobs/reminders')` → `validateJobApiKey` → `JobController.runReminders` → `runReminderJob` → `ReminderLogRepository.claim` → `supabaseService.from('push_reminder_log').insert(...)`.
**Wrong-number scenario:** A submitted timesheet sits unapproved because the parent never gets the day-3 nudge; payroll stays blocked — not a wrong gross, but hours/pay path stuck. Concrete: timesheet `status='submitted'` for 4 days, cron fires, `claim()` gets a non-`23505` DB error (relation does not exist), job logs failure, no push sent.
**Fix sketch:** Apply `047` before `048`; gate deploy on migration ledger parity with repo.

### F-B11-2 | S1 | confidence: high
**Claim:** CI never applies or validates Supabase migrations against a fresh database, so migration ledger drift (A3: `047`/`048` in repo, absent in prod) cannot be caught before ship.
**Location:** `.github/workflows/ci.yml:1-254`; `apps/api/scripts/db-migrate.sh:26-31`
**Trace:** CI jobs run format/lint/test/typecheck only; `db-migrate.sh` exists for manual `supabase db push` but is not invoked in any workflow step.
**Wrong-number scenario:** Cannot produce a wrong cent directly; a migration that adds a pay constraint or changes earnings columns ships in git but not prod, so code and DB diverge and approve/earnings paths fail or behave differently per environment.
**Fix sketch:** Add a CI job that runs `supabase db reset` (or `migration up --local`) against all files in `supabase/migrations/`.

### F-B11-3 | S1 | confidence: high
**Claim:** `bun run qc` runs `lint` and `format:check` on `packages/shared-types`, but CI has no equivalent jobs — only `shared-types-typecheck` and `shared-types-test`.
**Location:** `scripts/qc.sh:51-52,73-89`; `.github/workflows/ci.yml:194-232`; `packages/shared-types/src/schemas/timesheet.schema.ts:318-353`; `docs/DEFECT-LOG.md:1607-1611`
**Trace:** Money wire contracts (`TimesheetSchema`, `WeekEarnings`, `CreatePayArrangementRequest`, etc.) live in shared-types; qc enforces Biome rules there; CI does not.
**Wrong-number scenario:** A shared-types change that Biome/typecheck alone won’t catch (e.g. loosened Zod refine on `amount_minor`) merges green in CI; mobile and API both compile but disagree on wire shape, and a client displays or submits the wrong minor-unit value.
**Fix sketch:** Add `shared-types-format` and `shared-types-lint` jobs mirroring the api/mobile blocks.

### F-B11-4 | S1 | confidence: high
**Claim:** Production EAS only inlines `EXPO_PUBLIC_API_URL`; Supabase URL/key are not in `eas.json`, default to empty strings at build time, and `validateEnv()` only warns in `__DEV__`, so a misconfigured EAS secret ships a build that boots but cannot authenticate.
**Location:** `apps/mobile/eas.json:25-34`; `apps/mobile/src/config/env.ts:14-17,23-24,34-39`; `apps/mobile/src/lib/supabase.ts:11-14`; `apps/mobile/src/app/_layout.tsx:50`
**Trace:** EAS build → `env.supabaseUrl`/`env.supabaseAnonKey` inlined as `''` if secrets missing → `createClient('', '')` → auth/session calls fail at runtime; `validateEnv()` is a no-op in release (`__DEV__` false).
**Wrong-number scenario:** Carer cannot clock in; no `time_entries` created; week shows 0 minutes and £0 — wrong hours total relative to work performed, not a calculation bug.
**Fix sketch:** Fail the EAS build if `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY` is unset (e.g. `expo-build-properties` env check or a prebuild script that throws).

### F-B11-5 | S1 | confidence: high
**Claim:** There is no API/mobile contract version gate, while `expo-updates` is enabled with a fixed `runtimeVersion`, so an OTA JS update can ship against a stale API.
**Location:** `apps/mobile/app.config.js:188-194`; `apps/mobile/src/config/appIdentity.json:6`; `apps/mobile/src/api/client.ts:33-37`; `.github/workflows/ci.yml` (no version-compat check)
**Trace:** `expo-updates` `checkAutomatically: 'ON_LOAD'` → new bundle with updated Zod schemas/client parsing → `apiClient` calls unchanged prod API → `safeParse` failures or field mismatches on timesheet/pay endpoints.
**Wrong-number scenario:** OTA ships client expecting `gross_minor` in a new envelope shape; parse throws or field is dropped; UI shows £0.00 for an approved week with nonzero earnings.
**Fix sketch:** Add an `X-Client-Contract-Version` header and have the API return 426 when mismatched; block OTA publish until API is live.

### F-B11-6 | S1 | confidence: med
**Claim:** The uncommitted `ChildrenScreen` bootstrap path surfaces no error UI when profile upsert or household create fails, leaving the user on an infinite loading spinner.
**Location:** `apps/mobile/src/domains/setup/components/ChildrenScreen.tsx:63-74,110-129`
**Trace:** `useEffect` → `upsertProfile.mutateAsync(buildBootstrapProfileRequest(...))` → `createHousehold.mutateAsync(...)` → `catch { bootstrapStartedRef.current = false }` → `isLoadingHousehold = !householdId` stays true → `<LoadingIndicator />` with no retry/error branch.
**Wrong-number scenario:** Cannot produce a wrong paid amount; a new parent never reaches scheduling/timesheet flows, so no hours are recorded — pay path permanently blocked for that account.
**Fix sketch:** Track `bootstrapError` state and render `ErrorState` with retry instead of unconditional spinner when `householdId` is null after failure.

### F-B11-7 | S1 | confidence: high
**Claim:** The API requires `GOOGLE_VERTEX_PROJECT` at boot in every non-test environment, so a payroll-only deploy missing Vertex config crashes before serving any timesheet/pay route.
**Location:** `apps/api/src/config/env.core.ts:39,48-68`; `apps/api/src/config/env.ts:86-87`; `apps/api/src/app.ts` (imports `env` first)
**Trace:** Process start → `validateEnv()` → `coreEnvSchema` parse → missing `GOOGLE_VERTEX_PROJECT` → throw → API never listens on `PORT`.
**Wrong-number scenario:** Cannot produce a wrong cent; entire hours/pay API is down after a misconfigured deploy (missing one env var documented in `.env.example:26-27`).
**Fix sketch:** Make `GOOGLE_VERTEX_PROJECT` optional in non-production, or split LLM config into a lazy-loaded module not imported at boot.

### F-B11-8 | S2 | confidence: high
**Claim:** `check-test-coverage-new.sh` runs in CI but not in `bun run qc`, so a developer can pass local qc and only discover missing API tests on push.
**Location:** `.github/workflows/ci.yml:85-88`; `scripts/qc.sh:51-99`; `scripts/check-test-coverage-new.sh:20,48-60`
**Trace:** Local `bun run qc` → 12 app checks + scripts tests; no `check-test-coverage-new.sh`. CI `api-test` → tests + `BASE_BRANCH=origin/main bash scripts/check-test-coverage-new.sh`.
**Wrong-number scenario:** Cannot directly produce a wrong amount; new untested API earnings code merges if CI is bypassed or run on a shallow clone without `fetch-depth: 0` (D39 fixed that, but local gate still absent).
**Fix sketch:** Add the same `check-test-coverage-new.sh` invocation to `scripts/qc.sh` after API tests.

### F-B11-9 | S2 | confidence: med
**Claim:** `BaseRepository.create`/`update` use `biome-ignore` + `as any` at the Supabase write boundary inherited by every pay/timesheet/expense repository.
**Location:** `apps/api/src/shared/repositories/baseRepository.ts:56-57,77-78`; e.g. `apps/api/src/domains/pay/repositories/expenseRepository.ts` (extends `BaseRepository`); `apps/api/src/domains/timesheet/repositories/timesheetRepository.ts`
**Trace:** `timesheetCommandService.approve` → `TimesheetRepository.update` → `BaseRepository.update` → `.update(data as any)` → PostgREST write to `timesheets.gross_minor` / `earnings` jsonb.
**Wrong-number scenario:** A mistyped field name in a repository call (e.g. `grossMinors` instead of `gross_minor`) compiles and silently omits the column, leaving a prior `gross_minor` or null on approve.
**Fix sketch:** Replace `as any` with typed Supabase generated types or per-table insert/update generics.

### F-B11-10 | S3 | confidence: high
**Claim:** Untracked `apps/mobile/assets/_staging/` (icon concepts + `.DS_Store`) is not gitignored and could be accidentally committed into a release branch.
**Location:** `apps/mobile/assets/_staging/` (untracked per `git status`); `.gitignore` (no `_staging` entry)
**Trace:** `git add .` before commit → asset directory enters repo → EAS bundles any imported assets from `assets/`.
**Wrong-number scenario:** Cannot produce a wrong paid amount or hours total; accidental ship adds dev artifacts and macOS metadata to the repo/build context.
**Fix sketch:** Add `apps/mobile/assets/_staging/` to `.gitignore` or delete before merge.

### F-B11-11 | S3 | confidence: med
**Claim:** Root `package.json` documents missing `patchedDependencies` for Expo/Sentry workarounds, leaving known native/runtime bugs unpatched in production builds.
**Location:** `package.json:40`; `apps/mobile/package.json:63,96` (`@sentry/react-native`, `expo-updates`)
**Trace:** Build → unpatched `expo-updates`/`@sentry/react-native` → native crash or broken OTA delivery on specific Expo SDK versions noted in the TODO.
**Wrong-number scenario:** Cannot produce a wrong cent; app crash on launch or failed OTA prevents reaching timesheet screens.
**Fix sketch:** Re-evaluate source patches against pinned versions and restore `patchedDependencies` if bugs reproduce.
